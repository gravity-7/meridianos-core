import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPolicyValue, serializeScalar } from '../policy-write.mjs';
import { parseYaml } from '../yaml-lite.mjs';

const SAMPLE = `version: 1
kill_switch: false
agent_budget:
  warn_pct: 80          # trailing comment stays
  claude:
    per_5h_tokens: 800000
quiet_hours:
  enabled: true
  from: "01:00"
auto_merge: founder_only
`;

test('serializeScalar: bare when safe, quoted otherwise', () => {
  assert.equal(serializeScalar(true), 'true');
  assert.equal(serializeScalar(800000), '800000');
  assert.equal(serializeScalar('claude-opus-4-8'), 'claude-opus-4-8');
  assert.equal(serializeScalar('01:00'), '"01:00"'); // colon → must quote so it round-trips as a string
});

test('setPolicyValue updates a nested scalar and round-trips through parseYaml', () => {
  const out = setPolicyValue(SAMPLE, 'agent_budget.claude.per_5h_tokens', 2000000);
  assert.equal(parseYaml(out).agent_budget.claude.per_5h_tokens, 2000000);
});

test('setPolicyValue preserves the trailing comment and every other line', () => {
  const out = setPolicyValue(SAMPLE, 'agent_budget.warn_pct', 90);
  assert.match(out, /warn_pct: 90 {2,}# trailing comment stays/);
  const a = SAMPLE.split('\n'), b = out.split('\n');
  a.forEach((line, i) => { if (!line.includes('warn_pct')) assert.equal(b[i], line); });
});

test('setPolicyValue updates top-level scalars and quotes times', () => {
  assert.equal(parseYaml(setPolicyValue(SAMPLE, 'kill_switch', true)).kill_switch, true);
  assert.equal(parseYaml(setPolicyValue(SAMPLE, 'auto_merge', 'peer_agent_review')).auto_merge, 'peer_agent_review');
  assert.equal(parseYaml(setPolicyValue(SAMPLE, 'quiet_hours.from', '22:00')).quiet_hours.from, '22:00');
});

test('setPolicyValue throws on an unknown path (never reshapes the file)', () => {
  assert.throws(() => setPolicyValue(SAMPLE, 'agent_budget.nope', 1), /path not found/);
});
