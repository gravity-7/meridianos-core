import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../launcher.mjs';
import { resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

const config = resolvePaths({ domain: FIXTURE_DOMAIN });

test('buildPrompt includes task id, title, spec, and rules', () => {
  const prompt = buildPrompt({ id: 'F-1', title: 'Build widget', status: 'ready-for-impl', spec: 'Do the thing.\nWith details.' }, { config });
  assert.ok(prompt.includes('F-1'));
  assert.ok(prompt.includes('Build widget'));
  assert.ok(prompt.includes('Do the thing.'));
  assert.ok(prompt.includes('fixture handbook'));
  assert.ok(prompt.includes('--to in-review'));
});

test('buildPrompt handles missing spec gracefully', () => {
  const prompt = buildPrompt({ id: 'F-2', title: 'No spec task' }, { config });
  assert.ok(prompt.includes('F-2'));
  assert.ok(!prompt.includes('## Spec'));
});

test('buildPrompt includes contracts when present', () => {
  const prompt = buildPrompt({ id: 'F-3', title: 'With contracts', contracts: '[{"type":"schema"}]' }, { config });
  assert.ok(prompt.includes('## Contracts'));
  assert.ok(prompt.includes('schema'));
});

test('buildPrompt for spec tasks transitions to designing', () => {
  const prompt = buildPrompt({ id: 'F-4', title: 'Spec task', status: 'spec' }, { config });
  assert.ok(prompt.includes('--to designing'));
  assert.ok(prompt.includes('Write a detailed spec'));
});

test('buildPrompt for designing tasks transitions to ready-for-impl', () => {
  const prompt = buildPrompt({ id: 'F-5', title: 'Design task', status: 'designing' }, { config });
  assert.ok(prompt.includes('--to ready-for-impl'));
  assert.ok(prompt.includes('design work'));
});

// ---- model provenance in the PR body (companion to gitIdentityEnv's commit-identity stamp) ----
test('buildPrompt hands the implement stage an exact provenance line for the PR body', () => {
  const prompt = buildPrompt(
    { id: 'F-42', title: 'Impl task', status: 'ready-for-impl' },
    { config, model: 'claude-opus-4-8', agent: 'claude' },
  );
  assert.ok(prompt.includes('## PR description'));
  assert.ok(prompt.includes('VERBATIM'), 'tells the agent to copy the line as-is');
  assert.ok(prompt.includes('model `claude-opus-4-8`'), 'the exact model is interpolated');
  assert.ok(prompt.includes('agent `claude`'));
  assert.ok(prompt.includes('task `F-42`'));
});

test('buildPrompt omits the provenance line when no model is given (byte-identical to before)', () => {
  const withModel = buildPrompt({ id: 'F-43', title: 'x', status: 'ready-for-impl' }, { config, model: 'gemini-3-pro', agent: 'antigravity' });
  const without = buildPrompt({ id: 'F-43', title: 'x', status: 'ready-for-impl' }, { config });
  assert.ok(withModel.includes('## PR description'));
  assert.ok(!without.includes('## PR description'), 'no model ⇒ no provenance block');
});

test('buildPrompt adds no PR-body provenance to non-PR stages even with a model', () => {
  // spec/designing stages never open a PR, so the footer would be nonsense there.
  for (const status of ['spec', 'designing']) {
    const prompt = buildPrompt({ id: 'F-44', title: 'x', status }, { config, model: 'claude-opus-4-8', agent: 'claude' });
    assert.ok(!prompt.includes('## PR description'), `${status} stage must not get a PR provenance line`);
  }
});

// ---- domain prompt prose (2.1c) --------------------------------------------------------------
// buildPrompt reads config.domain.prompts.implRules from the injected config, so its '## Rules'
// block is byte-identical to whatever the injected DomainPlugin's implRules say — proven here with
// FIXTURE_DOMAIN's prose (a real tenant like this repo's own tools/aios/pv-domain.mjs would
// see ITS prose flow through the exact same way).

test('buildPrompt\'s ## Rules block is byte-identical to the injected DomainPlugin\'s implRules', () => {
  const prompt = buildPrompt({ id: 'F-6', title: 'Rules snapshot', status: 'ready-for-impl' }, { config });
  const rulesBlock = prompt.slice(prompt.indexOf('## Rules'));
  assert.equal(rulesBlock, [
    '## Rules',
    ...FIXTURE_DOMAIN.prompts.implRules,
    '- Commit your work to a feature branch and open a PR',
  ].join('\n'));
});

test('buildPrompt reflects injected custom prompts and drops the previously-injected defaults', () => {
  const customConfig = resolvePaths({ domain: { prompts: { implRules: ['- Custom tenant rule'], reviewCriteria: [] } } });
  const prompt = buildPrompt({ id: 'F-7', title: 'Custom prompts task', status: 'ready-for-impl' }, { config: customConfig });
  assert.ok(prompt.includes('- Custom tenant rule'));
  assert.ok(!prompt.includes('fixture handbook'));
  assert.ok(!prompt.includes('assigned zone'));
});

// ---- injected config (DI-2) ----------------------------------------------------------------
// buildPrompt takes `config` as a REQUIRED, explicitly-injected parameter — proves a caller can
// hand it a non-default AiosConfig without any shared mutable state anywhere.

test('buildPrompt honors a non-default config passed via the `config` option', () => {
  const fakeConfig = resolvePaths({ domain: { prompts: { implRules: ['- Injected via config'], reviewCriteria: [] } } });
  const prompt = buildPrompt({ id: 'F-8', title: 'Injected config task', status: 'ready-for-impl' }, { config: fakeConfig });
  assert.ok(prompt.includes('- Injected via config'));
  assert.ok(!prompt.includes('fixture handbook'));
  // The module-level FIXTURE_DOMAIN config is untouched by the fake one above.
  assert.ok(config.domain.prompts.implRules.some((l) => l.includes('fixture handbook')));
});

// ---- configurable cliPath ---------------------------------------------------------------------
// buildPrompt sources the tenant runner CLI from config.domain.cliPath (config.mjs defaults it to
// 'tools/aios/cli.mjs') instead of hardcoding a PV-specific path — so a non-PV tenant that sets its
// own cliPath gets that path in the prompt, and the default tenant stays byte-identical.

test('buildPrompt uses a custom domain.cliPath in the transition/update-task commands, not the default', () => {
  const customConfig = resolvePaths({ domain: { ...FIXTURE_DOMAIN, cliPath: '/abs/cli.mjs' } });
  const prompt = buildPrompt({ id: 'F-9', title: 'Custom cli path task', status: 'ready-for-impl' }, { config: customConfig });
  assert.ok(prompt.includes('node /abs/cli.mjs transition'));
  assert.ok(!prompt.includes('tools/aios/cli.mjs'));
});

test('buildPrompt still uses the default tools/aios/cli.mjs path when the domain omits cliPath', () => {
  const prompt = buildPrompt({ id: 'F-10', title: 'Default cli path task', status: 'ready-for-impl' }, { config });
  assert.ok(prompt.includes('node tools/aios/cli.mjs transition'));
});

// CLI-flag-building tests moved to harness-adapters.test.mjs (buildArgs → per-harness adapters,
// 1.2). launchAgent's default-path parity (agent → harness → identical cmd/args/env) is also
// covered there, alongside worktree creation.
