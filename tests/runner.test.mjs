import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { upsertTask, getTask, transition } from '../state.mjs';
import { readRuns } from '../runlog.mjs';
import { cadenceMs, quietHoursStatus, runnerStatus, planRun, executeRun } from '../runner.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// This module's fixtures hardcode agent identities ('claude'/'antigravity') matching the
// runner/watchdog/bus modules' own per-agent shaped objects (budget.claude, hs.agents.claude,
// etc.) — those modules derive their agent set from config.domain.agents, so the injected
// roster here must match the fixture literals below (a per-test inline override of
// FIXTURE_DOMAIN, per the fixture-domain module's own doc comment).
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'] } });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'claude', status: 'ready-for-impl', priority: 10, ...o });
// local-clock instant (TZ-safe: getHours() on a locally-built Date is stable regardless of TZ)
const localAt = (h, m = 0) => new Date(2026, 6, 4, h, m, 0).getTime();

const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  agent_budget: { auto_downgrade_at_warn: false },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30, max_runs_per_5h: 8 },
  schedule: { cadence: 'every_30m' },
  quiet_hours: { enabled: false },
  ...over,
});
const budget = (over = {}) => ({ kill_switch: false, claude: { state: 'ok' }, antigravity: { state: 'ok' }, mayClaim: { claude: true, antigravity: true }, ...over });

test('cadenceMs maps known cadences; event/manual → null', () => {
  assert.equal(cadenceMs('every_30m'), 30 * 60 * 1000);
  assert.equal(cadenceMs('hourly'), 60 * 60 * 1000);
  assert.equal(cadenceMs('on_handoff'), null);
  assert.equal(cadenceMs('off'), null);
});

test('quietHoursStatus handles a normal and a wrap-around window', () => {
  const p = policy({ quiet_hours: { enabled: true, from: '01:00', to: '07:00' } });
  assert.equal(quietHoursStatus(p, localAt(3)).sleepingNow, true);
  assert.equal(quietHoursStatus(p, localAt(9)).sleepingNow, false);
  const wrap = policy({ quiet_hours: { enabled: true, from: '23:00', to: '07:00' } });
  assert.equal(quietHoursStatus(wrap, localAt(2)).sleepingNow, true);
  assert.equal(quietHoursStatus(wrap, localAt(12)).sleepingNow, false);
  assert.equal(quietHoursStatus(policy(), localAt(2)).sleepingNow, false); // disabled
});

test('runnerStatus reports the holdReason for each gate', () => {
  const base = { policy: policy(), now: localAt(12), runs: [], config };
  assert.equal(runnerStatus({ ...base, budget: budget({ kill_switch: true }) }).holdReason, 'kill_switch');
  assert.equal(runnerStatus({ ...base, policy: policy({ quiet_hours: { enabled: true, from: '11:00', to: '13:00' } }), budget: budget() }).holdReason, 'quiet_hours');
  assert.equal(runnerStatus({ ...base, budget: budget({ mayClaim: { claude: false, antigravity: false } }) }).holdReason, 'budget_halt');
  // max_runs: 8 real runs already in the window
  const many = Array.from({ length: 8 }, (_, i) => ({ ts: new Date(localAt(12) - i * 60000).toISOString(), outcome: 'ok' }));
  assert.equal(runnerStatus({ ...base, budget: budget(), runs: many }).holdReason, 'max_runs');
  assert.equal(runnerStatus({ ...base, budget: budget() }).holdReason, null); // all clear
});

test('planRun fires with a claimable decision, and not when held', () => {
  const db = freshDb([impl()]);
  const ok = planRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], config });
  assert.equal(ok.fire, true);
  assert.equal(ok.decisions.find((d) => d.agent === 'claude').task.id, 'F-impl');
  const held = planRun({ db, policy: policy(), budget: budget({ kill_switch: true }), now: localAt(12), runs: [], config });
  assert.equal(held.fire, false);
  assert.equal(held.reason, 'kill_switch');
});

test('planRun reports nothing_to_claim when no task is eligible', () => {
  const p = planRun({ db: freshDb([]), policy: policy(), budget: budget(), now: localAt(12), runs: [], config });
  assert.equal(p.fire, false);
  assert.equal(p.reason, 'nothing_to_claim');
});

test('executeRun without a launcher is a dry run — nothing claimed or logged', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const r = await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, config });
  assert.equal(r.fired, false);
  assert.equal(r.reason, 'dry_run');
  assert.equal(r.plan[0].task.id, 'F-impl');
  assert.equal(getTask(db, 'F-impl').lease_session, null); // not claimed
  assert.equal(readRuns({ path: runsPath }).length, 0); // nothing written
});

