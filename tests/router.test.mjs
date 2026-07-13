import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.mjs';
import { upsertTask, claimTask } from '../state.mjs';
import { decide, selectModel, buildCapabilityFilter } from '../router.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });
const T0 = '2026-07-03T00:00:00.000Z';
function freshDb(seed = []) {
  const db = openDb(':memory:', config);
  for (const t of seed) upsertTask(db, t, { now: T0 });
  return db;
}
const impl = (o = {}) => ({ id: 'F-impl', title: 'impl', owner: 'claude', status: 'ready-for-impl', priority: 10, ...o });
const dsgn = (o = {}) => ({ id: 'F-dsgn', title: 'design', owner: 'antigravity', status: 'designing', priority: 5, ...o });

const policy = (over = {}) => ({
  agent_models: { claude: { default: 'claude-opus-4-8', routine: 'claude-haiku-4-5' }, antigravity: { default: 'gemini-3-pro' } },
  agent_budget: { auto_downgrade_at_warn: false },
  work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30 },
  ...over,
});
const budget = (over = {}) => ({
  kill_switch: false,
  claude: { state: 'ok' }, antigravity: { state: 'ok' },
  mayClaim: { claude: true, antigravity: true },
  ...over,
});

test('happy path: returns the eligible task, default model, and ttl', () => {
  const db = freshDb([impl()]);
  const d = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, true);
  assert.equal(d.task.id, 'F-impl');
  assert.equal(d.model, 'claude-opus-4-8');
  assert.equal(d.ttlMs, 30 * 60 * 1000);
});

test('happy path (no model_routing at all) resolves to native anthropic + the agent\'s own harness', () => {
  const db = freshDb([impl()]);
  const d = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.provider, 'anthropic');
  assert.equal(d.harness, 'claude-code');
  const da = decide(freshDb([dsgn({ owner: 'both' })]), { agent: 'antigravity', policy: policy(), budget: budget(), config });
  assert.equal(da.provider, 'anthropic');
  assert.equal(da.harness, 'antigravity');
});

