import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db.mjs';
import { seedTasks, claimTask } from '../state.mjs';
import { buildStatus } from '../status.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

// This module's fixtures hardcode agent identities ('claude'/'antigravity') matching the seeded
// task owners/policy.agent_models below — status.mjs derives its agent set from
// config.domain.agents, so the injected roster here must match those literals (a per-test inline
// override of FIXTURE_DOMAIN, per the fixture-domain module's own doc comment).
const config = resolvePaths({ domain: { ...FIXTURE_DOMAIN, agents: ['claude', 'antigravity'], budgetMeter: { claude: 'transcript', antigravity: 'protobuf' } } });

const claudeLine = (ts, input, output) =>
  JSON.stringify({ timestamp: new Date(ts).toISOString(), message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });

test('buildStatus reports the active lease, queue, budget, models and policy', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');
  const iso = new Date(now).toISOString();
  const db = openDb(':memory:', config);
  seedTasks(db, { tasks: [
    { id: 'F1', title: 'admin ui', status: 'ready-for-impl', owner: 'claude', priority: 10, resources: ['a'] },
    { id: 'F2', title: 'photo tools', status: 'designing', owner: 'antigravity', priority: 20 },
    { id: 'F3', title: 'done thing', status: 'done', owner: 'claude', priority: 5 },
  ] }, { now: iso });

  assert.equal(claimTask(db, { taskId: 'F1', agent: 'claude', session: 'sess-1', now: iso }).won, true);

  const cdir = mkdtempSync(join(tmpdir(), 'st-claude-'));
  writeFileSync(join(cdir, 's.jsonl'), claudeLine(now - 3600 * 1000, 100, 50) + '\n');

  const policy = {
    agent_budget: { warn_pct: 80, claude: { per_5h_tokens: 800000, per_week_tokens: 6000000 }, antigravity: { per_5h_tokens: 800000, per_week_tokens: 6000000 } },
    agent_models: { claude: { default: 'claude-opus-4-8' }, antigravity: { default: 'gemini-3-pro' } },
  };

  const s = buildStatus({ db, now, policy, agentDirs: { claude: cdir, antigravity: [mkdtempSync(join(tmpdir(), 'st-ag-'))] }, config });

  assert.equal(s.kill_switch, false);
  assert.equal(s.agents.claude.active.task, 'F1');
  assert.equal(s.agents.claude.active.session, 'sess-1');
  assert.equal(s.agents.claude.model, 'claude-opus-4-8');
  assert.equal(s.agents.antigravity.active, null);
  assert.deepEqual(s.queue.map((q) => q.id), ['F2']); // F1 leased, F3 done → only F2 eligible
  assert.equal(s.budget.mayClaim.claude, true);
  assert.equal(s.policy.agent_models.antigravity.default, 'gemini-3-pro');
  // 1.6: per-provider usage breakdown is surfaced at the top level, mirroring budgetStatus's own
  // (values depend on the real run log's contents, so assert shape/wiring, not exact numbers).
  assert.equal(s.providerUsage, s.budget.providerUsage);
  for (const w of ['last5h', 'last7d', 'total']) assert.ok(typeof s.providerUsage[w] === 'object' && s.providerUsage[w] !== null);
});
