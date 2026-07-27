/**
 * inject-openai.test.mjs — OpenAI wire injection tests for Phase 0 (P0-F1.2)
 *
 * Tests that applyGatewayInjection() correctly rewrites OpenCode spawn plans
 * when the wire is 'openai'. OpenCode uses a file-based config (opencode.json)
 * with baseURL and apiKey fields — unlike Claude Code's env-var-based approach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGatewayInjection } from '../inject.mjs';
import { createRunRegistry } from '../run-registry.mjs';

const ctx = (overrides = {}) => ({
  tenant: 'pv', agent: 'builder', session: 's1', task: 't1', runId: 'r1',
  provider: 'deepseek', model: 'deepseek-chat', tier: 'medium', ...overrides,
});

const opencodePlan = (baseURL = 'https://api.deepseek.com', apiKey = '{env:DEEPSEEK_KEY}') => ({
  cmd: 'opencode',
  args: ['-p', 'build feature X'],
  env: { PWD: '/some/path' },
  files: [
    { path: 'opencode.json', content: JSON.stringify({ provider: { deepseek: { options: { baseURL, apiKey } } } }) },
    { path: 'other-config.json', content: JSON.stringify({ key: 'value' }) },
  ],
});

test('openai wire: rewrites opencode.json baseURL and apiKey, registers token, preserves other files', () => {
  const plan = opencodePlan();
  const route = { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();
  const mintToken = () => 'openai-token-1';

  const { plan: newPlan, token } = applyGatewayInjection({
    plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:8787', runs, mintToken,
  });

  assert.equal(token, 'openai-token-1');
  assert.notEqual(newPlan, plan, 'a new plan object is returned');

  // opencode.json should be rewritten
  const opencodeFile = newPlan.files.find(f => f.path === 'opencode.json');
  assert.ok(opencodeFile, 'opencode.json still exists in files');
  const parsed = JSON.parse(opencodeFile.content);
  assert.equal(parsed.provider.deepseek.options.baseURL, 'http://127.0.0.1:8787');
  assert.equal(parsed.provider.deepseek.options.apiKey, 'openai-token-1');

  // Other files should be preserved
  const otherFile = newPlan.files.find(f => f.path === 'other-config.json');
  assert.ok(otherFile, 'other-config.json preserved');
  assert.equal(JSON.parse(otherFile.content).key, 'value');

  // Token was registered
  assert.deepEqual(runs.resolveRun('openai-token-1'), ctx());

  // The INPUT plan was not mutated
  assert.equal(JSON.parse(plan.files[0].content).provider.deepseek.options.baseURL, 'https://api.deepseek.com');
  assert.equal(JSON.parse(plan.files[0].content).provider.deepseek.options.apiKey, '{env:DEEPSEEK_KEY}');
});

test('openai wire: defaults to randomUUID when no mintToken seam', () => {
  const plan = opencodePlan();
  const route = { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();

  const { token } = applyGatewayInjection({
    plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:8787', runs,
  });

  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0);
  assert.deepEqual(runs.resolveRun(token), ctx());
});

test('openai wire: plan without opencode.json passes through unchanged (defensive)', () => {
  const plan = { cmd: 'opencode', args: [], env: {}, files: [] };
  const route = { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();

  const { plan: newPlan, token } = applyGatewayInjection({
    plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:8787', runs,
  });

  // Safe default: pass through unchanged
  assert.equal(token, null);
  assert.equal(newPlan, plan);
});

test('openai wire: cmd/args/env pass through unchanged', () => {
  const plan = opencodePlan();
  const route = { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();

  const { plan: newPlan } = applyGatewayInjection({
    plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:8787', runs,
  });

  assert.equal(newPlan.cmd, 'opencode');
  assert.deepEqual(newPlan.args, ['-p', 'build feature X']);
  assert.equal(newPlan.env.PWD, '/some/path');
});
