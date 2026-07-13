import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { budgetStatus, verdictFor, agentSessionIds, nonTranscriptUsage, providerBreakdown } from '../budget.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// Budget is roster-driven (§1.4): the output's top-level keys mirror config.domain.agents, and
// each agent's usage store is chosen via config.domain.budgetMeter. FIXTURE_DOMAIN's own roster
// (agent-a/agent-b) doesn't match this file's synthetic claude/antigravity fixtures, so every test
// below injects this claude/antigravity override — matching PV's real roster/meter shape.
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'], budgetMeter: { claude: 'transcript', antigravity: 'protobuf' } } });

// synthetic Antigravity gen_metadata blob (mirror of the encoder in antigravity-usage.test.mjs)
function varint(n) { const o = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v > 0n) b |= 0x80; o.push(b); } while (v > 0n); return Buffer.from(o); }
const tg = (f, w) => varint((f << 3) | w);
const vf = (f, n) => Buffer.concat([tg(f, 0), varint(n)]);
const mf = (f, b) => Buffer.concat([tg(f, 2), varint(b.length), b]);
const agBlob = ({ input, output, ts, model }) => mf(1, Buffer.concat([
  mf(4, Buffer.concat([vf(2, input), vf(3, output), vf(9, output), vf(10, 0)])),
  mf(9, mf(4, Buffer.concat([vf(1, ts), vf(2, 0)]))),
  ...(model ? [mf(19, Buffer.from(model, 'utf8'))] : []),
]));
const claudeLine = (ts, input, output) => JSON.stringify({ timestamp: new Date(ts).toISOString(), message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });

test('verdictFor: ok / warn / halt thresholds + no-cap', () => {
  const mk = (b) => ({ last5h: { billable: b }, last7d: { billable: 0 } });
  assert.equal(verdictFor(mk(100), { per_5h_tokens: 1000 }, 80).state, 'ok');
  assert.equal(verdictFor(mk(850), { per_5h_tokens: 1000 }, 80).state, 'warn');
  assert.equal(verdictFor(mk(1000), { per_5h_tokens: 1000 }, 80).state, 'halt');
  assert.equal(verdictFor(mk(100), null, 80).state, 'ok');
});

test('budgetStatus combines both agents, honours caps + kill_switch', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');
  const recent = Math.floor((now - 3600 * 1000) / 1000);

  const cdir = mkdtempSync(join(tmpdir(), 'bg-claude-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 3600 * 1000, 800000, 100000) + '\n'); // 900k > 800k cap → halt

  const adir = mkdtempSync(join(tmpdir(), 'bg-ag-'));
  const db = new DatabaseSync(join(adir, 'c.db'));
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const b = agBlob({ input: 1000, output: 200, ts: recent });
  db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(0, b, b.length);
  db.close();

  const policy = { kill_switch: false, agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 800000, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: 800000, per_week_tokens: 6000000 } } };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, config });
  assert.equal(s.claude.state, 'halt');
  assert.equal(s.mayClaim.claude, false);
  assert.equal(s.antigravity.state, 'ok');
  assert.equal(s.mayClaim.antigravity, true);

  const killed = budgetStatus({ policy: { ...policy, kill_switch: true }, now, agentDirs: { claude: cdir, antigravity: [adir] }, config });
  assert.equal(killed.mayClaim.claude, false);
  assert.equal(killed.mayClaim.antigravity, false);
});

test('agentSessionIds harvests only the given agent\'s launched sessions', () => {
  const runs = [
    { agent: 'claude', session: 'c-1' },
    { agent: 'antigravity', session: 'a-1' },
    { agent: 'claude', session: 'c-2' },
    { agent: 'claude' },            // no session recorded → ignored
    null,                            // torn record → ignored
  ];
  assert.deepEqual([...agentSessionIds(runs, 'claude')].sort(), ['c-1', 'c-2']);
  assert.deepEqual([...agentSessionIds(runs, 'antigravity')], ['a-1']);
  assert.equal(agentSessionIds([], 'claude').size, 0);
});

