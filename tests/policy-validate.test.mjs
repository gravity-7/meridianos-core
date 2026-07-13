import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy, applyDottedUpdates } from '../policy-validate.mjs';

const base = () => ({
  agent_budget: { warn_pct: 90, per_task_tokens: 300000, attribution: 'agent_only' },
  agent_models: { claude: { default: 'claude-sonnet-5', routine: 'claude-haiku-4-5' } },
  work: { max_parallel: 2, wip_per_agent: 2, priority_floor: 999, lease_ttl_min: 30, max_runs_per_5h: 20 },
  schedule: { cadence: 'every_15m' },
  quiet_hours: { enabled: false, from: '01:00', to: '07:00' },
  sensitive_actions: { deploy: 'block_and_ask', external_send: 'allow', spend_money: 'block_and_ask', schema_change: 'block_and_ask' },
  auto_merge: 'peer_agent_review',
});

test('a coherent policy passes with no errors', () => {
  const v = validatePolicy(base());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('WIP above the global parallel cap is a hard error', () => {
  const p = base(); p.work.wip_per_agent = 5;
  const v = validatePolicy(p);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /wip_per_agent.*exceeds.*max_parallel/);
});

test('unknown cadence, bad enum, and out-of-range warn_pct are errors', () => {
  const p = base();
  p.schedule.cadence = 'every_7m';
  p.auto_merge = 'yolo';
  p.agent_budget.warn_pct = 150;
  const v = validatePolicy(p);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 3);
});

test('routine costlier than default and attribution:total are warnings, not errors', () => {
  const p = base();
  p.agent_models.claude = { default: 'claude-haiku-4-5', routine: 'claude-sonnet-5' }; // the postmortem inversion
  p.agent_budget.attribution = 'total';
  const v = validatePolicy(p);
  assert.equal(v.ok, true); // legal, just unwise
  assert.equal(v.warnings.length, 2);
  assert.match(v.warnings.join(), /routine .* pricier than default/);
});

test('applyDottedUpdates merges onto a clone without mutating the source', () => {
  const p = base();
  const merged = applyDottedUpdates(p, { 'work.wip_per_agent': 9, 'schedule.cadence': 'hourly' });
  assert.equal(merged.work.wip_per_agent, 9);
  assert.equal(merged.schedule.cadence, 'hourly');
  assert.equal(p.work.wip_per_agent, 2); // original untouched
});
