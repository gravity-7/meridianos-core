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

// CLI-flag-building tests moved to harness-adapters.test.mjs (buildArgs → per-harness adapters,
// 1.2). launchAgent's default-path parity (agent → harness → identical cmd/args/env) is also
// covered there, alongside worktree creation.