// Build a project dir with a founder session (over cap) and an agent session (small). The lever,
// not the magnitudes, is under test — caps are synthetic, as in the combined test above.
function twoSessionProject({ now, cap }) {
  const cdir = mkdtempSync(join(tmpdir(), 'attr-claude-'));
  writeFileSync(join(cdir, 'founder-sess.jsonl'), claudeLine(now - 3600 * 1000, cap, 50000) + '\n'); // > cap
  writeFileSync(join(cdir, 'agent-sess.jsonl'), claudeLine(now - 3600 * 1000, 4000, 1000) + '\n');   // 5000, « cap

  const adir = mkdtempSync(join(tmpdir(), 'attr-ag-'));
  const ts = Math.floor((now - 3600 * 1000) / 1000);
  for (const [name, blob] of [['founder-conv', agBlob({ input: cap, output: 50000, ts })], ['agent-conv', agBlob({ input: 900, output: 300, ts })]]) {
    const db = new DatabaseSync(join(adir, `${name}.db`));
    db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
    db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(0, blob, blob.length);
    db.close();
  }
  return { cdir, adir };
}

test('attribution: agent_only counts only the sessions the agents launched, not the founder\'s', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  const cap = 800000;
  const { cdir, adir } = twoSessionProject({ now, cap });
  const base = { warn_pct: 80, claude: { per_5h_tokens: cap, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: cap, per_week_tokens: 6000000 } };
  const runs = [
    { agent: 'claude', session: 'agent-sess', outcome: 'ok' },
    { agent: 'antigravity', session: 'agent-conv', outcome: 'ok' },
  ];
  const opts = { now, agentDirs: { claude: cdir, antigravity: [adir] }, runs };

  // total: the founder's over-cap session is counted → both agents halt (today's behaviour)
  const total = budgetStatus({ policy: { agent_budget: { ...base, attribution: 'total' } }, ...opts, config });
  assert.equal(total.attribution, 'total');
  assert.equal(total.claude.state, 'halt');
  assert.equal(total.antigravity.state, 'halt');

  // agent_only: only the agent-launched session/conversation is counted → well under cap → ok
  const agentOnly = budgetStatus({ policy: { agent_budget: { ...base, attribution: 'agent_only' } }, ...opts, config });
  assert.equal(agentOnly.attribution, 'agent_only');
  assert.equal(agentOnly.claude.usage.last5h.billable, 5000);  // exactly the agent session, founder excluded
  assert.equal(agentOnly.claude.state, 'ok');
  assert.equal(agentOnly.mayClaim.claude, true);
  assert.equal(agentOnly.antigravity.usage.last5h.billable, 1200); // exactly the agent conversation
  assert.equal(agentOnly.antigravity.state, 'ok');
  assert.equal(agentOnly.mayClaim.antigravity, true);
});

test('attribution: agent_only with no agent runs logged ⇒ zero agent usage, never halts on founder usage', () => {
  // Reproduces the live-dashboard bug: an empty run log must NOT gate the agents on founder work.
  const now = Date.parse('2026-07-04T12:00:00Z');
  const cap = 800000;
  const { cdir, adir } = twoSessionProject({ now, cap });
  const policy = { agent_budget: { warn_pct: 80, attribution: 'agent_only', claude: { per_5h_tokens: cap, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: cap, per_week_tokens: 6000000 } } };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });
  assert.equal(s.claude.usage.last5h.billable, 0);
  assert.equal(s.claude.state, 'ok');
  assert.equal(s.mayClaim.claude, true);
  assert.equal(s.antigravity.usage.last5h.billable, 0);
  assert.equal(s.mayClaim.antigravity, true);
});

