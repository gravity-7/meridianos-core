/**
 * setup-wizard — first-run interactive CLI that walks a new user through creating
 * their first .ai/policy.yaml and directory structure.
 *
 * Design principles:
 *   • Zero npm dependencies — Node built-in `readline` only
 *   • Non-blocking for headless CI: if stdin is NOT a TTY, skip prompts with a message
 *     and generate minimal defaults
 *   • Generated policy MUST pass validatePolicy() — we validate before writing
 *   • Idempotent — running twice shouldn't break anything
 *   • Under 300 lines — this is a wizard, not a framework
 *
 * Called by scheduler.mjs's start() BEFORE boot checks when .ai/policy.yaml doesn't exist.
 * Also callable standalone: `node setup-wizard.mjs`
 */

import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { validatePolicy } from './policy-validate.mjs'
import { parseYaml } from './yaml-lite.mjs'

// ═══════════════════════════════════════════════════════════════
// Prompt helpers (thin wrappers over readline)
// ═══════════════════════════════════════════════════════════════

async function ask(rl, q) {
  return new Promise(resolve => {
    rl.question(q, answer => resolve(answer.trim()))
  })
}

async function askYN(rl, q, defaultYes = true) {
  const yn = defaultYes ? '[Y/n]' : '[y/N]'
  const a = await ask(rl, `${q} ${yn}: `)
  if (a === '') return defaultYes
  return /^y/i.test(a)
}

async function askChoice(rl, prompt, options) {
  process.stdout.write(`${prompt}\n`)
  for (let i = 0; i < options.length; i++) {
    process.stdout.write(`  ${i + 1}. ${options[i]}\n`)
  }
  while (true) {
    const a = await ask(rl, `Enter number (1-${options.length}) [1]: `)
    if (a === '') return options[0]
    const n = parseInt(a, 10)
    if (n >= 1 && n <= options.length) return options[n - 1]
    process.stdout.write(`  Please enter a number between 1 and ${options.length}\n`)
  }
}

async function askMultiCheckbox(rl, prompt, options, defaults) {
  process.stdout.write(`${prompt}\n`)
  const prechecked = new Set(defaults ?? options)
  for (let i = 0; i < options.length; i++) {
    const mark = prechecked.has(options[i]) ? 'x' : ' '
    process.stdout.write(`  [${mark}] ${i + 1}. ${options[i]}\n`)
  }
  process.stdout.write('Enter numbers separated by commas, or press Enter for defaults: ')
  const a = await ask(rl, '')
  if (a === '') return [...prechecked]
  const nums = a.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n >= 1 && n <= options.length)
  if (nums.length === 0) return [...prechecked]
  return nums.map(n => options[n - 1])
}

// ═══════════════════════════════════════════════════════════════
// Banner
// ═══════════════════════════════════════════════════════════════

const BANNER = `
╔══════════════════════════════════════════════════════╗
║          ███╗   ███╗ ███████╗ ██████╗ ██╗           ║
║          ████╗ ████║ ██║     ██║   ██╗██║          ║
║          ██╔████╔██║ █████╗  ██████╔╝██║           ║
║          ██║╚██╔╝██║ ██║     ██║   ██╗██║          ║
║          ██║ ╚═╝ ██║ ███████║██║   ██║███████║     ║
║          ╚═╝     ╚═╝ ╚══════╝╚═╝   ╚═╝╚══════╝     ║
║                                                      ║
║     MeridianOS — Autonomous Agent Orchestration       ║
║              First-Run Setup Wizard                   ║
╚══════════════════════════════════════════════════════╝
`

// ═══════════════════════════════════════════════════════════════
// Policy generation
// ═══════════════════════════════════════════════════════════════

