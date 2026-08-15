/**
 * tests/setup-wizard-core.test.mjs — US3: Browser + CLI Setup Wizard core logic (008 — End-User
 * Configurability). Covers only setup-wizard-core.mjs's pure planning logic (detect, budget math,
 * plan assembly) — it never writes, so these tests never touch the filesystem for the "plan" half;
 * the "write" half (writeSetupPlan) is covered separately with a real temp directory.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, openSync, fstatSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  computeBudgetFromDollars,
  buildSetupPlan,
  buildSetupReview,
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

  it('routes every setup tier through the selected registered provider/model choice', () => {
    const plan = buildSetupPlan({
      tenantName: 'Test Co',
      agents: ['builder'],
      choice: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', keyEnv: 'DEEPSEEK_KEY' },
      providerSecret: 'synthetic-onboarding-sentinel',
      monthlyBudgetUsd: 100,
    });

    assert.match(plan.files['.ai/policy.yaml'], /provider: deepseek/);
    assert.match(plan.files['.ai/policy.yaml'], /model: deepseek-v4-flash/);
    assert.match(plan.files['.env'], /DEEPSEEK_KEY=synthetic-onboarding-sentinel/);
  });

  it('buildSetupReview is a non-writing redacted representation of the selected route', () => {
    const review = buildSetupReview({
      tenantName: 'Test Co',
      agents: ['builder'],
      choice: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', keyEnv: 'DEEPSEEK_KEY' },
      monthlyBudgetUsd: 100,
    });

    assert.deepEqual(review.route, {
      providerId: 'deepseek', modelId: 'deepseek-v4-flash', keyEnv: 'DEEPSEEK_KEY', displayName: 'deepseek',
    });
    assert.doesNotMatch(JSON.stringify(review), /synthetic-onboarding-sentinel|DEEPSEEK_KEY=/);
  });

  it('normalizes the same supported input for review and commit, and rejects YAML or env injection', () => {
    const valid = {
      tenantName: 'Test Co',
      agents: ['builder'],
      choice: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', keyEnv: 'DEEPSEEK_KEY' },
      monthlyBudgetUsd: 100,
    };
    assert.equal(buildSetupReview(valid).installationName, 'Test Co');
    assert.doesNotThrow(() => buildSetupPlan({ ...valid, providerSecret: 'synthetic-onboarding-sentinel' }));
    assert.throws(() => buildSetupReview({ ...valid, agents: 'builder' }), /agent/i);
    assert.throws(() => buildSetupPlan({ ...valid, tenantName: 'Test\npolicy: altered', providerSecret: 'synthetic-onboarding-sentinel' }), /installation/i);
    assert.throws(() => buildSetupPlan({ ...valid, providerSecret: 'synthetic\nEXTRA_VALUE=not-allowed' }), /credential/i);
  });
});

describe('detectExistingConfig', () => {
  it('reports no existing config for a fresh directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    assert.equal(detectExistingConfig(dir).exists, false);
  });

  it('detects an existing .ai/policy.yaml so first-time setup can refuse to overwrite it (FR-010)', () => {
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

  it('refuses to overwrite an existing policy.yaml (FR-010)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    mkdirSync(join(dir, '.ai'), { recursive: true });
    writeFileSync(join(dir, '.ai', 'policy.yaml'), 'kill_switch: true\n# pre-existing, must not be clobbered\n');
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });

    assert.throws(() => writeSetupPlan(plan, dir), /existing|exists|force/i);
    // the pre-existing file must be untouched after the rejected write
    assert.match(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8'), /pre-existing, must not be clobbered/);
  });

  it('refuses every existing generated target even when force:true is requested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    mkdirSync(join(dir, '.ai'), { recursive: true });
    writeFileSync(join(dir, '.ai', 'policy.yaml'), 'kill_switch: true\n');
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });

    assert.throws(() => writeSetupPlan(plan, dir, { force: true }), /exists|existing/i);
    assert.equal(parseYaml(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8')).kill_switch, true);
  });

  it('uses exclusive acquisition and cleans up only files created by a raced commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });
    let acquisitions = 0;
    const fsOps = {
      mkdirSync,
      openSync: (path, flags, mode) => {
        acquisitions += 1;
        if (acquisitions === 2) writeFileSync(path, 'created-by-another-actor\n');
        return openSync(path, flags, mode);
      },
      fstatSync,
      writeFileSync,
      closeSync,
      statSync,
      unlinkSync,
    };

    assert.throws(() => writeSetupPlan(plan, dir, { fsOps }), /exist/i);
    assert.equal(existsSync(join(dir, '.ai', 'tenant.yaml')), false);
    assert.equal(readFileSync(join(dir, '.ai', 'policy.yaml'), 'utf8'), 'created-by-another-actor\n');
  });

  it('cleans up an acquired target when a write fails after exclusive creation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });
    let writes = 0;
    const fsOps = {
      mkdirSync,
      openSync,
      fstatSync,
      writeFileSync: (fd, content, encoding) => {
        writes += 1;
        if (writes === 2) throw new Error('synthetic disk failure');
        writeFileSync(fd, content, encoding);
      },
      closeSync,
      statSync,
      unlinkSync,
    };

    assert.throws(() => writeSetupPlan(plan, dir, { fsOps }), /synthetic disk failure/);
    assert.equal(existsSync(join(dir, '.ai', 'tenant.yaml')), false);
    assert.equal(existsSync(join(dir, '.ai', 'policy.yaml')), false);
    assert.equal(existsSync(join(dir, '.env')), false);
  });

  it('cleans up an exclusively acquired target when its descriptor stat fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
    const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });
    const fsOps = {
      mkdirSync,
      openSync,
      fstatSync: () => { throw new Error('synthetic descriptor stat failure'); },
      writeFileSync,
      closeSync,
      statSync,
      unlinkSync,
    };

    assert.throws(() => writeSetupPlan(plan, dir, { fsOps }), /synthetic descriptor stat failure/);
    assert.equal(existsSync(join(dir, '.ai', 'tenant.yaml')), false);
    assert.equal(existsSync(join(dir, '.ai', 'policy.yaml')), false);
    assert.equal(existsSync(join(dir, '.env')), false);
  });

  for (const existingTarget of ['.ai/tenant.yaml', '.env']) {
    it(`refuses an existing ${existingTarget} without changing any setup target`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'setup-wizard-'));
      const target = join(dir, existingTarget);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'pre-existing\n');
      const plan = buildSetupPlan({ tenantName: 'Test Co', agents: ['builder'], providers: [], monthlyBudgetUsd: 100 });

      assert.throws(() => writeSetupPlan(plan, dir), /exists|existing/i);
      assert.equal(readFileSync(target, 'utf8'), 'pre-existing\n');
      assert.equal(existsSync(join(dir, '.ai', 'policy.yaml')), false);
    });
  }
});

describe('legacy setup CLI credential boundary', () => {
  it('writes a placeholder rather than importing an inherited synthetic provider value', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'setup-wizard-cli-'));
    const cliPath = join(process.cwd(), 'gateway', 'cli.mjs');
    const result = spawnSync(process.execPath, [cliPath, 'setup', '--init', '--providers', 'deepseek', '--budget', '25'], {
      cwd: repoRoot,
      env: { DEEPSEEK_KEY: 'synthetic-inherited-provider-value' },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const envContent = readFileSync(join(repoRoot, '.env'), 'utf8');
    assert.match(envContent, /DEEPSEEK_KEY=your-key-here/);
    assert.doesNotMatch(envContent, /synthetic-inherited-provider-value/);
  });
});
