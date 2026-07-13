/**
 * antigravity-usage — extract EXACT token counts for Google Antigravity from its local
 * conversation stores, so it can be held to the same token budget as Claude.
 *
 * Antigravity has no plain token fields on disk (unlike Claude's transcripts): usage is inside
 * protobuf blobs in `~/.gemini/antigravity{,-ide}/conversations/<id>.db`, table `gen_metadata`,
 * column `data`. We decode the wire format directly (no .proto needed).
 *
 * FIELD MAP (reverse-engineered + validated empirically — the invariant `#3 == #9 + #10` held on
 * 1490/1490 generations across every local conversation):
 *   top-level  #1               → the generation message
 *     #1.#4                     → the token-usage block:
 *         #2  input_fresh       (uncached input processed this turn)
 *         #3  output_total      (= #9 text + #10 thinking)
 *         #5  context_total     (full prompt incl. cached; absent on cache-cold turns)
 *         #9  output_text
 *         #10 output_thinking
 *     #1.#9.#4                  → Timestamp { #1 seconds, #2 nanos }
 *
 * Per-generation consumption (parallel to Claude's fresh-input + output) = #2 + #3.
 * This is best-effort: if Antigravity changes its schema these field numbers may shift, so the
 * module fails soft (returns null / 0) and never throws — the watchdog treats a parse gap as
 * "unknown", never as "zero budget used".
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// ---- protobuf wire-format reader (varint + length-delimited) ------------------------
export function readVarint(buf, pos) {
  let result = 0n, shift = 0n, p = pos;
  for (;;) {
    if (p >= buf.length) throw new Error('varint overrun');
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  return [result, p];
}

/** Parse a protobuf message into [{field, wire, value}], or null if it isn't a clean message. */
export function parseMessage(buf) {
  const fields = [];
  let pos = 0;
  try {
    while (pos < buf.length) {
      const [tag, p1] = readVarint(buf, pos); pos = p1;
      const field = Number(tag >> 3n), wire = Number(tag & 7n);
      if (field === 0) return null;
      if (wire === 0) { const [v, p2] = readVarint(buf, pos); pos = p2; fields.push({ field, wire, value: v }); }
      else if (wire === 1) { if (pos + 8 > buf.length) return null; fields.push({ field, wire, value: buf.readBigUInt64LE(pos) }); pos += 8; }
      else if (wire === 2) { const [len, p2] = readVarint(buf, pos); const n = Number(len); if (p2 + n > buf.length) return null; fields.push({ field, wire, value: buf.subarray(p2, p2 + n) }); pos = p2 + n; }
      else if (wire === 5) { if (pos + 4 > buf.length) return null; fields.push({ field, wire, value: buf.readUInt32LE(pos) }); pos += 4; }
      else return null;
    }
  } catch { return null; }
  return fields;
}

const subMessage = (fields, n) => { const f = fields?.find((x) => x.field === n && x.wire === 2); return f ? parseMessage(f.value) : null; };
const varint = (fields, n) => { const f = fields?.find((x) => x.field === n && x.wire === 0); return f ? Number(f.value) : null; };
const text = (fields, n) => { const f = fields?.find((x) => x.field === n && x.wire === 2); return f ? f.value.toString('utf8') : null; };

/** Decode one gen_metadata blob → usage record, or null. Never throws. */
export function extractGenerationUsage(blob) {
  let buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = gunzipSync(buf); } catch { return null; } }
  const top = parseMessage(buf); if (!top) return null;
  const gen = subMessage(top, 1); if (!gen) return null;
  const u = subMessage(gen, 4); if (!u) return null;

  const inputFresh = varint(u, 2) ?? 0;
  const outputTotal = varint(u, 3) ?? 0;
  const contextTotal = varint(u, 5) ?? 0;
  const outputText = varint(u, 9) ?? 0;
  const outputThinking = varint(u, 10) ?? 0;

  const tsMsg = subMessage(subMessage(gen, 9), 4);
  const tsSeconds = tsMsg ? varint(tsMsg, 1) : null;

  return {
    inputFresh, outputTotal, contextTotal, outputText, outputThinking,
    tsSeconds,
    model: text(gen, 19), // model id, e.g. "gemini-3-flash-a" / "claude-sonnet-4-6" (#1.#21 is its display name)
    billable: inputFresh + outputTotal, // parallel to Claude's fresh-input + output
  };
}

/** Read every generation's usage from one conversation .db (read-only; skips locked/broken). */
export function readConversationUsage(dbPath) {
  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch { return []; }
  let rows;
  try { rows = db.prepare('SELECT data FROM gen_metadata').all(); }
  catch { try { db.close(); } catch {} return []; }
  const out = [];
  for (const r of rows) {
    if (!r.data) continue;
    const u = extractGenerationUsage(Buffer.from(r.data));
    if (u) out.push(u);
  }
  try { db.close(); } catch {}
  return out;
}

export function defaultAntigravityDirs(home = homedir()) {
  return [
    join(home, '.gemini', 'antigravity', 'conversations'),
    join(home, '.gemini', 'antigravity-ide', 'conversations'),
  ].filter(existsSync);
}

/**
 * Locate ONE run's conversation store by its conversation id (each conversation is `<id>.db`
 * under one of defaultAntigravityDirs()). Returns the file path, or null if neither dir has it.
 */
export function findConversationDbPath(conversationId, { dirs = defaultAntigravityDirs() } = {}) {
  if (!conversationId) return null;
  const fname = conversationId + '.db';
  for (const dir of dirs) {
    const p = join(dir, fname);
    if (existsSync(p)) return p;
  }
  return null;
}

const H5 = 5 * 60 * 60 * 1000;
const D7 = 7 * 24 * 60 * 60 * 1000;
const emptyWindow = () => ({ input: 0, output: 0, billable: 0, generations: 0 });

