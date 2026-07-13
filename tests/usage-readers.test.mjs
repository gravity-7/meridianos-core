import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUsage } from '../usage-readers.mjs';

// ─── claude-code reader ──────────────────────────────────────────────────────

const claudeLine = (model, input, output, cw = 0) => JSON.stringify({
  timestamp: new Date().toISOString(),
  message: { role: 'assistant', model, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cw, cache_read_input_tokens: 0 } },
});

function fakeClaudeHome({ sessionId, lines }) {
  const home = mkdtempSync(join(tmpdir(), 'ur-claude-home-'));
  const projectDir = join(home, '.claude', 'projects', 'some-project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
  return home;
}

test('claude-code reader sums a native-Anthropic transcript into inputTokens/outputTokens/totalTokens', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-native', lines: [claudeLine('claude-opus-4-8', 500, 100, 20)] });
  const run = { session: 'sess-native', provider: { name: 'anthropic' } };
  const u = readUsage('claude-code', run, {}, { home });
  assert.equal(u.inputTokens, 520);   // 500 + 20 cache-write, mirrors claude-usage.mjs billable
  assert.equal(u.outputTokens, 100);
  assert.equal(u.totalTokens, 620);
  assert.equal(u.provider, 'anthropic');
  assert.equal(u.model, 'claude-opus-4-8');
});

test('claude-code reader counts a DeepSeek-via-claude-code turn exactly like a native one (model-agnostic)', () => {
  const home = fakeClaudeHome({ sessionId: 'sess-ds', lines: [claudeLine('deepseek-chat', 300, 60)] });
  const run = { session: 'sess-ds', provider: { name: 'deepseek' } };
  const u = readUsage('claude-code', run, {}, { home });
  assert.equal(u.totalTokens, 360);
  assert.equal(u.provider, 'deepseek');  // from the run's resolved provider, not guessed from the model
  assert.equal(u.model, 'deepseek-chat');
});

test('claude-code reader sums a mixed session (native + third-party turns in the same transcript)', () => {
  const home = fakeClaudeHome({
    sessionId: 'sess-mixed',
    lines: [claudeLine('claude-sonnet-5', 100, 20), claudeLine('deepseek-chat', 200, 40)],
  });
  const u = readUsage('claude-code', { session: 'sess-mixed', provider: { name: 'anthropic' } }, {}, { home });
  assert.equal(u.totalTokens, 360); // both turns counted, no model filtering
});

test('claude-code reader returns null when no transcript exists for the session (genuinely unknown)', () => {
  const home = mkdtempSync(join(tmpdir(), 'ur-claude-home-empty-'));
  const u = readUsage('claude-code', { session: 'sess-missing', provider: { name: 'anthropic' } }, {}, { home });
  assert.equal(u, null);
});

// ─── antigravity reader ──────────────────────────────────────────────────────

function varint(n) { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; o.push(b); } while (v > 0n); return Buffer.from(o); }
const tg = (f, w) => varint((f << 3) | w);
const vf = (f, n) => Buffer.concat([tg(f, 0), varint(n)]);
const mf = (f, b) => Buffer.concat([tg(f, 2), varint(b.length), b]);
const agBlob = ({ input, output, model }) => mf(1, Buffer.concat([
  mf(4, Buffer.concat([vf(2, input), vf(3, output), vf(9, output), vf(10, 0)])),
  ...(model ? [mf(19, Buffer.from(model, 'utf8'))] : []),
]));