function generatePolicy({ projectName, agents, providers, gatewayEnabled, gatewayPort, cadence }) {
  const agentList = agents ?? ['builder', 'reviewer']
  const providerList = providers ?? ['deepseek', 'anthropic']

  // Build provider blocks
  let providersYaml = ''
  for (const p of providerList) {
    if (p === 'deepseek') {
      providersYaml += `  deepseek:\n    wire: anthropic\n    thinking:\n      effort: high\n`
    } else if (p === 'anthropic') {
      providersYaml += `  anthropic:\n    wire: anthropic\n`
    } else if (p === 'openrouter') {
      providersYaml += `  openrouter:\n    wire: anthropic\n`
    }
  }

  // Build model_routing: first agent gets DeepSeek, rest get Anthropic
  const primaryProvider = providerList.includes('deepseek') ? 'deepseek' : (providerList[0] ?? 'anthropic')
  const primaryModel = primaryProvider === 'deepseek' ? 'deepseek-v4-pro' : 'claude-sonnet-5'
  const fallbackProvider = providerList.length > 1 && providerList.includes('anthropic') ? 'anthropic' : primaryProvider
  const fallbackModel = fallbackProvider === 'anthropic' ? 'claude-sonnet-5' : primaryModel

  let modelRoutingYaml = ''
  for (let i = 0; i < agentList.length; i++) {
    const agent = agentList[i]
    const prov = i === 0 ? primaryProvider : fallbackProvider
    const model = i === 0 ? primaryModel : fallbackModel
    modelRoutingYaml += `  ${agent}:\n    roles:\n      impl:\n        provider: ${prov}\n        model: ${model}\n        harness: claude-code\n`
    for (const tier of ['simple', 'medium', 'medium_high', 'complex', 'critical']) {
      modelRoutingYaml += `    ${tier}:\n      provider: ${prov}\n      model: ${model}\n      harness: claude-code\n`
    }
  }

  // Build agent_budget per-agent entries
  let agentBudgetYaml = ''
  for (const agent of agentList) {
    agentBudgetYaml += `    ${agent}:\n      per_5h_tokens: 3500000\n      per_week_tokens: 14000000\n`
  }

  // Build agent_models entries
  let agentModelsYaml = ''
  for (const agent of agentList) {
    agentModelsYaml += `    ${agent}:\n      default: ${primaryModel}\n      routine: claude-haiku-4-5\n`
  }

  const gwPort = gatewayPort ?? 4317
  const gwEnabled = gatewayEnabled !== false // default true

  return `# ${projectName} — MeridianOS autonomous agent policy
# Generated by setup-wizard. Edit at any time; the dashboard can also update these values.
# Docs: https://github.com/gravity-7/meridianos-core

# ── Schedule: how often agents wake up ──
schedule:
  cadence: ${cadence ?? 'every_15m'}

# ── Gateway: metering & enforcement sidecar ──
gateway:
  enabled: ${gwEnabled}
  tenant: ${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}
  port: ${gwPort}

# ── Provider registry ──
providers:
${providersYaml}
# ── Model routing: which model each agent uses per task tier ──
model_routing:
${modelRoutingYaml}
# ── Budget: cost governance caps ──
agent_budget:
  warn_pct: 80
  per_task_tokens: 200000
  auto_downgrade_at_warn: false
  attribution: agent_only
${agentBudgetYaml}
# ── Dashboard-writable levers ──

kill_switch: false

agent_models:
${agentModelsYaml}
work:
  max_parallel: 2
  wip_per_agent: 1
  priority_floor: 999
  lease_ttl_min: 30
  max_runs_per_5h: 10

quiet_hours:
  enabled: false
  from: "22:00"
  to: "06:00"

sensitive_actions:
  deploy: block_and_ask
  external_send: block_and_ask
  spend_money: block_and_ask
  schema_change: block_and_ask

auto_merge: verifier_gated

escalation:
  channel: digest

work_stealing: false
`
}

// ═══════════════════════════════════════════════════════════════
// Directory scaffolding
// ═══════════════════════════════════════════════════════════════