test('founder usage is exposed read-only per agent, whatever the attribution lever says', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  const cap = 800000; // founder session burns cap+50000; caps here are high so nothing halts
  const { cdir, adir } = twoSessionProject({ now, cap });
  const runs = [
    { agent: 'claude', session: 'agent-sess', outcome: 'ok' },
    { agent: 'antigravity', session: 'agent-conv', outcome: 'ok' },
  ];
  const base = { warn_pct: 80, claude: { per_5h_tokens: cap * 3 }, antigravity: { per_5h_tokens: cap * 3 } };
  const opts = { now, agentDirs: { claude: cdir, antigravity: [adir] }, runs };

  // total: gauges = founder + agent, founder stat = the founder's share alone
  const total = budgetStatus({ policy: { agent_budget: { ...base, attribution: 'total' } }, ...opts, config });
  assert.equal(total.claude.founder.last5h.billable, cap + 50000);
  assert.equal(total.claude.usage.last5h.billable, cap + 50000 + 5000);
  assert.equal(total.antigravity.founder.last5h.billable, cap + 50000);
  assert.equal(total.antigravity.usage.last5h.billable, cap + 50000 + 1200);

  // agent_only: gauges shrink to agent sessions, but the founder stat is unchanged
  const ao = budgetStatus({ policy: { agent_budget: { ...base, attribution: 'agent_only' } }, ...opts, config });
  assert.equal(ao.claude.usage.last5h.billable, 5000);
  assert.equal(ao.claude.founder.last5h.billable, cap + 50000);
  assert.equal(ao.antigravity.usage.last5h.billable, 1200);
  assert.equal(ao.antigravity.founder.last5h.billable, cap + 50000);
});

test('week_anchor + five_hour_sessions anchor the gauges to the plan cycles and expose resets', () => {
  const H = 3600 * 1000;
  const now = Date.parse('2026-07-05T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'anchor-claude-'));
  // 160h old: inside trailing-7d but BEFORE the current plan week; 1h old: inside the plan week
  writeFileSync(join(cdir, 'old.jsonl'), claudeLine(now - 160 * H, 500, 0) + '\n');
  writeFileSync(join(cdir, 'new.jsonl'), claudeLine(now - 1 * H, 40, 10) + '\n');
  const adir = mkdtempSync(join(tmpdir(), 'anchor-ag-')); // empty → no antigravity activity

  // Each platform recycles on its own clock: claude "resets in 9h", antigravity in 20h
  const cResetAt = now + 9 * H, aResetAt = now + 20 * H;
  const policy = { agent_budget: {
    warn_pct: 80, attribution: 'total', five_hour_sessions: true,
    claude: { week_anchor: new Date(cResetAt).toISOString(), per_5h_tokens: 1000000, per_week_tokens: 1000000 },
    antigravity: { week_anchor: new Date(aResetAt).toISOString(), per_5h_tokens: 1000000, per_week_tokens: 1000000 },
  } };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });

  assert.equal(s.claude.usage.last7d.billable, 50); // pre-boundary usage aged out at the plan reset
  assert.equal(s.claude.usage.last5h.billable, 50); // current 5h session = the 1h-old activity
  assert.equal(s.resets.claude_week_at, new Date(cResetAt).toISOString());
  assert.equal(s.resets.antigravity_week_at, new Date(aResetAt).toISOString()); // independent clock
  assert.equal(s.resets.claude_5h_at, new Date(now - 1 * H + 5 * H).toISOString()); // session start + 5h
  assert.equal(s.resets.antigravity_5h_at, null); // no activity → no session open

  // a top-level week_anchor still works as a shared fallback for any agent without its own
  const fb = budgetStatus({ policy: { agent_budget: { ...policy.agent_budget, claude: { per_5h_tokens: 1000000 }, week_anchor: new Date(cResetAt).toISOString() } }, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });
  assert.equal(fb.resets.claude_week_at, new Date(cResetAt).toISOString());
});

