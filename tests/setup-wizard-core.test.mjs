/**
 * tests/setup-wizard-core.test.mjs — US3: Browser + CLI Setup Wizard core logic (008 — End-User
 * Configurability). Covers only setup-wizard-core.mjs's pure planning logic (detect, budget math,
 * plan assembly) — it never writes, so these tests never touch the filesystem for the "plan" half;
 * the "write" half (writeSetupPlan) is covered separately with a real temp directory.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeBudgetFromDollars,
  buildSetupPlan,
  writeSetupPlan,
  detectExistingConfig,
} from '../setup-wizard-core.mjs';
import { parseYaml } from '../yaml-lite.mjs';

describe('computeBudgetFromDollars', () => {
  it('computes a positive weekly and per-5h token cap from a monthly dollar figure', () => {
    const budget = computeBudgetFromDollars(100, 2);
    assert.ok(budget.weeklyTokenCap > 0);
    assert.ok(budget.token_cap_5h > 0);
    assert.ok(budget.perAgentWeeklyTokenCap > 0);
  });

  it('scales roughly linearly with the dollar figure', () => {
    const small = computeBudgetFromDollars(50, 1);
    const big = computeBudgetFromDollars(500, 1);
    assert.ok(big.weeklyTokenCap > small.weeklyTokenCap * 9); // ~10x budget -> ~10x tokens
  });

  it('divides the per-agent cap evenly across the roster', () => {
    const budget = computeBudgetFromDollars(200, 4);
    assert.ok(Math.abs(budget.perAgentWeeklyTokenCap * 4 - budget.weeklyTokenCap) < 2);
  });

  it('rejects a non-positive budget with a clear error', () => {
    assert.throws(() => computeBudgetFromDollars(0, 1), /budget/i);
    assert.throws(() => computeBudgetFromDollars(-10, 1), /budget/i);
  });

  it('rejects a non-positive agent count with a clear error', () => {
    assert.throws(() => computeBudgetFromDollars(100, 0), /agent/i);
  });

  it('keeps the 5h:weekly ratio consistent with this repo\'s own scaffolded defaults (init.mjs: 200000:7500000)', () => {
    const budget = computeBudgetFromDollars(100, 1);
    const defaultRatio = 7_500_000 / 200_000; // init.mjs's own default policy.yaml
    const actualRatio = budget.weeklyTokenCap / budget.token_cap_5h;
    assert.ok(Math.abs(actualRatio - defaultRatio) < 0.01);
  });
});

describe('buildSetupPlan', () => {
  it('assembles policy.yaml/tenant.yaml/.env content without writing anything', () => {
    const plan = buildSetupPlan({
      tenantName: 'Test Co',
      agents: ['builder', 'reviewer'],
      providers: [{ name: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', apiKey: 'sk-ant-test' }],
      monthlyBudgetUsd: 100,
    });
    assert.ok(typeof plan.files['.ai/policy.yaml'] === 'string');
    assert.ok(typeof plan.files['.ai/tenant.yaml'] === 'string');
    assert.ok(typeof plan.files['.env'] === 'string');
    assert.match(plan.files['.env'], /ANTHROPIC_API_KEY=sk-ant-test/);
  });

  it('never writes the API key into policy.yaml or tenant.yaml (FR-008: keys go to .env only)', () => {
    const plan = buildSetupPlan({
      tenantName: 'Test Co',
      agents: ['builder'],
      providers: [{ name: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', apiKey: 'sk-ant-super-secret-value' }],
      monthlyBudgetUsd: 100,
    });
    assert.doesNotMatch(plan.files['.ai/policy.yaml'], /sk-ant-super-secret-value/);
    assert.doesNotMatch(plan.files['.ai/tenant.yaml'], /sk-ant-super-secret-value/);
  });

  it('produces a valid policy.yaml with the computed budget caps', () => {
    const plan = buildSetupPlan({
      tenantName: 'Test Co', agents: ['a'], providers: [], monthlyBudgetUsd: 150,
    });
    const parsed = parseYaml(plan.files['.ai/policy.yaml']);
    assert.equal(typeof parsed.agent_budget.token_cap_5h, 'number');
    assert.equal(typeof parsed.agent_budget.weekly_token_cap, 'number');
  });

  it('rejects an empty agent roster with a clear error', () => {
    assert.throws(() => buildSetupPlan({ tenantName: 'x', agents: [], providers: [], monthlyBudgetUsd: 50 }), /agent/i);
  });
});

describe('detectExistingConfig', () => {
  it('reports no existing config for a fresh directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    assert.equal(detectExistingConfig(dir).exists, false);
  });

  it('detects an existing .ai/policy.yaml and requires explicit force (FR-010)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    mkdirSync(join(dir, '.ai'), { recursive: true });
    writeFileSync(join(dir, '.ai', 'policy.yaml'), 'kill_switch: false\n');
    assert.equal(detectExistingConfig(dir).exists, true);
  });
});

describe('writeSetupPlan', () => {
  it('writes every planned file to disk on a fresh checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });
    writeSetupPlan(plan, dir);
    assert.ok(existsSync(join(dir, '.ai', 'policy.yaml')));
    assert.ok(existsSync(join(dir, '.ai', 'tenant.yaml')));
    assert.ok(existsSync(join(dir, '.env')));
    assert.equal(parseYaml(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8')).kill_switch, false);
  });

  it('refuses to overwrite an existing policy.yaml without force (FR-010)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    mkdirSync(join(dir, '.ai'), { recursive: true });
    writeFileSync(join(dir, '.ai', 'policy.yaml'), 'kill_switch: true\n# pre-existing, must not be clobbered\n');
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });

    assert.throws(() => writeSetupPlan(plan, dir), /exists|force/i);
    // the pre-existing file must be untouched after the rejected write
    assert.match(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8'), /pre-existing, must not be clobbered/);
  });

  it('overwrites when force:true is explicitly passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    mkdirSync(join(dir, '.ai'), { recursive: true });
    writeFileSync(join(dir, '.ai', 'policy.yaml'), 'kill_switch: true\n');
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });

    writeSetupPlan(plan, dir, { force: true });
    assert.equal(parseYaml(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8')).kill_switch, false);
  });
});