function fakeAntigravityDir(conversationId, blobs) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-ag-'));
  const dbPath = join(dir, `${conversationId}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const ins = db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)');
  blobs.forEach((b, i) => ins.run(i, b, b.length));
  db.close();
  return dir;
}

test('antigravity reader sums every generation in the conversation into inputTokens/outputTokens', () => {
  const dir = fakeAntigravityDir('conv-1', [
    agBlob({ input: 3000, output: 800, model: 'gemini-3-flash-a' }),
    agBlob({ input: 1000, output: 200, model: 'gemini-3-flash-a' }),
  ]);
  const u = readUsage('antigravity', { session: 'conv-1', provider: { name: 'antigravity' } }, {}, { dirs: [dir] });
  assert.equal(u.inputTokens, 4000);
  assert.equal(u.outputTokens, 1000);
  assert.equal(u.totalTokens, 5000);
  assert.equal(u.model, 'gemini-3-flash-a');
});

test('antigravity reader defaults provider to "antigravity" when the run carries none', () => {
  const dir = fakeAntigravityDir('conv-2', [agBlob({ input: 10, output: 5 })]);
  const u = readUsage('antigravity', { session: 'conv-2' }, {}, { dirs: [dir] });
  assert.equal(u.provider, 'antigravity');
});

test('antigravity reader returns null when no conversation db matches the session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ur-ag-empty-'));
  const u = readUsage('antigravity', { session: 'conv-missing' }, {}, { dirs: [dir] });
  assert.equal(u, null);
});

// ─── opencode reader ─────────────────────────────────────────────────────────

function fakeOpencodeDb(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-oc-'));
  const dbPath = join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session (
    id text PRIMARY KEY, directory text NOT NULL, model text,
    tokens_input integer DEFAULT 0, tokens_output integer DEFAULT 0,
    tokens_reasoning integer DEFAULT 0, tokens_cache_read integer DEFAULT 0, tokens_cache_write integer DEFAULT 0
  )`);
  const ins = db.prepare(`INSERT INTO session (id, directory, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write) VALUES (?,?,?,?,?,?,?,?)`);
  rows.forEach((r, i) => ins.run(`ses_${i}`, r.directory, r.model ?? null, r.input ?? 0, r.output ?? 0, r.reasoning ?? 0, r.cacheRead ?? 0, r.cacheWrite ?? 0));
  db.close();
  return dbPath;
}

test('opencode reader reads the session matched by worktree directory', () => {
  const dbPath = fakeOpencodeDb([{ directory: '/repo/.aios-worktrees/aios__F-1', model: '{"id":"deepseek-chat","providerID":"deepseek"}', input: 8000, output: 100 }]);
  const run = { session: 'unused-no-flag-for-opencode', provider: { name: 'deepseek' }, worktreePath: '/repo/.aios-worktrees/aios__F-1' };
  const u = readUsage('opencode', run, {}, { dbPath });
  assert.equal(u.inputTokens, 8000);
  assert.equal(u.outputTokens, 100);
  assert.equal(u.totalTokens, 8100);
  assert.equal(u.provider, 'deepseek');   // from opencode's OWN recorded model JSON
  assert.equal(u.model, 'deepseek-chat');
});

test('opencode reader falls back to the run\'s provider/model when the model JSON is unparsable', () => {
  const dbPath = fakeOpencodeDb([{ directory: '/repo/wt', model: null, input: 10, output: 2 }]);
  const run = { session: 'x', provider: { name: 'openrouter' }, model: 'openrouter/auto', worktreePath: '/repo/wt' };
  const u = readUsage('opencode', run, {}, { dbPath });
  assert.equal(u.provider, 'openrouter');
  assert.equal(u.model, 'openrouter/auto');
});

test('opencode reader returns null when the run has no worktreePath', () => {
  const dbPath = fakeOpencodeDb([{ directory: '/repo/wt', input: 10, output: 2 }]);
  const u = readUsage('opencode', { session: 'x', provider: { name: 'deepseek' } }, {}, { dbPath });
  assert.equal(u, null);
});

test('opencode reader returns null when no session row matches the directory', () => {
  const dbPath = fakeOpencodeDb([{ directory: '/repo/wt-other', input: 10, output: 2 }]);
  const u = readUsage('opencode', { session: 'x', provider: { name: 'deepseek' }, worktreePath: '/repo/wt' }, {}, { dbPath });
  assert.equal(u, null);
});

// ─── dispatcher ──────────────────────────────────────────────────────────────

test('readUsage returns null for an unknown harness rather than throwing', () => {
  assert.equal(readUsage('aider', { session: 'x' }, {}), null);
});

test('readUsage never throws even if a reader hits an unexpected error', () => {
  // No dirs/home override at all + a session id that can't possibly exist locally in CI — every
  // reader must fail soft to null, not throw, so a metering gap never crashes the run it's about.
  assert.doesNotThrow(() => readUsage('claude-code', { session: 'zz-nonexistent-' + Math.random() }, {}));
  assert.doesNotThrow(() => readUsage('antigravity', { session: 'zz-nonexistent-' + Math.random() }, {}));
  assert.doesNotThrow(() => readUsage('opencode', { session: 'x', worktreePath: '/zz/nonexistent' }, {}));
});