/**
 * Aggregate Antigravity token consumption into the rolling 5-hour and 7-day windows.
 * Pass `agentSessions` (a Set of conversation ids) to count ONLY agent-launched conversations —
 * each conversation is stored as `<id>.db`, so the filename is the join key against the run log
 * (attribution: agent_only). Omit it to count every conversation (founder-interactive + agent).
 * With `splitFounder: true` (and `agentSessions`), founder conversations are not skipped but
 * accumulated into a separate `founder` window set in the same pass; otherwise founder=null.
 * `weekStartMs` / `session5h` anchor the windows to the plan's real quota cycles exactly as in
 * claude-usage.mjs (fixed weekly boundary; activity-anchored 5h sessions with `fiveHourSession`
 * meta) — see that file's doc comment for the semantics.
 *
 * POOLS: Antigravity meters Gemini models and Claude/GPT models as SEPARATE quota pools, each
 * on its own weekly clock and with its own independent 5h sessions. Pass
 *   pools: [{ key, match: ['gemini'], weekStartMs }, ...]
 * to classify every generation by case-insensitive model-id substring (no model / no match ⇒
 * the FIRST pool) and window each pool independently. The top-level windows then hold the sum
 * across pools (per-pool 5h sessions differ, so the summed fiveHourSession is null) and
 * `pools[key]` carries each pool's { last5h, last7d, total, founder, fiveHourSession }.
 */
export function antigravityUsage({ dirs = defaultAntigravityDirs(), now = Date.now(), agentSessions = null, splitFounder = false, weekStartMs = null, session5h = false, pools = null } = {}) {
  const founderOn = !!(splitFounder && agentSessions);
  let noTimestamp = 0;
  const add = (w, u) => { w.input += u.inputFresh; w.output += u.outputTotal; w.billable += u.billable; w.generations++; };

  const all = [];
  for (const dir of dirs) {
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith('.db')); } catch { continue; }
    for (const f of files) {
      const isAgent = !agentSessions || agentSessions.has(f.replace(/\.db$/, ''));
      if (!isAgent && !founderOn) continue; // agent_only without split: skip the founder's own interactive conversations
      for (const u of readConversationUsage(join(dir, f))) all.push({ u, ts: u.tsSeconds == null ? null : u.tsSeconds * 1000, isAgent });
    }
  }

  // Window one record set (a pool, or everything) against its own week boundary + 5h session.
  const windowed = (records, wkStartMs) => {
    const main = { last5h: emptyWindow(), last7d: emptyWindow(), total: emptyWindow() };
    const founder = founderOn ? { last5h: emptyWindow(), last7d: emptyWindow(), total: emptyWindow() } : null;
    let start5h = now - H5, fiveHourSession = null;
    if (session5h) {
      const stamped = records.filter((x) => x.ts != null && x.ts <= now).sort((a, b) => a.ts - b.ts);
      let ws = null;
      for (const x of stamped) if (ws == null || x.ts >= ws + H5) ws = x.ts;
      const active = ws != null && now < ws + H5;
      start5h = active ? ws : Infinity;
      fiveHourSession = { start: active ? ws : null, resetAt: active ? ws + H5 : null };
    }
    const startWeek = wkStartMs ?? (now - D7);
    for (const { u, ts, isAgent } of records) {
      const w = isAgent ? main : founder;
      add(w.total, u);
      if (ts == null) { noTimestamp++; continue; }
      if (ts > now) continue;
      if (ts >= start5h) add(w.last5h, u);
      if (ts >= startWeek) add(w.last7d, u);
    }
    return { ...main, founder, fiveHourSession };
  };

  if (!pools || !pools.length) return { ...windowed(all, weekStartMs), noTimestamp };

  const byPool = new Map(pools.map((p) => [p.key, []]));
  for (const rec of all) {
    const m = (rec.u.model ?? '').toLowerCase();
    const pool = pools.find((p) => (p.match ?? []).some((s) => m.includes(String(s).toLowerCase()))) ?? pools[0];
    byPool.get(pool.key).push(rec);
  }
  const out = { pools: {} };
  const sum = { last5h: emptyWindow(), last7d: emptyWindow(), total: emptyWindow() };
  const sumFounder = founderOn ? { last5h: emptyWindow(), last7d: emptyWindow(), total: emptyWindow() } : null;
  const addWin = (a, b) => { for (const k of Object.keys(b)) a[k] += b[k]; };
  for (const p of pools) {
    const w = windowed(byPool.get(p.key), p.weekStartMs ?? null);
    out.pools[p.key] = w;
    for (const k of ['last5h', 'last7d', 'total']) { addWin(sum[k], w[k]); if (sumFounder) addWin(sumFounder[k], w.founder[k]); }
  }
  return { ...sum, founder: sumFounder, fiveHourSession: null, pools: out.pools, noTimestamp };
}

// ---- CLI: print current Antigravity consumption ------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const u = antigravityUsage();
  const fmt = (n) => n.toLocaleString('en-US');
  console.log('Antigravity token consumption (from ~/.gemini protobuf):');
  console.log(`  last 5h:   ${fmt(u.last5h.billable)} tokens  (in ${fmt(u.last5h.input)} + out ${fmt(u.last5h.output)}, ${u.last5h.generations} generations)`);
  console.log(`  last 7d:   ${fmt(u.last7d.billable)} tokens  (in ${fmt(u.last7d.input)} + out ${fmt(u.last7d.output)}, ${u.last7d.generations} generations)`);
  console.log(`  all-time:  ${fmt(u.total.billable)} tokens  (${u.total.generations} generations; ${u.noTimestamp} without a timestamp)`);
}
