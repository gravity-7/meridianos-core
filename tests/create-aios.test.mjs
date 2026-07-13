/**
 * create-aios.test.mjs — unit tests for config.mjs's createAios() factory (DI-3b).
 *
 * createAios() is the public "instantiate AIOS" entrypoint composition roots (scheduler/cli/
 * dashboard) call ONCE to construct a config, then inject into every operation. It is a thin
 * wrapper over resolvePaths(); these tests prove it stays a faithful passthrough.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAios, resolvePaths } from '../config.mjs';
import { FIXTURE_DOMAIN } from './_fixture-domain.mjs';

test('createAios({domain}) returns { config } whose fields match resolvePaths({domain})', () => {
  const { config } = createAios({ domain: FIXTURE_DOMAIN });
  const expected = resolvePaths({ domain: FIXTURE_DOMAIN });
  assert.equal(config.repoRoot, expected.repoRoot);
  assert.equal(config.boardJson, expected.boardJson);
  assert.equal(config.boardMd, expected.boardMd);
  assert.equal(config.policyPath, expected.policyPath);
  assert.equal(config.runsPath, expected.runsPath);
  assert.equal(config.inboxDir, expected.inboxDir);
  assert.equal(config.feedbackDir, expected.feedbackDir);
  assert.equal(config.featuresDir, expected.featuresDir);
  assert.equal(config.secretFile, expected.secretFile);
  assert.equal(config.worktreeRoot, expected.worktreeRoot);
  assert.equal(config.pricingPath, expected.pricingPath);
  assert.equal(config.dbPath, expected.dbPath);
  assert.equal(config.defaultDbPath, expected.defaultDbPath);
  assert.deepEqual(config.domain, expected.domain);
});

test('createAios({ domain }) threads a partial DomainPlugin through to config.domain', () => {
  const { config } = createAios({ domain: { agents: ['x'] } });
  assert.deepEqual(config.domain.agents, ['x']);
});

test('createAios({ root }) threads an explicit root through to config.repoRoot', () => {
  const { config } = createAios({ root: '/tmp/z', domain: FIXTURE_DOMAIN });
  assert.equal(config.repoRoot, '/tmp/z');
});

test('createAios() with no domain throws — see config.test.mjs for the full throw-behavior coverage', () => {
  assert.throws(() => createAios(), /DomainPlugin is required/);
});