function scaffoldDirs(root) {
  const dirs = [
    join(root, '.ai'),
    join(root, '.ai', 'state'),
    join(root, '.ai', 'gateway'),
    join(root, '.ai', 'logs'),
    join(root, '.ai', 'runs'),
    join(root, '.ai', 'inbox'),
    join(root, '.ai', 'feedback'),
    join(root, '.ai', 'features'),
    join(root, '.ai', 'secrets'),
  ]
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}

// ═══════════════════════════════════════════════════════════════
// Headless / CI fallback
// ═══════════════════════════════════════════════════════════════

async function runHeadless({ root, projectName }) {
  const policyYaml = generatePolicy({
    projectName: projectName ?? basename(root),
    agents: ['builder', 'reviewer'],
    providers: ['deepseek', 'anthropic'],
    gatewayEnabled: true,
    gatewayPort: 4317,
    cadence: 'every_15m',
  })

  // Validate before writing
  const parsed = parseYaml(policyYaml)
  const { ok, errors } = validatePolicy(parsed)
  if (!ok) {
    process.stderr.write('Generated policy failed validation:\n')
    for (const e of errors) process.stderr.write(`  - ${e}\n`)
    throw new Error('setup-wizard: generated policy is invalid — this is a bug')
  }

  scaffoldDirs(root)
  const policyPath = join(root, '.ai', 'policy.yaml')
  writeFileSync(policyPath, policyYaml, 'utf8')

  process.stdout.write(`\n✅ MeridianOS configured (headless mode).\n`)
  process.stdout.write(`   Policy: ${policyPath}\n`)
  process.stdout.write(`   Run meridian-gateway to start, or restart the scheduler.\n`)
}

// ═══════════════════════════════════════════════════════════════
// Interactive wizard
// ═══════════════════════════════════════════════════════════════