test('kill switch denies all claims', () => {
  const d = decide(freshDb([impl()]), { agent: 'claude', policy: policy(), budget: budget({ kill_switch: true }), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'kill_switch');
});

test('budget halt denies claims', () => {
  const d = decide(freshDb([impl()]), { agent: 'claude', policy: policy(), budget: budget({ mayClaim: { claude: false }, claude: { state: 'halt' } }), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'budget_halt');
});

test('auto-downgrade picks the routine model at warn; default otherwise', () => {
  const db = freshDb([impl()]);
  const warnPolicy = policy({ agent_budget: { auto_downgrade_at_warn: true } });
  assert.equal(decide(db, { agent: 'claude', policy: warnPolicy, budget: budget({ claude: { state: 'warn' } }), config }).model, 'claude-haiku-4-5');
  // flag off → stay on default even at warn
  assert.equal(decide(db, { agent: 'claude', policy: policy(), budget: budget({ claude: { state: 'warn' } }), config }).model, 'claude-opus-4-8');
});

test('max_parallel blocks new claims when the system is saturated', () => {
  const db = freshDb([impl(), impl({ id: 'F-2' }), dsgn()]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1' });
  claimTask(db, { taskId: 'F-2', agent: 'claude', session: 's2' });
  const d = decide(db, { agent: 'antigravity', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'max_parallel');
});

test('wip_per_agent blocks a second concurrent task for one agent', () => {
  const db = freshDb([impl(), impl({ id: 'F-2' })]);
  claimTask(db, { taskId: 'F-impl', agent: 'claude', session: 's1' });
  const d = decide(db, { agent: 'claude', policy: policy({ work: { max_parallel: 5, wip_per_agent: 1, priority_floor: 999, lease_ttl_min: 30 } }), budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'wip_per_agent');
});

test('priority_floor rejects tasks above the floor number', () => {
  const db = freshDb([impl({ priority: 70 })]);
  const d = decide(db, { agent: 'claude', policy: policy({ work: { max_parallel: 2, wip_per_agent: 1, priority_floor: 10, lease_ttl_min: 30 } }), budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'below_priority_floor');
});

test('no eligible task is reported', () => {
  const d = decide(freshDb([]), { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'no_eligible_task');
});

test('selectModel: downgrade only at warn with the flag on', () => {
  const p = policy({ agent_budget: { auto_downgrade_at_warn: true } });
  assert.equal(selectModel(p, 'claude', 'ok'), 'claude-opus-4-8');
  assert.equal(selectModel(p, 'claude', 'warn'), 'claude-haiku-4-5');
  assert.equal(selectModel(p, 'antigravity', 'warn'), 'gemini-3-pro'); // no routine → default
});

// --- capability_matrix tests -------------------------------------------------

test('buildCapabilityFilter returns null when no matrix exists (backward compatible)', () => {
  assert.equal(buildCapabilityFilter('claude', {}), null);
  assert.equal(buildCapabilityFilter('antigravity', { capability_matrix: null }), null);
});

test('capability_matrix blocks an agent from claiming a task with an exclusive risk_tag', () => {
  const db = freshDb([impl({ risk_tags: ['money-math'] })]);
  const p = policy({ capability_matrix: { 'money-math': ['claude'] }, work_stealing: true });
  // Claude can claim money-math
  const dc = decide(db, { agent: 'claude', policy: p, budget: budget(), config });
  assert.equal(dc.mayClaim, true);
  assert.equal(dc.task.id, 'F-impl');
  // Antigravity is blocked by the matrix
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, false);
  assert.equal(da.reason, 'no_eligible_task');
});

test('capability_matrix allows shared categories for both agents', () => {
  const db = freshDb([impl({ id: 'F-test', risk_tags: ['testing'], owner: 'both' })]);
  const p = policy({ capability_matrix: { testing: ['antigravity', 'claude'] }, work_stealing: true });
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, true);
  assert.equal(da.task.id, 'F-test');
});

test('work_stealing=false blocks antigravity from claiming claude-owned tasks', () => {
  const db = freshDb([impl({ owner: 'claude', risk_tags: ['backend'] })]);
  const p = policy({ capability_matrix: { backend: ['claude', 'antigravity'] }, work_stealing: false });
  // Claude can claim its own task
  const dc = decide(db, { agent: 'claude', policy: p, budget: budget(), config });
  assert.equal(dc.mayClaim, true);
  // Antigravity blocked: owner mismatch + no work_stealing
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, false);
});

test('work_stealing=true lets antigravity claim claude-owned tasks allowed by matrix', () => {
  const db = freshDb([impl({ owner: 'claude', risk_tags: ['backend'] })]);
  const p = policy({ capability_matrix: { backend: ['claude', 'antigravity'] }, work_stealing: true });
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, true);
  assert.equal(da.task.id, 'F-impl');
});

test('tasks with no risk_tags pass the capability filter (open to any agent)', () => {
  const db = freshDb([impl({ owner: 'both', risk_tags: [] })]);
  const p = policy({ capability_matrix: { 'money-math': ['claude'] }, work_stealing: true });
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, true);
});

test('antigravity can claim ready-for-impl tasks (expanded CLAIMABLE)', () => {
  const db = freshDb([impl({ owner: 'both', risk_tags: ['testing'] })]);
  const p = policy({ capability_matrix: { testing: ['antigravity', 'claude'] } });
  const da = decide(db, { agent: 'antigravity', policy: p, budget: budget(), config });
  assert.equal(da.mayClaim, true);
  assert.equal(da.task.status, 'ready-for-impl');
});

test('claude can claim spec tasks for spec-writing', () => {
  const db = freshDb([{ id: 'F-spec', title: 'needs spec', owner: 'claude', status: 'spec', priority: 10 }]);
  const dc = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(dc.mayClaim, true);
  assert.equal(dc.task.status, 'spec');
});

test('both agents can claim designing tasks', () => {
  const db = freshDb([dsgn({ owner: 'both' })]);
  const dc = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  const da = decide(db, { agent: 'antigravity', policy: policy(), budget: budget(), config });
  assert.equal(dc.mayClaim, true);
  assert.equal(da.mayClaim, true);
});

// --- provider/harness routing + the missing-key cost-safety guard (1.4) -----

test('object-form model_routing threads provider + harness through decide()', () => {
  process.env.PV_TEST_ROUTER_KEY = 'sk-fake';
  try {
    const db = freshDb([impl({ complexity: 1, risk_tags: [] })]);
    const p = policy({
      providers: { pvtest: { name: 'pvtest', baseUrl: 'https://x', wire: 'openai', keyEnv: 'PV_TEST_ROUTER_KEY', models: { simple: 'pv-simple', medium: 'pv-med', medium_high: 'pv-med', complex: 'pv-complex', critical: 'pv-complex' } } },
      model_routing: { claude: { simple: { provider: 'pvtest' } } },
    });
    const d = decide(db, { agent: 'claude', policy: p, budget: budget(), config });
    assert.equal(d.mayClaim, true);
    assert.equal(d.provider, 'pvtest');
    assert.equal(d.model, 'pv-simple');
    assert.equal(d.harness, 'opencode');
  } finally {
    delete process.env.PV_TEST_ROUTER_KEY;
  }
});

test('missing key: default (skip) denies the claim without falling back to anthropic', () => {
  delete process.env.PV_TEST_ROUTER_KEY_UNSET;
  const db = freshDb([impl({ complexity: 1, risk_tags: [] })]);
  const p = policy({
    providers: { pvtest: { name: 'pvtest', baseUrl: 'https://x', wire: 'openai', keyEnv: 'PV_TEST_ROUTER_KEY_UNSET', models: { simple: 'pv-simple', medium: 'pv-med', medium_high: 'pv-med', complex: 'pv-complex', critical: 'pv-complex' } } },
    model_routing: { claude: { simple: { provider: 'pvtest' } } },
  });
  const d = decide(db, { agent: 'claude', policy: p, budget: budget(), config });
  assert.equal(d.mayClaim, false);
  assert.equal(d.reason, 'missing_key:pvtest');
  assert.equal(d.task.id, 'F-impl'); // still named, so the runner can log which task was skipped
});

test('missing key: on_missing_key="fallback_anthropic" explicitly opts into the fallback', () => {
  delete process.env.PV_TEST_ROUTER_KEY_UNSET2;
  const db = freshDb([impl({ complexity: 1, risk_tags: [] })]);
  const p = policy({
    providers: { pvtest: { name: 'pvtest', baseUrl: 'https://x', wire: 'openai', keyEnv: 'PV_TEST_ROUTER_KEY_UNSET2', models: { simple: 'pv-simple', medium: 'pv-med', medium_high: 'pv-med', complex: 'pv-complex', critical: 'pv-complex' } } },
    model_routing: { claude: { simple: { provider: 'pvtest' } }, on_missing_key: 'fallback_anthropic' },
  });
  const d = decide(db, { agent: 'claude', policy: p, budget: budget(), config });
  assert.equal(d.mayClaim, true);
  assert.equal(d.provider, 'anthropic');
  assert.equal(d.harness, 'claude-code');
  assert.match(d.modelReason, /fallback_anthropic/);
});

test('missing key never fires for native anthropic (keyEnv: null is always present)', () => {
  const db = freshDb([impl()]);
  const d = decide(db, { agent: 'claude', policy: policy(), budget: budget(), config });
  assert.equal(d.mayClaim, true);
});

test('budget-warn downgrade still applies with object-form provider routing', () => {
  process.env.PV_TEST_ROUTER_KEY3 = 'sk-fake';
  try {
    const db = freshDb([impl({ complexity: 5, risk_tags: [] })]);
    const p = policy({
      agent_budget: { auto_downgrade_at_warn: true },
      providers: { pvtest: { name: 'pvtest', baseUrl: 'https://x', wire: 'openai', keyEnv: 'PV_TEST_ROUTER_KEY3', models: { simple: 'pv-simple', medium: 'pv-med', medium_high: 'pv-medhigh', complex: 'pv-complex', critical: 'pv-crit' } } },
      model_routing: { claude: { complex: { provider: 'pvtest' }, medium_high: { provider: 'pvtest' } } },
    });
    const d = decide(db, { agent: 'claude', policy: p, budget: budget({ claude: { state: 'warn' } }), config });
    assert.equal(d.mayClaim, true);
    assert.equal(d.modelTier, 'medium_high'); // complex → medium_high (budget warn)
    assert.equal(d.model, 'pv-medhigh');
  } finally {
    delete process.env.PV_TEST_ROUTER_KEY3;
  }
});
