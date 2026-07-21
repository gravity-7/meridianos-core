/**
 * setup-wizard.test.mjs — tests for the first-run guided setup wizard (F012).
 *
 * Tests cover:
 *   • Wizard detects already-configured state → returns false (no-op)
 *   • Wizard detects first-run → generates policy.yaml with correct structure
 *   • Generated policy.yaml passes validatePolicy()
 *   • Generated policy has requested agents in the roster
 *   • Headless / non-TTY mode generates minimal defaults
 *   • Idempotent — running twice doesn't break anything
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetupWizard } from '../setup-wizard.mjs'
import { validatePolicy } from '../policy-validate.mjs'
import { parseYaml } from '../yaml-lite.mjs'

// ── Helpers ──

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'meridianos-setup-test-'))
  return dir
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
}

/** Save and restore process.stdin.isTTY so tests can simulate headless mode. */
function withStdinTTY(value, fn) {
  const prev = process.stdin.isTTY
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true })
    return fn()
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: prev, configurable: true, writable: true })
  }
}

// ── Tests ──

test('already-configured → returns false (no-op)', async () => {
  const root = tmpProject()
  try {
    // Create .ai/policy.yaml (simulating an already-configured project)
    mkdirSync(join(root, '.ai'), { recursive: true })
    writeFileSync(join(root, '.ai', 'policy.yaml'), '# existing policy\nschedule:\n  cadence: off\n', 'utf8')

    const ran = await runSetupWizard({ root })
    assert.equal(ran, false, 'wizard should return false when already configured')

    // Original file untouched
    const content = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    assert.ok(content.includes('existing policy'), 'existing policy must not be overwritten')
  } finally {
    cleanup(root)
  }
})

test('first-run headless → returns true, generates valid policy.yaml', async () => {
  const root = tmpProject()
  try {
    // Force non-TTY (headless/CI mode)
    const ran = await withStdinTTY(false, () => runSetupWizard({ root }))
    assert.equal(ran, true, 'wizard should return true when first-run')

    const policyPath = join(root, '.ai', 'policy.yaml')
    assert.ok(existsSync(policyPath), 'policy.yaml must exist after wizard')

    const raw = readFileSync(policyPath, 'utf8')
    const policy = parseYaml(raw)

    // Validate
    const { ok, errors } = validatePolicy(policy)
    if (!ok) {
      console.error('Validation errors:', errors)
    }
    assert.ok(ok, 'generated policy must pass validatePolicy()')

    // Check structure
    assert.ok(policy.schedule, 'must have schedule block')
    assert.ok(policy.schedule.cadence, 'must have cadence')
    assert.ok(policy.gateway, 'must have gateway block')
    assert.ok(policy.providers, 'must have providers block')
    assert.ok(policy.model_routing, 'must have model_routing block')
    assert.ok(policy.agent_budget, 'must have agent_budget block')
    assert.ok(policy.work, 'must have work block')
    assert.ok(policy.sensitive_actions, 'must have sensitive_actions block')
    assert.equal(policy.auto_merge, 'verifier_gated', 'must have auto_merge set')

    // Check agent roster — headless default is ['builder', 'reviewer']
    assert.ok(policy.model_routing.builder, 'builder must be in model_routing')
    assert.ok(policy.model_routing.reviewer, 'reviewer must be in model_routing')
    assert.ok(policy.agent_budget.builder, 'builder must have budget')
    assert.ok(policy.agent_budget.reviewer, 'reviewer must have budget')

    // Check providers
    assert.ok(policy.providers.deepseek, 'deepseek must be in providers')
    assert.ok(policy.providers.anthropic, 'anthropic must be in providers')

    // Check directory scaffolding
    assert.ok(existsSync(join(root, '.ai', 'state')), '.ai/state must exist')
    assert.ok(existsSync(join(root, '.ai', 'gateway')), '.ai/gateway must exist')
    assert.ok(existsSync(join(root, '.ai', 'logs')), '.ai/logs must exist')
    assert.ok(existsSync(join(root, '.ai', 'runs')), '.ai/runs must exist')
    assert.ok(existsSync(join(root, '.ai', 'inbox')), '.ai/inbox must exist')
    assert.ok(existsSync(join(root, '.ai', 'features')), '.ai/features must exist')
    assert.ok(existsSync(join(root, '.ai', 'secrets')), '.ai/secrets must exist')
  } finally {
    cleanup(root)
  }
})