test('antigravity pools config is now INERT (§1.4): a pooled policy.agent_budget.antigravity.pools is ignored, antigravity reports one aggregate 5h+weekly verdict', () => {
  const H = 3600 * 1000;
  const now = Date.parse('2026-07-05T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'pool-claude-')); // empty
  const adir = mkdtempSync(join(tmpdir(), 'pool-ag-'));
  const db = new DatabaseSync(join(adir, 'conv.db'));
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const ins = db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)');
  const rows = [
    agBlob({ input: 900, output: 100, ts: Math.floor((now - 1 * H) / 1000), model: 'gemini-3-flash-a' }),      // 1000
    agBlob({ input: 9000, output: 1000, ts: Math.floor((now - 2 * H) / 1000), model: 'claude-sonnet-4-6' }),   // 10000
  ];
  rows.forEach((b, i) => ins.run(i, b, b.length));
  db.close();

  // A founder policy.yaml that STILL carries the old pools config (left in place per policy.yaml,
  // now dead weight) — budgetStatus must not read it at all: no gating_pool, no split by model.
  const policy = {
    agent_models: { antigravity: { default: 'gemini-3-pro' } },
    agent_budget: {
      warn_pct: 80, attribution: 'total',
      claude: { per_5h_tokens: 1000000 },
      antigravity: {
        per_5h_tokens: 5000, per_week_tokens: 20000, // one aggregate cap, no longer per-pool
        pools: {
          gemini: { match: ['gemini'], week_anchor: new Date(now + 22 * H).toISOString() },
          claude_gpt: { match: ['claude', 'gpt'], week_anchor: new Date(now + 18 * H).toISOString() },
        },
      },
    },
  };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });

  // no pool machinery survives in the output
  assert.equal(s.antigravity.gating_pool, undefined);
  assert.equal(s.antigravity.pools, undefined);
  // both generations (one gemini, one claude-family) are summed into ONE window regardless of model
  assert.equal(s.antigravity.usage.last5h.billable, 11000);
  assert.equal(s.antigravity.state, 'halt'); // 11000 >= the 5000 aggregate cap — no pool split to shield it
  assert.equal(s.mayClaim.antigravity, false);
  // the pools' own week_anchors are ignored; only a top-level antigravity.week_anchor would apply,
  // and none is set here ⇒ rolling window, no anchor
  assert.equal(s.resets.antigravity_week_at, null);
});

test('budgetStatus is uniform across an N-agent roster — no hardcoded pair assumed (§1.4)', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  // A 3rd roster agent, deepcoder, with NO budgetMeter entry ⇒ defaults to 'transcript' (same
  // reader as claude, its own dir) — proving the loop needs no special-casing per agent identity.
  const config3 = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity', 'deepcoder'], budgetMeter: { claude: 'transcript', antigravity: 'protobuf' } } });

  const cdir = mkdtempSync(join(tmpdir(), 'n-claude-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 3600 * 1000, 100, 50) + '\n'); // 150

  const adir = mkdtempSync(join(tmpdir(), 'n-ag-'));
  const db = new DatabaseSync(join(adir, 'c.db'));
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const b = agBlob({ input: 200, output: 50, ts: Math.floor((now - 3600 * 1000) / 1000) }); // 250
  db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(0, b, b.length);
  db.close();

  const ddir = mkdtempSync(join(tmpdir(), 'n-deepcoder-'));
  writeFileSync(join(ddir, 's.jsonl'), claudeLine(now - 3600 * 1000, 300, 20) + '\n'); // 320

  const policy = { agent_budget: {
    warn_pct: 80,
    claude: { per_5h_tokens: 1000000 }, antigravity: { per_5h_tokens: 1000000 }, deepcoder: { per_5h_tokens: 1000000 },
  } };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir], deepcoder: ddir }, runs: [], config: config3 });

  for (const agent of ['claude', 'antigravity', 'deepcoder']) {
    assert.ok(s[agent], `expected budgetStatus to produce an out[${agent}] entry`);
    assert.equal(typeof s.mayClaim[agent], 'boolean');
    assert.ok(`${agent}_week_at` in s.resets);
    assert.ok(`${agent}_5h_at` in s.resets);
  }
  assert.equal(s.claude.usage.last5h.billable, 150);
  assert.equal(s.antigravity.usage.last5h.billable, 250);
  assert.equal(s.deepcoder.usage.last5h.billable, 320); // deepcoder read via the DEFAULT 'transcript' meter
  assert.equal(s.mayClaim.deepcoder, true);
});

test('attribution defaults to total when the lever is absent (back-compat)', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  const cap = 800000;
  const { cdir, adir } = twoSessionProject({ now, cap });
  const s = budgetStatus({ policy: { agent_budget: { warn_pct: 80, claude: { per_5h_tokens: cap }, antigravity: { per_5h_tokens: cap } } }, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });
  assert.equal(s.attribution, 'total');
  assert.equal(s.claude.state, 'halt'); // founder session still counted with no lever set
});

// --- 1.6: opencode/third-party usage counted from the run log + per-provider breakdown ---------

