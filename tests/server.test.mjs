import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPolicyUpdates } from '../dashboard/server.mjs';
import { parseYaml } from '../yaml-lite.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

const SAMPLE = `kill_switch: false
agent_budget:
  warn_pct: 80
auto_merge: founder_only
`;

test('applyPolicyUpdates writes whitelisted lever paths', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'srv-')), 'policy.yaml');
  writeFileSync(p, SAMPLE);
  const r = applyPolicyUpdates({ kill_switch: true, auto_merge: 'peer_agent_review' }, { path: p, config });
  assert.deepEqual(r.wrote.sort(), ['auto_merge', 'kill_switch']);
  const y = parseYaml(readFileSync(p, 'utf8'));
  assert.equal(y.kill_switch, true);
  assert.equal(y.auto_merge, 'peer_agent_review');
});

test('applyPolicyUpdates rejects a path outside the lever set (never writes it)', () => {
  assert.throws(() => applyPolicyUpdates({ version: 9 }), /not allowed/);
  assert.throws(() => applyPolicyUpdates('nope'), /expected an object/);
});
