import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, parseScalar } from '../yaml-lite.mjs';

test('parseScalar covers the policy scalar types', () => {
  assert.equal(parseScalar('42'), 42);
  assert.equal(parseScalar('3.14'), 3.14);
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('false'), false);
  assert.equal(parseScalar(''), null);
  assert.equal(parseScalar('null'), null);
  assert.equal(parseScalar('"quoted"'), 'quoted');
  assert.equal(parseScalar('bare words'), 'bare words');
  assert.deepEqual(parseScalar('[a, b, 3]'), ['a', 'b', 3]);
  assert.deepEqual(parseScalar('[]'), []);
});

test('parseYaml handles nested maps + whole-line and trailing comments', () => {
  const y = parseYaml(`
# whole-line comment
version: 1
kill_switch: false
agent_budget:
  warn_pct: 80   # trailing comment
  claude:
    per_5h_tokens: 800000
    per_week_tokens: 6000000
  antigravity:
    per_5h_tokens: 700000
`);
  assert.equal(y.version, 1);
  assert.equal(y.kill_switch, false);
  assert.equal(y.agent_budget.warn_pct, 80);
  assert.equal(y.agent_budget.claude.per_5h_tokens, 800000);
  assert.equal(y.agent_budget.claude.per_week_tokens, 6000000);
  assert.equal(y.agent_budget.antigravity.per_5h_tokens, 700000);
});

test('the committed .ai/policy.yaml stays inside the subset and parses correctly', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const p = parseYaml(readFileSync(join(repoRoot, '.ai', 'policy.yaml'), 'utf8'));
  assert.equal(p.version, 1);
  assert.equal(p.kill_switch, false);
  // budget caps are founder-tunable from the dashboard — assert shape, not exact token magnitudes
  const posNum = (v) => Number.isFinite(v) && v > 0;
  for (const agent of ['claude', 'antigravity']) {
    const b = p.agent_budget[agent];
    assert.ok(posNum(b.per_5h_tokens) && posNum(b.per_week_tokens),
      `${agent} budget caps should all be positive numbers`);
  }
});