const opencodeRun = ({ agent = 'claude', provider = 'deepseek', ts, totalTokens, inputTokens = 0, outputTokens = 0 }) => ({
  agent, harness: 'opencode', provider, ts: new Date(ts).toISOString(),
  usage: { inputTokens, outputTokens, totalTokens, provider, model: 'deepseek-chat' },
  tokens: totalTokens,
});

test('nonTranscriptUsage sums only non-transcript-covered-harness runs for the given agent, bucketed into 5h/week/total', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const H = 3600 * 1000;
  const runs = [
    opencodeRun({ ts: now - 1 * H, totalTokens: 100, inputTokens: 80, outputTokens: 20 }),           // in 5h + week
    opencodeRun({ ts: now - 3 * 24 * H, totalTokens: 50, inputTokens: 40, outputTokens: 10 }),        // in week only
    opencodeRun({ ts: now - 10 * 24 * H, totalTokens: 999 }),                                          // outside week — total only
    { agent: 'claude', harness: 'claude-code', provider: 'anthropic', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 5000 } }, // already transcript-covered — must be excluded
    { agent: 'antigravity', harness: 'opencode', provider: 'deepseek', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 777 } }, // wrong agent — excluded
    { agent: 'claude', harness: 'opencode', provider: 'deepseek', ts: new Date(now - 1 * H).toISOString(), usage: null },                      // genuinely unknown — never fabricated
  ];
  const u = nonTranscriptUsage(runs, { agent: 'claude', now, start5h: now - 5 * H, startWeek: now - 7 * 24 * H });
  assert.equal(u.last5h.billable, 100);
  assert.equal(u.last5h.input, 80);
  assert.equal(u.last5h.output, 20);
  assert.equal(u.last7d.billable, 150); // 100 + 50
  assert.equal(u.total.billable, 1149); // 100 + 50 + 999
  assert.equal(u.total.runs, 3);
});

test('budgetStatus folds opencode usage into the claude agent\'s gauges so third-party spend can halt it', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const cdir = mkdtempSync(join(tmpdir(), 'bg-oc-claude-')); // empty transcripts — the claude-code meter alone sees nothing
  const adir = mkdtempSync(join(tmpdir(), 'bg-oc-ag-'));
  const runs = [opencodeRun({ ts: now - 3600 * 1000, totalTokens: 900000, inputTokens: 850000, outputTokens: 50000 })]; // over an 800k cap
  const policy = { agent_budget: { warn_pct: 80, attribution: 'total', claude: { per_5h_tokens: 800000, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: 800000, per_week_tokens: 6000000 } } };

  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs, config });
  assert.equal(s.claude.usage.last5h.billable, 900000);
  assert.equal(s.claude.state, 'halt');
  assert.equal(s.mayClaim.claude, false);
  assert.equal(s.antigravity.usage.last5h.billable, 0); // opencode run belongs to claude, not antigravity
  assert.equal(s.antigravity.state, 'ok');
});

test('budgetStatus with no opencode runs logged is byte-identical to before (native Anthropic + Antigravity parity)', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');
  const recent = Math.floor((now - 3600 * 1000) / 1000);
  const cdir = mkdtempSync(join(tmpdir(), 'bg-parity-claude-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 3600 * 1000, 800000, 100000) + '\n');
  const adir = mkdtempSync(join(tmpdir(), 'bg-parity-ag-'));
  const db = new DatabaseSync(join(adir, 'c.db'));
  db.exec('CREATE TABLE gen_metadata(idx INTEGER, data BLOB, size INTEGER)');
  const b = agBlob({ input: 1000, output: 200, ts: recent });
  db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(0, b, b.length);
  db.close();

  const policy = { kill_switch: false, agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 800000, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: 800000, per_week_tokens: 6000000 } } };
  const s = budgetStatus({ policy, now, agentDirs: { claude: cdir, antigravity: [adir] }, runs: [], config });
  assert.equal(s.claude.state, 'halt');
  assert.equal(s.claude.usage.last5h.billable, 900000); // unchanged: no opencode runs to add
  assert.equal(s.antigravity.state, 'ok');
  assert.equal(s.antigravity.usage.last5h.billable, 1200);
});

