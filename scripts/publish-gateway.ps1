#requires -Version 7
<#
  publish-gateway.ps1 — Package and release @gravity-7/meridian-gateway to the public npm registry.

  SAFE-BY-DESIGN:
   - The NPM publishing token is passed via NODE_AUTH_TOKEN or NPM_TOKEN env var.
   - It uses a transient .npmrc holding only environment variable references (never plaintext tokens).
   - Cleans up temporary build directories and .npmrc files in a finally block.

  USAGE:
    pwsh scripts/publish-gateway.ps1 [-DryRun] [-Registry <url>]
#>
param(
  [switch]$DryRun,
  [string]$Registry = 'https://registry.npmjs.org/'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot  = Split-Path $PSScriptRoot -Parent
$PkgJson   = Join-Path $RepoRoot 'package.json'
if (-not (Test-Path $PkgJson)) { throw "Root package.json not found at $PkgJson" }

$rootConfig = Get-Content $PkgJson -Raw | ConvertFrom-Json
$Version    = $rootConfig.version

$TempDir       = Join-Path ([IO.Path]::GetTempPath()) ("meridian-gateway-build-" + [System.Guid]::NewGuid().ToString("N"))
$CoreDir       = Join-Path $TempDir 'core'
$TmpNpmrc      = Join-Path ([IO.Path]::GetTempPath()) ("mg-publish-" + [System.Guid]::NewGuid().ToString("N") + ".npmrc")

try {
  Write-Host "Creating temporary build workspace at $TempDir..."
  New-Item -ItemType Directory -Path $CoreDir -Force | Out-Null

  # 1. Copy Gateway files
  $GatewayDir = Join-Path $RepoRoot 'gateway'
  Get-ChildItem -Path $GatewayDir -File | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $TempDir $_.Name)
  }

  if (Test-Path (Join-Path $GatewayDir 'README.md')) {
    Copy-Item -Path (Join-Path $GatewayDir 'README.md') -Destination (Join-Path $TempDir 'README.md') -Force
  } elseif (Test-Path (Join-Path $RepoRoot 'README.md')) {
    Copy-Item -Path (Join-Path $RepoRoot 'README.md') -Destination (Join-Path $TempDir 'README.md') -Force
  }

  if (Test-Path (Join-Path $RepoRoot 'LICENSE')) {
    Copy-Item -Path (Join-Path $RepoRoot 'LICENSE') -Destination (Join-Path $TempDir 'LICENSE') -Force
  }

  # 2. Copy Core files into core/
  $CoreFiles = @('budget.mjs', 'pricing.mjs', 'providers.mjs', 'yaml-lite.mjs')
  foreach ($f in $CoreFiles) {
    $src = Join-Path $RepoRoot $f
    if (-not (Test-Path $src)) { throw "Required core file not found: $src" }
    Copy-Item -Path $src -Destination (Join-Path $CoreDir $f)
  }

  $PricingJsonSrc = Join-Path $RepoRoot 'tools' 'aios' 'pricing.json'
  if (Test-Path $PricingJsonSrc) {
    Copy-Item -Path $PricingJsonSrc -Destination (Join-Path $CoreDir 'pricing.json') -Force
  }

  # 3. Path rewriting in root gateway JS files
  Get-ChildItem -Path $TempDir -Filter "*.mjs" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $updated = $content `
      -replace "\.\./budget\.mjs", "./core/budget.mjs" `
      -replace "\.\./pricing\.mjs", "./core/pricing.mjs" `
      -replace "\.\./providers\.mjs", "./core/providers.mjs" `
      -replace "\.\./yaml-lite\.mjs", "./core/yaml-lite.mjs"
    if ($content -ne $updated) {
      Set-Content -Path $_.FullName -Value $updated -NoNewline
    }
  }

  # 4. Decouple core/budget.mjs from non-gateway imports
  $BudgetPath = Join-Path $CoreDir 'budget.mjs'
  if (Test-Path $BudgetPath) {
    $bContent = Get-Content $BudgetPath -Raw
    # Replace top-level non-gateway imports with stubs
    $bContent = $bContent `
      -replace "import\s+\{\s*createAios\s*\}\s+from\s+'\./config\.mjs';", "const createAios = null;" `
      -replace "import\s+\{\s*claudeUsage\s*\}\s+from\s+'\./claude-usage\.mjs';", "const claudeUsage = null;" `
      -replace "import\s+\{\s*antigravityUsage\s*\}\s+from\s+'\./antigravity-usage\.mjs';", "const antigravityUsage = null;" `
      -replace "import\s+\{\s*readRuns\s*\}\s+from\s+'\./runlog\.mjs';", "const readRuns = null;" `
      -replace "import\s+\{\s*openLedger,\s*queryWindow,\s*listEvents\s*\}\s+from\s+'\./gateway/ledger\.mjs';", "const openLedger = null; const queryWindow = null; const listEvents = null;"
    Set-Content -Path $BudgetPath -Value $bContent -NoNewline
  }

  # 5. Generate gateway package.json
  $GatewayPkg = [ordered]@{
    name        = '@gravity-7/meridian-gateway'
    version     = $Version
    description = 'Standalone cost-governance forward-proxy for heterogeneous agent fleets'
    type        = 'module'
    main        = './index.mjs'
    bin         = @{
      'meridian-gateway' = './cli.mjs'
    }
    engines     = @{
      node = '>=22.5.0'
    }
    publishConfig = @{
      registry = $Registry
      access   = 'public'
    }
  }
  $GatewayPkg | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $TempDir 'package.json') -NoNewline

  # 6. Verify bundle loads cleanly
  Write-Host "Verifying bundled gateway modules in Node..."
  Push-Location $TempDir
  try {
    & node --check cli.mjs
    if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed on cli.mjs" }
    & node --check index.mjs
    if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed on index.mjs" }
    & node -e "import './index.mjs'; import './core/budget.mjs'; import './core/pricing.mjs'; import './core/providers.mjs';"
    if ($LASTEXITCODE -ne 0) { throw "Failed to import bundled gateway modules" }
  }
  finally {
    Pop-Location
  }

  # 7. Publish or Dry Run
  if ($DryRun) {
    Write-Host "[DRY-RUN] Package successfully assembled and verified at $TempDir"
    Write-Host "[DRY-RUN] Package name: @gravity-7/meridian-gateway@$Version"
  } else {
    $token = $env:NODE_AUTH_TOKEN
    if (-not $token) { $token = $env:NPM_TOKEN }
    if (-not $token -and (Test-Path "$HOME\.meridianos-publish.token")) {
      $sec = (Get-Content "$HOME\.meridianos-publish.token" -Raw).Trim() | ConvertTo-SecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
      $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    if (-not $token) { throw "No NPM publishing token found in NODE_AUTH_TOKEN or NPM_TOKEN." }

    $env:NODE_AUTH_TOKEN = $token
    $NpmrcBody = "@gravity-7:registry=$Registry`n//$( ($Registry -replace 'https://','').TrimEnd('/') )/:_authToken=`${NODE_AUTH_TOKEN}"
    Set-Content $TmpNpmrc $NpmrcBody -NoNewline

    Push-Location $TempDir
    try {
      Write-Host "Publishing @gravity-7/meridian-gateway@$Version to $Registry..."
      & npm publish --access public --userconfig $TmpNpmrc
      if ($LASTEXITCODE -ne 0) { throw "npm publish failed with exit code $LASTEXITCODE" }
      Write-Host "Successfully published @gravity-7/meridian-gateway@$Version"
    }
    finally {
      Pop-Location
    }
  }
}
finally {
  $env:NODE_AUTH_TOKEN = $null
  if (Test-Path $TmpNpmrc) { Remove-Item $TmpNpmrc -Force -ErrorAction SilentlyContinue }
  if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
