import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGatewayInjection } from '../inject.mjs';
import { createRunRegistry } from '../run-registry.mjs';

const ctx = (overrides = {}) => ({
  tenant: 'pv', agent: 'claude', session: 's1', task: 't1', runId: 'r1',
  provider: 'anthropic', model: 'claude-sonnet-5', tier: 'medium', ...overrides,
});

test('anthropic wire: rewrites ANTHROPIC_BASE_URL/API_KEY, registers the token, preserves other env, does not mutate input plan', () => {
  const plan = { cmd: 'claude', args: ['-p', 'x'], env: { ANTHROPIC_BASE_URL: 'https://real-upstream.example.com', ANTHROPIC_API_KEY: 'sk-real-secret', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, files: [] };
  const route = { upstreamUrl: 'https://real-upstream.example.com', wire: 'anthropic', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();
  const mintToken = () => 'minted-token-1';

  const { plan: newPlan, token } = applyGatewayInjection({ plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:4999', runs, mintToken });

  assert.equal(token, 'minted-token-1');
  assert.equal(newPlan.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4999');
  assert.equal(newPlan.env.ANTHROPIC_API_KEY, 'minted-token-1');
  // Everything else in plan.env is preserved.
  assert.equal(newPlan.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  // cmd/args/files pass through unchanged.
  assert.equal(newPlan.cmd, 'claude');
  assert.deepEqual(newPlan.args, ['-p', 'x']);
  assert.deepEqual(newPlan.files, []);

  // The token was registered against the given ctx.
  assert.deepEqual(runs.resolveRun('minted-token-1'), ctx());

  // The INPUT plan itself was not mutated — the real key/URL are still there.
  assert.equal(plan.env.ANTHROPIC_BASE_URL, 'https://real-upstream.example.com');
  assert.equal(plan.env.ANTHROPIC_API_KEY, 'sk-real-secret');
});

test('anthropic wire: defaults to randomUUID when no mintToken seam is given', () => {
  const plan = { cmd: 'claude', args: [], env: {}, files: [] };
  const route = { upstreamUrl: 'https://x', wire: 'anthropic', keyEnv: null };
  const runs = createRunRegistry();

  const { token } = applyGatewayInjection({ plan, route, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:5000', runs });

  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0);
  assert.deepEqual(runs.resolveRun(token), ctx());
});

test('openai wire: rewrites opencode.json baseURL and apiKey, registers token', () => {
  const plan = { cmd: 'opencode', args: ['run'], env: { PWD: '/some/path' }, files: [{ path: 'opencode.json', content: JSON.stringify({ provider: { deepseek: { options: { baseURL: 'https://api.deepseek.com', apiKey: '{env:DEEPSEEK_KEY}' } } } }) }] };
  const route = { upstreamUrl: 'https://api.deepseek.com', wire: 'openai', keyEnv: 'DEEPSEEK_KEY' };
  const runs = createRunRegistry();
  const mintToken = () => 'openai-token-2';

  const { plan: newPlan, token } = applyGatewayInjection({ plan, route, ctx: ctx({ provider: 'deepseek' }), gatewayUrl: 'http://127.0.0.1:5001', runs, mintToken });

  assert.equal(token, 'openai-token-2');
  assert.notEqual(newPlan, plan, 'a new plan object is returned');
  const parsed = JSON.parse(newPlan.files[0].content);
  assert.equal(parsed.provider.deepseek.options.baseURL, 'http://127.0.0.1:5001');
  assert.equal(parsed.provider.deepseek.options.apiKey, 'openai-token-2');
  assert.deepEqual(runs.resolveRun('openai-token-2'), ctx({ provider: 'deepseek' }));
  // Input plan not mutated
  assert.equal(JSON.parse(plan.files[0].content).provider.deepseek.options.baseURL, 'https://api.deepseek.com');
});

test('a route with no wire (e.g. null/missing) also passes the plan through unchanged', () => {
  const plan = { cmd: 'claude', args: [], env: {}, files: [] };
  const runs = createRunRegistry();

  const { plan: newPlan, token } = applyGatewayInjection({ plan, route: null, ctx: ctx(), gatewayUrl: 'http://127.0.0.1:5002', runs });

  assert.equal(token, null);
  assert.equal(newPlan, plan);
});
