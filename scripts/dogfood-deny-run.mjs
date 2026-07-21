#!/usr/bin/env node
/**
 * dogfood-deny-run.mjs — F001 implementation: produces a REAL deny row in the gateway
 * ledger against live DeepSeek API traffic. This closes the single biggest evidence gap
 * in the product: we claim inline enforcement works, but have no primary artifact of a
 * live denial against paid traffic.
 *
 * USAGE:
 *   set DEEPSEEK_KEY=sk-...
 *   node scripts/dogfood-deny-run.mjs
 *
 * WHAT IT DOES:
 *   1. Assembles the gateway with a 50-token 5h cap
 *   2. Registers a run via the run registry
 *   3. Makes TWO real HTTP calls through the gateway to DeepSeek
 *      - Turn 1: allowed (cold cap → 0 prior usage → trip-wire passes)
 *      - Turn 2: denied (prior usage ≥ 50 tokens → halt → 403)
 *   4. Queries the ledger and verifies both allow + deny rows exist
 *   5. Prints the artifact as JSON
 *
 * SAFETY:
 *   - DEEPSEEK_KEY is read from process.env, never printed or committed
 *   - Total cost: ~$0.006 (one small DeepSeek call before the deny fires)
 *   - Gateway runs on ephemeral port (0), auto-closes after test
 *   - Nothing persists to disk (ledger is :memory:)
 *
 * REQUIRES:
 *   - DEEPSEEK_KEY env var set
 *   - Node.js 24+
 */

import { randomUUID } from 'node:crypto';
import { assembleGateway } from '../gateway/index.mjs';
import { listEvents } from '../gateway/ledger.mjs';
import { loadPricing, costFor } from '../pricing.mjs';

const AGENT = 'dogfood-deny-test';
const TENANT = 'mos-dev';
const CAP_TOKENS = 1; // Smallest functional cap — 0 is a footgun (treated as "no cap"). First call always passes; second call always denied.

async function main() {
  const deepseekKey = process.env.DEEPSEEK_KEY;
  if (!deepseekKey) {
    console.error('❌ DEEPSEEK_KEY env var is required.');
    console.error('   Usage: set DEEPSEEK_KEY=sk-... && node scripts/dogfood-deny-run.mjs');
    process.exit(1);
  }
  // Set the key for the gateway to resolve at forward-time
  process.env.DEEPSEEK_KEY = deepseekKey;

  console.log('🚀 F001: Live Dogfood Deny Run');
  console.log(`   Agent: ${AGENT} | Cap: ${CAP_TOKENS} tokens/5h | Provider: DeepSeek V4 Flash\n`);

  // ── Assemble gateway with a small cap ──
  const config = { pricingPath: 'c:/projects/mos-dev/tools/aios/pricing.json' };
  const pricing = loadPricing(config.pricingPath, config);

  const policy = {
    gateway: { enabled: true, tenant: TENANT },
    providers: {
      deepseek: {
        wire: 'anthropic',
        anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
        keyEnv: 'DEEPSEEK_KEY',
        models: { simple: 'deepseek-v4-flash' },
      },
    },
    agent_budget: {
      [AGENT]: { per_5h_tokens: CAP_TOKENS },
    },
  };

  console.log('   Assembling gateway...');
  const assembled = await assembleGateway({
    config,
    policy,
    tenant: TENANT,
    ledgerPath: ':memory:',
    now: Date.now(),
  });
  console.log(`   Gateway listening at ${assembled.url}\n`);

  // ── Register a run ──
  const token = randomUUID();
  const session = randomUUID();
  const runId = randomUUID();
  assembled.runs.registerRun(token, {
    tenant: TENANT, agent: AGENT, session, task: 'DOG-1',
    runId, provider: 'deepseek', model: 'deepseek-v4-flash', tier: 'simple',
  });

  const baseUrl = assembled.url.replace(/\/$/, '');
  const body = JSON.stringify({
    model: 'deepseek-v4-flash',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Say "hello" exactly once.' }],
  });

  // ── Turn 1: Should be ALLOWED (cold cap → 0 prior usage) ──
  console.log('   Turn 1: Sending real request to DeepSeek via gateway...');
  const t1 = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  const t1Text = await t1.text();
  console.log(`   Turn 1: HTTP ${t1.status} (expected: 200)`);

  // ── Turn 2: Should be DENIED (prior usage exceeds 50-token cap) ──
  console.log('   Turn 2: Sending second request (should be denied)...');
  const t2 = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  const t2Text = await t2.text();
  const retryHeader = t2.headers.get('x-should-retry');
  console.log(`   Turn 2: HTTP ${t2.status} (expected: 403) | x-should-retry: ${retryHeader} (expected: false)`);

  // ── Query the ledger ──
  const events = listEvents(assembled.ledger, { tenant: TENANT, agent: AGENT });
  console.log(`\n   Ledger rows: ${events.length} (expected: ≥2)\n`);

  let allows = 0, denies = 0;
  for (const evt of events) {
    const marker = evt.enforcementDecision === 'deny' ? '🛑 DENY' : '✅ ALLOW';
    console.log(`   ${marker} | ${evt.inputTokens ?? '?'} in / ${evt.outputTokens ?? '?'} out | cost=$${evt.costUsd ?? '?'} | upstream=${evt.upstreamStatus ?? 'null'} | cap=${evt.capWindow ?? 'null'}`);
    if (evt.enforcementDecision === 'allow') allows++;
    if (evt.enforcementDecision === 'deny') denies++;
  }

  // ── Verify ──
  const hasAllow = allows >= 1;
  const hasDeny = denies >= 1;
  const denyRow = events.find(e => e.enforcementDecision === 'deny');
  const denyNeverForwarded = denyRow && denyRow.upstreamStatus === null;
  const allowHasCost = events.some(e => e.enforcementDecision === 'allow' && e.costUsd !== null);
  const denyHasCapWindow = denyRow && denyRow.capWindow === '5h';

  console.log(`\n─── VERIFICATION ───`);
  console.log(`   ≥1 allow row:  ${hasAllow ? '✅' : '❌'}`);
  console.log(`   ≥1 deny row:   ${hasDeny ? '✅' : '❌'}`);
  console.log(`   Deny not forwarded (upstream=null): ${denyNeverForwarded ? '✅' : '❌'}`);
  console.log(`   Allow has cost: ${allowHasCost ? '✅' : '❌'}`);
  console.log(`   Deny cap window=5h: ${denyHasCapWindow ? '✅' : '❌'}`);

  // ── Cleanup ──
  assembled.runs.unregisterRun(token);
  await assembled.close();

  // ── Compute real cost ──
  const totalCost = events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  console.log(`\n   💰 Total cost: $${totalCost.toFixed(6)}`);
  console.log(`   📋 Artifact ready for docs/gtm/artifacts/\n`);

  if (hasAllow && hasDeny && denyNeverForwarded) {
    console.log('✅ F001 COMPLETE — Live dogfood deny artifact produced.\n');
    process.exit(0);
  } else {
    console.log('❌ F001 FAILED — Check the output above for which verification failed.\n');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