test('executeRun with a launcher claims the task and logs the run', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const launched = [];
  // A real agent transitions the task as it works; the runner treats "exited ok but did NOT
  // transition" as a failure (and releases the lease), so the mock must move the task forward.
  const launch = (ctx) => { launched.push(ctx); transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'claude' }); return { outcome: 'ok', note: 'spawned', tokens: 1234 }; };
  const r = await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
  assert.equal(r.fired, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].model, 'claude-opus-4-8');
  assert.equal(getTask(db, 'F-impl').lease_owner, 'claude'); // claimed + still leased after transition
  const log = readRuns({ path: runsPath });
  assert.equal(log.length, 1);
  assert.equal(log[0].outcome, 'ok');
  assert.equal(log[0].tokens, 1234);
});

test('executeRun threads the launcher\'s usage object into the run log (1.6)', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const usage = { inputTokens: 80, outputTokens: 20, totalTokens: 100, provider: 'deepseek', model: 'deepseek-chat' };
  const launch = () => { transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'claude' }); return { outcome: 'ok', note: 'spawned', tokens: 100, usage }; };
  await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
  const log = readRuns({ path: runsPath });
  assert.deepEqual(log[0].usage, usage);
});

test('executeRun records usage=null when the launcher returns none (parity — no fabrication)', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const launch = () => { transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'claude' }); return { outcome: 'ok' }; };
  await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
  const log = readRuns({ path: runsPath });
  assert.equal(log[0].usage, null);
});

test('executeRun records a failed run when the launcher throws', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const launch = () => { throw new Error('spawn failed'); };
  const r = await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
  assert.equal(r.fired, true);
  const log = readRuns({ path: runsPath });
  assert.equal(log[0].outcome, 'failed');
  assert.match(log[0].note, /spawn failed/);
});

// --- provider/harness threading + the missing-key guard (1.4) ---------------

test('executeRun threads the resolved provider + harness into launch() and the run log (legacy default)', async () => {
  const db = freshDb([impl()]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const launched = [];
  const launch = (ctx) => { launched.push(ctx); transition(db, { taskId: 'F-impl', to: 'in-progress', actor: 'claude' }); return { outcome: 'ok' }; };
  const r = await executeRun({ db, policy: policy(), budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
  assert.equal(r.fired, true);
  assert.equal(launched[0].harness, 'claude-code');
  assert.equal(launched[0].provider.name, 'anthropic'); // resolved descriptor, not just a name string
  assert.equal(launched[0].tier, 'medium'); // impl() sets no complexity/risk_tags -> complexityTier() falls back to 'medium'
  const log = readRuns({ path: runsPath });
  assert.equal(log[0].provider, 'anthropic');
  assert.equal(log[0].harness, 'claude-code');
});

test('executeRun skips a task routed to a provider with an unset key — never launches, logs + warns', async () => {
  delete process.env.PV_TEST_RUNNER_KEY_UNSET;
  const db = freshDb([impl({ complexity: 1, risk_tags: [] })]);
  const runsPath = join(mkdtempSync(join(tmpdir(), 'aios-runs-')), 'log.jsonl');
  const p = policy({
    providers: { pvtest: { name: 'pvtest', baseUrl: 'https://x', wire: 'openai', keyEnv: 'PV_TEST_RUNNER_KEY_UNSET', models: { simple: 'pv-simple', medium: 'pv-med', medium_high: 'pv-med', complex: 'pv-complex', critical: 'pv-complex' } } },
    model_routing: { claude: { simple: { provider: 'pvtest' } } },
  });
  let launchCalled = false;
  const launch = () => { launchCalled = true; return { outcome: 'ok' }; };
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => { warnings.push(msg); };
  try {
    const r = await executeRun({ db, policy: p, budget: budget(), now: localAt(12), runs: [], runsPath, launch, agents: ['claude'], config });
    assert.equal(r.fired, false);
    assert.equal(launchCalled, false);
    assert.equal(getTask(db, 'F-impl').lease_session, null); // never claimed
    const log = readRuns({ path: runsPath });
    assert.equal(log.length, 1);
    assert.equal(log[0].outcome, 'skipped');
    assert.match(log[0].note, /pvtest/);
    assert.ok(warnings.some((w) => w.includes('pvtest')));
  } finally {
    console.warn = originalWarn;
  }
});
