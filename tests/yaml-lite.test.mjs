import { test } from 'node:test';
import assert from 'node:assert/strict';
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
