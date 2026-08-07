import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setPolicyValue, serializeScalar, writePolicy, isAgentLeverPath } from '../policy-write.mjs';
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

// 009 — Dashboard Modernization (US1/T018): isAgentLeverPath() closes the gap where LEVER_PATHS'
// hardcoded claude/antigravity meant every agent-budget/model/routing save for any other roster
// (e.g. this repo's own current [builder, reviewer]) was silently rejected server-side despite the
// dashboard sliders rendering and looking completely normal.
test('isAgentLeverPath accepts a per-agent budget path for an agent actually in the roster', () => {
  assert.equal(isAgentLeverPath('agent_budget.builder.per_5h_tokens', ['builder', 'reviewer']), true);
  assert.equal(isAgentLeverPath('agent_budget.reviewer.per_week_tokens', ['builder', 'reviewer']), true);
  assert.equal(isAgentLeverPath('agent_models.builder.default', ['builder', 'reviewer']), true);
  assert.equal(isAgentLeverPath('model_routing.builder.complex', ['builder', 'reviewer']), true);
});

test('isAgentLeverPath rejects an agent name not in the roster (no unchecked wildcard)', () => {
  assert.equal(isAgentLeverPath('agent_budget.some-other-agent.per_5h_tokens', ['builder', 'reviewer']), false);
});

test('isAgentLeverPath rejects a non-lever path even for a real agent', () => {
  assert.equal(isAgentLeverPath('agent_budget.builder.unrelated_field', ['builder', 'reviewer']), false);
  assert.equal(isAgentLeverPath('kill_switch', ['builder', 'reviewer']), false);
});

test('isAgentLeverPath returns false with an empty or missing roster', () => {
  assert.equal(isAgentLeverPath('agent_budget.builder.per_5h_tokens', []), false);
  assert.equal(isAgentLeverPath('agent_budget.builder.per_5h_tokens', undefined), false);
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

// setPolicyValue — insert-if-missing (008 — End-User Configurability, T010)

test('setPolicyValue inserts a missing top-level scalar (e.g. active_profile) instead of throwing', () => {
  const out = setPolicyValue(SAMPLE, 'active_profile', 'prod');
  assert.equal(parseYaml(out).active_profile, 'prod');
  // every pre-existing line is untouched
  for (const line of SAMPLE.split('\n')) {
    if (line.trim() !== '') assert.ok(out.includes(line), `lost line: ${line}`);
  }
});

test('setPolicyValue inserts a missing leaf under an existing mapping as a new child', () => {
  const out = setPolicyValue(SAMPLE, 'agent_budget.nope', 1);
  const parsed = parseYaml(out);
  assert.equal(parsed.agent_budget.nope, 1);
  // existing siblings under agent_budget: are preserved
  assert.equal(parsed.agent_budget.warn_pct, 80);
  assert.equal(parsed.agent_budget.claude.per_5h_tokens, 800000);
});

test('setPolicyValue inserts a fully-missing multi-level path (e.g. gateway.port) by creating the parent mapping', () => {
  const out = setPolicyValue(SAMPLE, 'gateway.port', 4317);
  assert.equal(parseYaml(out).gateway.port, 4317);
  // untouched top-level keys still parse the same
  assert.equal(parseYaml(out).kill_switch, false);
});

test('setPolicyValue insert is idempotent-shaped: inserting then updating the same path just updates in place', () => {
  const inserted = setPolicyValue(SAMPLE, 'gateway.port', 4317);
  const updated = setPolicyValue(inserted, 'gateway.port', 9000);
  assert.equal(parseYaml(updated).gateway.port, 9000);
  // no duplicate gateway: mapping was created
  assert.equal((updated.match(/^gateway:/m) || []).length, 1);
});

// writePolicy — backup-on-write (008 — End-User Configurability, US1/FR-003)

test('writePolicy creates a policy.backup.{timestamp}.yaml snapshot of the pre-write content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-write-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath });

  const backups = readdirSync(dir).filter((f) => /^policy\.backup\..*\.yaml$/.test(f));
  assert.equal(backups.length, 1);
  // the backup holds the PRE-write content, not the new value
  const backupContent = readFileSync(join(dir, backups[0]), 'utf8');
  assert.equal(parseYaml(backupContent).kill_switch, false);
});

test('writePolicy still applies the update to the live file after backing up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-write-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath });

  assert.equal(parseYaml(readFileSync(policyPath, 'utf8')).kill_switch, true);
});

test('writePolicy backup naming generalizes to a non-"policy.yaml"-named path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-write-'));
  const policyPath = join(dir, 'my-custom-config.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath });

  const backups = readdirSync(dir).filter((f) => /^my-custom-config\.backup\..*\.yaml$/.test(f));
  assert.equal(backups.length, 1);
});

test('writePolicy creates one new backup per call (does not overwrite prior backups)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-write-'));
  const policyPath = join(dir, 'policy.yaml');
  writeFileSync(policyPath, SAMPLE);

  writePolicy({ kill_switch: true }, { path: policyPath });
  writePolicy({ auto_merge: 'peer_agent_review' }, { path: policyPath });

  const backups = readdirSync(dir).filter((f) => /^policy\.backup\..*\.yaml$/.test(f));
  assert.equal(backups.length, 2);
});