async function runInteractive({ root, projectName }) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    process.stdout.write(BANNER)
    process.stdout.write('\nWelcome to MeridianOS! Let\'s get you set up in 60 seconds.\n\n')

    // 1. Project name
    const name = await ask(rl, `Project name [${projectName}]: `)
    const finalName = name || projectName

    // 2. Agent roster
    const agentOptions = ['builder', 'reviewer', 'designer', 'docs-writer']
    const selectedAgents = await askMultiCheckbox(
      rl,
      'Which agents should be in your roster?',
      agentOptions,
      ['builder', 'reviewer']
    )

    // 3. LLM providers
    const providerOptions = ['DeepSeek', 'Anthropic', 'OpenRouter']
    const selectedProviders = await askMultiCheckbox(
      rl,
      'Which LLM providers do you have API keys for?',
      providerOptions,
      ['DeepSeek']
    )
    // Normalize to lowercase slugs
    const providerSlugs = selectedProviders.map(p => p.toLowerCase())

    // 4. Gateway proxy
    const useGateway = await askYN(rl, 'Enable the gateway metering proxy?', true)

    // 5. Gateway port (only ask if gateway enabled)
    let gwPort = 4317
    if (useGateway) {
      const portStr = await ask(rl, `Gateway port [4317]: `)
      const parsed = parseInt(portStr, 10)
      if (portStr && !isNaN(parsed) && parsed > 0 && parsed < 65536) gwPort = parsed
    }

    // 6. Cadence
    const cadenceOptions = ['every_15m', 'every_30m', 'hourly']
    const cadence = await askChoice(rl, 'How often should agents wake up?', cadenceOptions)

    // ── Generate and validate ──
    process.stdout.write('\nGenerating your policy...\n')
    const policyYaml = generatePolicy({
      projectName: finalName,
      agents: selectedAgents,
      providers: providerSlugs,
      gatewayEnabled: useGateway,
      gatewayPort: gwPort,
      cadence,
    })

    // Validate
    const parsed = parseYaml(policyYaml)
    const { ok, errors, warnings } = validatePolicy(parsed)
    if (!ok) {
      process.stderr.write('\n❌ Generated policy failed validation:\n')
      for (const e of errors) process.stderr.write(`   Error: ${e}\n`)
      process.stderr.write('\nThis is a bug — please report it.\n')
      process.exit(1)
    }
    if (warnings.length > 0) {
      process.stdout.write('\n⚠️  Warnings:\n')
      for (const w of warnings) process.stdout.write(`   ${w}\n`)
    }

    // Write
    scaffoldDirs(root)
    const policyPath = join(root, '.ai', 'policy.yaml')
    writeFileSync(policyPath, policyYaml, 'utf8')

    // ── Summary ──
    process.stdout.write(`\n╔══════════════════════════════════════════════════════╗\n`)
    process.stdout.write(`║  ✅  MeridianOS is ready!                           ║\n`)
    process.stdout.write(`╠══════════════════════════════════════════════════════╣\n`)
    process.stdout.write(`║  Project:    ${finalName.padEnd(42)}║\n`)
    process.stdout.write(`║  Agents:     ${selectedAgents.join(', ').padEnd(42)}║\n`)
    process.stdout.write(`║  Providers:  ${providerSlugs.join(', ').padEnd(42)}║\n`)
    process.stdout.write(`║  Gateway:    ${(useGateway ? `enabled (:${gwPort})` : 'disabled').padEnd(42)}║\n`)
    process.stdout.write(`║  Cadence:    ${cadence.padEnd(42)}║\n`)
    process.stdout.write(`║  Config:     .ai/policy.yaml                        ║\n`)
    process.stdout.write(`╠══════════════════════════════════════════════════════╣\n`)
    process.stdout.write(`║  Next steps:                                        ║\n`)
    process.stdout.write(`║  1. Add your API keys to a .env file or environment ║\n`)
    process.stdout.write(`║     (DEEPSEEK_KEY, ANTHROPIC_KEY, etc.)             ║\n`)
    if (useGateway) {
      process.stdout.write(`║  2. Run: npx meridian-gateway                       ║\n`)
      process.stdout.write(`║  3. Restart the scheduler to begin autonomous work  ║\n`)
    } else {
      process.stdout.write(`║  2. Restart the scheduler to begin autonomous work  ║\n`)
    }
    process.stdout.write(`╚══════════════════════════════════════════════════════╝\n\n`)
  } finally {
    rl.close()
  }
}

// ═══════════════════════════════════════════════════════════════
// Public entrypoint
// ═══════════════════════════════════════════════════════════════

/**
 * Run the setup wizard if needed. Returns `true` if setup was performed (and
 * the caller should exit(0) so the user can restart), `false` if already configured.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]        — project root directory (default cwd)
 * @param {string} [opts.projectName] — project name (default basename of root)
 * @returns {Promise<boolean>} true if wizard ran, false if already set up
 */
export async function runSetupWizard({ root = process.cwd() } = {}) {
  const policyPath = join(root, '.ai', 'policy.yaml')
  const projectName = basename(root)

  // Already configured — nothing to do
  if (existsSync(policyPath)) {
    return false
  }

  const isTTY = process.stdin.isTTY && process.stdout.isTTY

  if (!isTTY) {
    // Headless / CI: skip prompts, generate minimal defaults
    process.stdout.write('[meridianos] First-run detected (stdin is not a TTY). Generating minimal defaults.\n')
    await runHeadless({ root, projectName })
    return true
  }

  await runInteractive({ root, projectName })
  return true
}

// ── Standalone entry point ──
import { fileURLToPath } from 'node:url'
const _isMain = fileURLToPath(import.meta.url) === process.argv[1]
if (_isMain) {
  runSetupWizard().then(ran => {
    if (!ran) process.stdout.write('Already configured — nothing to do.\n')
    process.exit(0)
  }).catch(e => {
    process.stderr.write(`setup-wizard error: ${e?.message ?? String(e)}\n`)
    process.exit(1)
  })
}
