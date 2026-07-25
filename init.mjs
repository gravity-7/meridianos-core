#!/usr/bin/env node
/**
 * init — scaffold a new MeridianOS tenant with zero code.
 *
 * Usage:
 *   node init.mjs [target-dir]
 *
 * Creates in the target directory:
 *   .ai/tenant.yaml      — declarative DomainPlugin (roster, prompts, budget, models)
 *   .ai/policy.yaml      — sensible default policy (budget caps, cadence, model routing)
 *   .env.example         — provider key env vars to fill in
 *   docker-compose.yml   — ready-to-run daemon + gateway
 *
 * If no target-dir is given, scaffolds into the current directory.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

const target = resolve(process.argv[2] || '.');

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║         MeridianOS — Tenant Setup            ║
╚══════════════════════════════════════════════╝
`);
  console.log(`Target: ${target}\n`);

  const name = await ask('Tenant name (e.g. "Acme Corp"): ') || 'My Tenant';
  const agentsRaw = await ask('Agent roster (comma-separated, e.g. "builder,reviewer"): ') || 'builder,reviewer';
  const agents = agentsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (agents.length === 0) { console.log('At least one agent is required.'); process.exit(1); }

  const implRules = await ask('Implementation rules prompt (or press Enter for default): ') ||
    'Write clean, well-tested code. Follow the project conventions. Write tests for all new code.';
  const reviewCriteria = await ask('Review criteria prompt (or press Enter for default): ') ||
    'Verify against acceptance criteria. Check for security issues, performance regressions, and code style.';

  console.log('\nGenerating files...\n');

  // --- .ai/tenant.yaml ---
  const tenantYaml = `# ${name} — MeridianOS tenant config
# This is a DECLARATIVE DomainPlugin — no JS code required.
# See docs/DEPLOY.md for the full schema reference.

agents: [${agents.join(', ')}]
boardTitle: "${name} AI Board"

prompts:
  implRules: |
    ${implRules}
  reviewCriteria: |
    ${reviewCriteria}

# Budget meter: which local usage store each agent reads from.
# "transcript" = Claude Code / Antigravity / OpenCode session files.
budgetMeter:
${agents.map(a => `  ${a}: transcript`).join('\n')}

# Default models per agent per tier (fallback when policy.model_routing has no entry).
defaultModels:
${agents.map(a => `  ${a}:
    simple: deepseek-chat
    standard: claude-sonnet-4-20250514
    complex: claude-sonnet-4-20250514`).join('\n')}

# Agent harness: which CLI each agent uses.
agentHarness:
${agents.map(a => `  ${a}: claude-code`).join('\n')}

# Risk taxonomy (customize for your domain).
knownRiskTags: [data-model, deploy, security, ui, api, docs]
riskToAction:
  data-model: APPROVE
  deploy: APPROVE
  security: APPROVE

# CLI path agents invoke for task transitions.
cliPath: tools/aios/cli.mjs

# Path overrides — customize where MeridianOS stores tenant artifacts.
# All paths are repo-relative. Uncomment to change from .ai/ defaults.
# paths:
#   features: docs/specs        # where feature spec.md files live
#   policy: config/policy.yaml  # budget + routing policy
#   inbox: intake/inbox         # incoming task drops
#   feedback: intake/feedback   # agent feedback artifacts
#   runs: logs/runs.jsonl       # agent run history
`;

  // --- .ai/policy.yaml ---
  const policyYaml = `# ${name} — MeridianOS policy
# Budget caps, cadence, concurrency, and model routing.

agent_budget:
  token_cap_5h: 200000
  weekly_token_cap: 7500000
  warn_pct: 80
  halt_pct: 98

cadence: hourly
max_parallel: 2
wip_per_agent: 1
lease_ttl_min: 30

# Model routing by task tier.
model_routing:
  simple:
    provider: deepseek
    model: deepseek-chat
  standard:
    provider: anthropic
    model: claude-sonnet-4-20250514
  complex:
    provider: anthropic
    model: claude-sonnet-4-20250514
  critical:
    provider: anthropic
    model: claude-sonnet-4-20250514

# Kill switch (set to true to stop all agent launches).
kill_switch: false
`;

  // --- .env.example ---
  const envExample = `# ${name} — Provider API Keys
# Copy this file to .env and fill in your keys.
# .env is gitignored — never commit it.

# DeepSeek (required for simple-tier tasks)
DEEPSEEK_KEY=sk-your-key-here

# Anthropic (required for standard+ tasks)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# OpenRouter (optional, for model diversity)
# OPENROUTER_KEY=sk-or-your-key-here

# Dashboard auth token (optional — set to protect the dashboard)
# AIOS_DASH_TOKEN=your-secret-token

# Escalation webhook (optional — Slack/Discord alerts)
# AIOS_ESCALATION_WEBHOOK=https://hooks.slack.com/...
`;

  // --- docker-compose.yml ---
  const composeYaml = `# ${name} — MeridianOS daemon + gateway
#
# Start:  docker compose up -d
# Stop:   docker compose down
# Logs:   docker compose logs -f

services:
  daemon:
    image: ghcr.io/gravity-7/meridianos-core:latest
    entrypoint: ["node", "daemon-entry.mjs"]
    ports:
      - "4317:4317"
    environment:
      - AIOS_ROOT=/tenant
      - AIOS_DASHBOARD_PORT=4317
      - DEEPSEEK_KEY
      - ANTHROPIC_API_KEY
      - OPENROUTER_KEY
      - AIOS_DASH_TOKEN
      - AIOS_ESCALATION_WEBHOOK
    volumes:
      - ./:/tenant:ro
      - daemon-state:/tenant/.ai/state
      - daemon-gateway:/tenant/.ai/gateway
    restart: unless-stopped

  gateway:
    image: ghcr.io/gravity-7/meridianos-core:latest
    ports:
      - "8787:8787"
    environment:
      - DEEPSEEK_KEY
      - ANTHROPIC_API_KEY
      - OPENROUTER_KEY
    volumes:
      - gateway-ledger:/app/.ai/gateway
      - ./:/tenant:ro
    command:
      - "--port=8787"
      - "--tenant=${name.toLowerCase().replace(/\\s+/g, '-')}"
      - "--ledger=/app/.ai/gateway/ledger.db"
      - "--policy=/tenant/.ai/policy.yaml"
      - "--provider=deepseek"
      - "--model=deepseek-chat"
    restart: unless-stopped

volumes:
  daemon-state:
  daemon-gateway:
  gateway-ledger:
`;

  // Write all files
  const aiDir = join(target, '.ai');
  mkdirSync(aiDir, { recursive: true });
  mkdirSync(join(aiDir, 'state'), { recursive: true });

  writeFileSync(join(aiDir, 'tenant.yaml'), tenantYaml, 'utf8');
  console.log('  ✓ .ai/tenant.yaml');

  writeFileSync(join(aiDir, 'policy.yaml'), policyYaml, 'utf8');
  console.log('  ✓ .ai/policy.yaml');

  writeFileSync(join(target, '.env.example'), envExample, 'utf8');
  console.log('  ✓ .env.example');

  writeFileSync(join(target, 'docker-compose.yml'), composeYaml, 'utf8');
  console.log('  ✓ docker-compose.yml');

  console.log(`
╔══════════════════════════════════════════════╗
║  Tenant scaffolded successfully!             ║
╠══════════════════════════════════════════════╣
║  Next steps:                                 ║
║  1. Copy .env.example → .env                 ║
║  2. Fill in your provider API keys in .env   ║
║  3. Review .ai/policy.yaml                   ║
║  4. docker compose up -d                     ║
╚══════════════════════════════════════════════╝
`);

  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
