import { test } from 'node:test';
import assert from 'node:assert/strict';

// There is no ambient singleton (DI-3c) — `resolvePaths()` reads `$AIOS_AGENTS` LIVE on every
// call (not baked in at module-load time), so it just needs to be set before the `resolvePaths()`
// call below, not before the `config.mjs` import itself.
// `node --test` runs each matched test file in its own process, so setting it here (before any
// import below) is safe and does not leak into other test files.
process.env.AIOS_AGENTS = 'agent-x,agent-y,agent-z';

const { resolvePaths } = await import('../config.mjs');
const { buildBusTools } = await import('../bus.mjs');
const { FIXTURE_DOMAIN } = await import('./_fixture-domain.mjs');
// AIOS_AGENTS only overrides the roster when the injected plugin ITSELF omits `agents` (an
// explicit `domain.agents` always wins — see config.test.mjs) — so this fixture deliberately
// leaves `agents` off FIXTURE_DOMAIN's other fields.
const { agents: _omitted, ...domainWithoutAgents } = FIXTURE_DOMAIN;
const config = resolvePaths({ domain: domainWithoutAgents });
const BUS_TOOLS = buildBusTools(config);

test('AIOS_AGENTS overrides the resolved config roster', () => {
  assert.deepEqual(config.domain.agents, ['agent-x', 'agent-y', 'agent-z']);
});

test('AIOS_AGENTS propagates into the bus next_task agent enum', () => {
  const nextTask = BUS_TOOLS.find((t) => t.name === 'next_task');
  assert.deepEqual(nextTask.inputSchema.properties.agent.enum, ['agent-x', 'agent-y', 'agent-z']);
});

test('AIOS_AGENTS propagates into the bus claim_task agent enum', () => {
  const claimTask = BUS_TOOLS.find((t) => t.name === 'claim_task');
  assert.deepEqual(claimTask.inputSchema.properties.agent.enum, ['agent-x', 'agent-y', 'agent-z']);
});