test('providerBreakdown groups runs by provider, sums tokens, and buckets unknown-usage runs separately', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const H = 3600 * 1000;
  const runs = [
    { provider: 'anthropic', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 500 } },
    { provider: 'anthropic', ts: new Date(now - 2 * H).toISOString(), tokens: 300 },              // legacy field, no `usage`
    { provider: 'deepseek', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 1000 } },
    { provider: null, ts: new Date(now - 1 * H).toISOString(), tokens: null },                     // genuinely unknown provider AND tokens
    { provider: 'deepseek', ts: new Date(now - 10 * 24 * H).toISOString(), usage: { totalTokens: 999 } }, // outside a 7d window
  ];
  const all = providerBreakdown(runs, { now, config });
  assert.equal(all.anthropic.billable, 800);
  assert.equal(all.anthropic.runs, 2);
  assert.equal(all.deepseek.billable, 1999);
  assert.equal(all.unknown.runs, 1);
  assert.equal(all.unknown.unknownRuns, 1);

  const last7d = providerBreakdown(runs, { now, sinceMs: now - 7 * 24 * H, config });
  assert.equal(last7d.deepseek.billable, 1000); // the 10d-old deepseek run is excluded

  // None of the runs above carry a model + input/output split (only totalTokens/legacy tokens),
  // so cost must never be fabricated from them — every run counts toward costUnknownRuns instead.
  assert.equal(all.anthropic.cost, 0);
  assert.equal(all.anthropic.costUnknownRuns, 2);
  assert.equal(all.deepseek.costUnknownRuns, 2);
});

test('providerBreakdown prices runs that carry a full usage split (model + input/output tokens) against the given catalog', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const H = 3600 * 1000;
  const pricing = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  const runs = [
    { provider: 'anthropic', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 1_100_000, inputTokens: 1_000_000, outputTokens: 100_000, model: 'claude-sonnet-5' } },
    // same provider, a model with no catalog entry — must NOT be fabricated as $0, must count as unknown
    { provider: 'anthropic', ts: new Date(now - 1 * H).toISOString(), usage: { totalTokens: 500, inputTokens: 400, outputTokens: 100, model: 'claude-opus-4-8' } },
  ];
  const all = providerBreakdown(runs, { now, pricing });
  assert.equal(all.anthropic.cost, 2 + 1); // 1M*$2/M input + 0.1M*$10/M output
  assert.equal(all.anthropic.costUnknownRuns, 1);
  assert.equal(all.anthropic.runs, 2);
});

test('budgetStatus threads a pricing catalog into providerUsage cost fields', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const pricing = { anthropic: { 'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 } } };
  const runs = [
    { provider: 'anthropic', agent: 'claude', harness: 'claude-code', ts: new Date(now - 3600 * 1000).toISOString(), usage: { totalTokens: 1_100_000, inputTokens: 1_000_000, outputTokens: 100_000, model: 'claude-sonnet-5' } },
  ];
  const s = budgetStatus({ policy: { agent_budget: { warn_pct: 80 } }, now, agentDirs: { claude: mkdtempSync(join(tmpdir(), 'bg-pu-cost-')), antigravity: [mkdtempSync(join(tmpdir(), 'bg-pu-cost-a-'))] }, runs, pricing, config });
  assert.equal(s.providerUsage.total.anthropic.cost, 3);
});

test('budgetStatus surfaces providerUsage (last5h/last7d/total) computed from the run log', () => {
  const now = Date.parse('2026-07-05T12:00:00Z');
  const runs = [
    { provider: 'anthropic', agent: 'claude', harness: 'claude-code', ts: new Date(now - 3600 * 1000).toISOString(), usage: { totalTokens: 42 } },
    opencodeRun({ ts: now - 3600 * 1000, totalTokens: 7 }),
  ];
  const s = budgetStatus({ policy: { agent_budget: { warn_pct: 80 } }, now, agentDirs: { claude: mkdtempSync(join(tmpdir(), 'bg-pu-c-')), antigravity: [mkdtempSync(join(tmpdir(), 'bg-pu-a-'))] }, runs, config });
  assert.equal(s.providerUsage.last5h.anthropic.billable, 42);
  assert.equal(s.providerUsage.last5h.deepseek.billable, 7);
  assert.equal(s.providerUsage.total.anthropic.billable, 42);
});
