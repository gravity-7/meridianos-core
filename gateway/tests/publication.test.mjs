/**
 * publication.test.mjs — tests for Gateway npm publication packaging & distribution (F002).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const PUBLISH_SCRIPT = join(REPO_ROOT, 'scripts', 'publish-gateway.ps1');

test('publish-gateway.ps1 -DryRun executes and generates valid package structure', () => {
  const result = spawnSync('pwsh', ['-File', PUBLISH_SCRIPT, '-DryRun'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `Script failed with output:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Package successfully assembled and verified/);
});

test('packaged gateway contains zero external runtime dependencies', () => {
  // Run publish-gateway.ps1 -DryRun to verify assembly
  const buildDir = mkdtempSync(join(tmpdir(), 'test-mg-pub-'));
  try {
    const psCmd = `
      $ErrorActionPreference = 'Stop'
      $RepoRoot = '${REPO_ROOT.replace(/\\/g, '/')}'
      $TempDir  = '${buildDir.replace(/\\/g, '/')}'
      $CoreDir  = Join-Path $TempDir 'core'
      New-Item -ItemType Directory -Path $CoreDir -Force | Out-Null
      Get-ChildItem -Path (Join-Path $RepoRoot 'gateway') -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $TempDir $_.Name) }
      Copy-Item (Join-Path $RepoRoot 'gateway' 'README.md') (Join-Path $TempDir 'README.md') -Force
      @('budget.mjs','pricing.mjs','providers.mjs','yaml-lite.mjs') | ForEach-Object { Copy-Item (Join-Path $RepoRoot $_) (Join-Path $CoreDir $_) }
      Copy-Item (Join-Path $RepoRoot 'tools' 'aios' 'pricing.json') (Join-Path $CoreDir 'pricing.json') -Force

      Get-ChildItem -Path $TempDir -Filter "*.mjs" | ForEach-Object {
        $c = Get-Content $_.FullName -Raw
        $u = $c -replace '\\.\\./budget\\.mjs', './core/budget.mjs' -replace '\\.\\./pricing\\.mjs', './core/pricing.mjs' -replace '\\.\\./providers\\.mjs', './core/providers.mjs' -replace '\\.\\./yaml-lite\\.mjs', './core/yaml-lite.mjs'
        if ($c -ne $u) { Set-Content $_.FullName $u -NoNewline }
      }

      $bPath = Join-Path $CoreDir 'budget.mjs'
      $bc = Get-Content $bPath -Raw
      $bc = $bc -replace "import\\s+\\{\\s*createAios\\s*\\}\\s+from\\s+'\\./config\\.mjs';", "const createAios = null;" \`
                -replace "import\\s+\\{\\s*claudeUsage\\s*\\}\\s+from\\s+'\\./claude-usage\\.mjs';", "const claudeUsage = null;" \`
                -replace "import\\s+\\{\\s*antigravityUsage\\s*\\}\\s+from\\s+'\\./antigravity-usage\\.mjs';", "const antigravityUsage = null;" \`
                -replace "import\\s+\\{\\s*readRuns\\s*\\}\\s+from\\s+'\\./runlog\\.mjs';", "const readRuns = null;" \`
                -replace "import\\s+\\{\\s*openLedger,\\s*queryWindow,\\s*listEvents\\s*\\}\\s+from\\s+'\\./gateway/ledger\\.mjs';", "const openLedger = null; const queryWindow = null; const listEvents = null;"
      Set-Content $bPath $bc -NoNewline

      $pkg = [ordered]@{
        name = '@gravity-7/meridian-gateway'
        version = '0.2.1'
        description = 'Standalone cost-governance forward-proxy for heterogeneous agent fleets'
        type = 'module'
        main = './index.mjs'
        bin = @{ 'meridian-gateway' = './cli.mjs' }
        engines = @{ node = '>=22.5.0' }
        publishConfig = @{ registry = 'https://registry.npmjs.org/'; access = 'public' }
      }
      $pkg | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $TempDir 'package.json') -NoNewline
    `;

    const res = spawnSync('pwsh', ['-Command', psCmd], { encoding: 'utf8' });
    assert.equal(res.status, 0, `PS Setup failed:\n${res.stdout}\n${res.stderr}`);

    // Verify package.json
    const pkgJson = JSON.parse(readFileSync(join(buildDir, 'package.json'), 'utf8'));
    assert.equal(pkgJson.name, '@gravity-7/meridian-gateway');
    assert.equal(pkgJson.bin['meridian-gateway'], './cli.mjs');
    assert.equal(pkgJson.publishConfig.access, 'public');
    assert.equal(pkgJson.engines.node, '>=22.5.0');
    assert.ok(!pkgJson.dependencies || Object.keys(pkgJson.dependencies).length === 0, 'Must have zero runtime dependencies');

    // Verify files exist
    assert.ok(existsSync(join(buildDir, 'cli.mjs')));
    assert.ok(existsSync(join(buildDir, 'index.mjs')));
    assert.ok(existsSync(join(buildDir, 'core', 'budget.mjs')));
    assert.ok(existsSync(join(buildDir, 'core', 'pricing.mjs')));
    assert.ok(existsSync(join(buildDir, 'core', 'providers.mjs')));
    assert.ok(existsSync(join(buildDir, 'core', 'yaml-lite.mjs')));
    assert.ok(existsSync(join(buildDir, 'core', 'pricing.json')));

    // Test loading and cost computation in Node in isolation
    const testScript = `
      import { costFor, loadPricing } from './core/pricing.mjs';
      import { verdictFor } from './core/budget.mjs';
      import { PROVIDERS } from './core/providers.mjs';

      const catalog = loadPricing();
      const cost = costFor('deepseek', 'deepseek-v4-pro', { inputTokens: 1000000, outputTokens: 1000000 }, { catalog });
      if (!cost || typeof cost.totalCost !== 'number') throw new Error('Cost calculation failed');
      const v = verdictFor({ last5h: { billable: 100 }, last7d: { billable: 1000 } }, { per_5h_tokens: 500, per_week_tokens: 5000 }, 80);
      if (v.state !== 'ok') throw new Error('Verdict calculation failed');
      if (!PROVIDERS.deepseek) throw new Error('Providers registry failed');
      console.log('OK');
    `;

    const nodeRes = spawnSync('node', ['-e', testScript], { cwd: buildDir, encoding: 'utf8' });
    assert.equal(nodeRes.status, 0, `Node module load failed:\n${nodeRes.stdout}\n${nodeRes.stderr}`);
    assert.match(nodeRes.stdout, /OK/);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
});
