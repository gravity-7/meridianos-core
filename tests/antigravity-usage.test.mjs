import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGenerationUsage, readConversationUsage, antigravityUsage } from '../antigravity-usage.mjs';

// --- minimal protobuf encoder mirroring Antigravity's gen_metadata shape ---
function varint(n) { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; out.push(b); } while (v > 0n); return Buffer.from(out); }
const tag = (field, wire) => varint((field << 3) | wire);
const vField = (field, n) => Buffer.concat([tag(field, 0), varint(n)]);
const mField = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf]);

function genBlob({ input, output, context, text, think, ts, model }) {
  const usage = Buffer.concat([
    vField(1, 1016),
    vField(2, input),
    vField(3, output),
    ...(context != null ? [vField(5, context)] : []),
    vField(9, text),
    vField(10, think),
  ]);
  const gen = Buffer.concat([
    mField(4, usage),
    ...(ts != null ? [mField(9, mField(4, Buffer.concat([vField(1, ts), vField(2, 0)])))] : []),
    ...(model ? [mField(19, Buffer.from(model, 'utf8'))] : []), // #1.#19 = model id
  ]);
  return mField(1, gen); // top-level #1 = the generation message
}

test('extractGenerationUsage decodes token fields + timestamp + model', () => {
  const u = extractGenerationUsage(genBlob({ input: 3000, output: 800, context: 24000, text: 600, think: 200, ts: 1782761579, model: 'gemini-3-flash-a' }));
  assert.equal(u.model, 'gemini-3-flash-a');
  assert.equal(u.inputFresh, 3000);
  assert.equal(u.outputTotal, 800);
  assert.equal(u.contextTotal, 24000);
  assert.equal(u.outputText, 600);
  assert.equal(u.outputThinking, 200);
  assert.equal(u.tsSeconds, 1782761579);
  assert.equal(u.billable, 3800); // fresh input + output, parallel to Claude
});

test('handles gzip + the cache-cold case (no context field present)', () => {
  const g = extractGenerationUsage(gzipSync(genBlob({ input: 24000, output: 100, context: null, text: 60, think: 40, ts: 1782761600 })));
  assert.equal(g.inputFresh, 24000);
  assert.equal(g.contextTotal, 0);
  assert.equal(g.billable, 24100);
});

test('fails soft — never throws on malformed input', () => {
  assert.equal(extractGenerationUsage(Buffer.from([0xff, 0x00, 0x13, 0x37])), null);
  assert.equal(extractGenerationUsage(Buffer.alloc(0)), null);
});

test('aggregates into rolling 5h / 7d windows from a real-shaped gen_metadata table', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');
  const recent = Math.floor((now - 1 * 3600 * 1000) / 1000); // 1h ago
  const old = Math.floor((now - 3 * 24 * 3600 * 1000) / 1000); // 3d ago
  const dir = mkdtempSync(join(tmpdir(), 'ag-usage-'));
  const dbPath = join(dir, 'conv1.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const ins = db.prepare('INSERT INTO gen_metadata(idx,data,size) VALUES (?,?,?)');
  const b1 = genBlob({ input: 5000, output: 1000, context: 30000, text: 800, think: 200, ts: recent });
  const b2 = genBlob({ input: 2000, output: 500, context: 20000, text: 400, think: 100, ts: old });
  ins.run(0, b1, b1.length);
  ins.run(1, b2, b2.length);
  db.close();

  assert.equal(readConversationUsage(dbPath).length, 2);
  const u = antigravityUsage({ dirs: [dir], now });
  assert.equal(u.last5h.billable, 6000);        // only b1
  assert.equal(u.last5h.generations, 1);
  assert.equal(u.last7d.billable, 8500);        // b1 + b2
  assert.equal(u.last7d.generations, 2);
});

test('pools: generations split by model family, each with its own week clock and 5h session', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const H = 3600 * 1000;
  const sec = (ms) => Math.floor(ms / 1000);
  const dir = mkdtempSync(join(tmpdir(), 'ag-pools-'));
  const db = new DatabaseSync(join(dir, 'conv.db'));
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const ins = db.prepare('INSERT INTO gen_metadata(idx,data,size) VALUES (?,?,?)');
  const rows = [
    // gemini: old activity 2d ago (before its week boundary) + nothing recent → 5h session closed
    genBlob({ input: 1000, output: 0, text: 0, think: 0, ts: sec(now - 48 * H), model: 'gemini-3-flash-a' }),
    // claude/gpt: 30h ago (inside its week) + 1h ago (opens its current 5h session)
    genBlob({ input: 200, output: 0, text: 0, think: 0, ts: sec(now - 30 * H), model: 'claude-sonnet-4-6' }),
    genBlob({ input: 70, output: 0, text: 0, think: 0, ts: sec(now - 1 * H), model: 'claude-opus-4-6-thinking' }),
    // no model recorded → falls into the FIRST pool (gemini)
    genBlob({ input: 3, output: 0, text: 0, think: 0, ts: sec(now - 1 * H) }),
  ];
  rows.forEach((b, i) => ins.run(i, b, b.length));
  db.close();

  const u = antigravityUsage({ dirs: [dir], now, session5h: true, pools: [
    { key: 'gemini', match: ['gemini'], weekStartMs: now - 24 * H },      // gemini week began 24h ago
    { key: 'claude_gpt', match: ['claude', 'gpt'], weekStartMs: now - 72 * H },
  ] });

  const g = u.pools.gemini, c = u.pools.claude_gpt;
  assert.equal(g.last7d.billable, 3);        // 2d-old gen is before gemini's week boundary; unmatched gen (3) is in-window
  assert.equal(g.total.billable, 1003);
  assert.equal(c.last7d.billable, 270);      // both claude gens inside its own (older) boundary
  // independent 5h sessions: the no-model gen (1h ago, pool gemini) opens gemini's session too
  assert.equal(c.last5h.billable, 70);
  assert.deepEqual(c.fiveHourSession, { start: now - 1 * H, resetAt: now + 4 * H });
  // top level = sum across pools; a single summed 5h session would be meaningless
  assert.equal(u.last7d.billable, 273);
  assert.equal(u.fiveHourSession, null);
});