test('generated policy cadence is valid', async () => {
  const root = tmpProject()
  try {
    await withStdinTTY(false, () => runSetupWizard({ root }))

    const raw = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    const policy = parseYaml(raw)

    const validCadences = ['every_15m', 'every_30m', 'every_45m', 'hourly', 'every_2h', 'every_3h', 'on_handoff', 'off']
    assert.ok(validCadences.includes(policy.schedule.cadence), `cadence '${policy.schedule.cadence}' must be valid`)
  } finally {
    cleanup(root)
  }
})

test('generated policy work constraints are coherent', async () => {
  const root = tmpProject()
  try {
    await withStdinTTY(false, () => runSetupWizard({ root }))

    const raw = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    const policy = parseYaml(raw)

    assert.ok(policy.work.max_parallel >= 1, 'max_parallel must be ≥ 1')
    assert.ok(policy.work.wip_per_agent >= 1, 'wip_per_agent must be ≥ 1')
    assert.ok(policy.work.wip_per_agent <= policy.work.max_parallel,
      `wip_per_agent (${policy.work.wip_per_agent}) must not exceed max_parallel (${policy.work.max_parallel})`)
    assert.ok(policy.work.lease_ttl_min > 0, 'lease_ttl_min must be > 0')
    assert.ok(policy.work.max_runs_per_5h > 0, 'max_runs_per_5h must be > 0')
  } finally {
    cleanup(root)
  }
})

test('generated policy sensitive_actions are valid dispositions', async () => {
  const root = tmpProject()
  try {
    await withStdinTTY(false, () => runSetupWizard({ root }))

    const raw = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    const policy = parseYaml(raw)

    const validDispositions = ['block_and_ask', 'notify_only', 'allow']
    for (const [action, disposition] of Object.entries(policy.sensitive_actions ?? {})) {
      assert.ok(validDispositions.includes(disposition),
        `sensitive_actions.${action} '${disposition}' must be valid`)
    }
  } finally {
    cleanup(root)
  }
})

test('idempotent — running wizard twice does not break anything', async () => {
  const root = tmpProject()
  try {
    // First run
    const ran1 = await withStdinTTY(false, () => runSetupWizard({ root }))
    assert.equal(ran1, true, 'first run should return true')

    const firstContent = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')

    // Second run
    const ran2 = await withStdinTTY(false, () => runSetupWizard({ root }))
    assert.equal(ran2, false, 'second run should return false (already configured)')

    const secondContent = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    assert.equal(secondContent, firstContent, 'second run must not overwrite policy')

    // Policy still valid after both runs
    const policy = parseYaml(secondContent)
    const { ok } = validatePolicy(policy)
    assert.ok(ok, 'policy must remain valid after idempotent re-run')
  } finally {
    cleanup(root)
  }
})

test('wizard with no .ai directory at all → creates everything from scratch', async () => {
  const root = tmpProject()
  try {
    // No .ai directory exists
    assert.ok(!existsSync(join(root, '.ai')), 'precondition: .ai must not exist')

    const ran = await withStdinTTY(false, () => runSetupWizard({ root }))
    assert.equal(ran, true)

    assert.ok(existsSync(join(root, '.ai')), '.ai directory must be created')
    assert.ok(existsSync(join(root, '.ai', 'policy.yaml')), 'policy.yaml must be created')

    const raw = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    const policy = parseYaml(raw)
    const { ok } = validatePolicy(policy)
    assert.ok(ok, 'policy from scratch must be valid')
  } finally {
    cleanup(root)
  }
})

test('generated policy agent_budget has correct structure', async () => {
  const root = tmpProject()
  try {
    await withStdinTTY(false, () => runSetupWizard({ root }))

    const raw = readFileSync(join(root, '.ai', 'policy.yaml'), 'utf8')
    const policy = parseYaml(raw)

    assert.ok(policy.agent_budget.warn_pct >= 1 && policy.agent_budget.warn_pct <= 100,
      'warn_pct must be 1-100')
    assert.ok(policy.agent_budget.per_task_tokens > 0,
      'per_task_tokens must be > 0')

    // Each agent in the roster must have per_5h_tokens and per_week_tokens
    for (const agent of ['builder', 'reviewer']) {
      assert.ok(policy.agent_budget[agent], `${agent} must be in agent_budget`)
      assert.ok(typeof policy.agent_budget[agent].per_5h_tokens === 'number',
        `${agent} must have per_5h_tokens`)
      assert.ok(typeof policy.agent_budget[agent].per_week_tokens === 'number',
        `${agent} must have per_week_tokens`)
    }
  } finally {
    cleanup(root)
  }
})
