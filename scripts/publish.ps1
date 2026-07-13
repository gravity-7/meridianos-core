#requires -Version 7
<#
  publish.ps1 — Release @gravity-7/meridianos-core to GitHub Packages (private registry).

  SAFE-BY-DESIGN:
   - The GitHub PAT is read from a DPAPI-encrypted file (bound to THIS Windows user + machine).
     It is decrypted only in-process, handed to `npm` via a transient env var + a temp .npmrc,
     and is NEVER written to disk in plaintext, echoed, or logged.
   - Refuses to publish unless: on `main`, working tree clean, in sync with origin/main, and the
     full test suite passes (Node 24). The version bump is only committed/pushed AFTER a
     successful publish, so a failed publish leaves nothing behind.

  ONE-TIME SETUP (run in YOUR OWN interactive terminal — input is hidden; no tooling ever sees it):
      Read-Host -AsSecureString "GitHub PAT (write:packages, read:packages)" |
        ConvertFrom-SecureString | Set-Content "$HOME\.meridianos-publish.token"
  Revoke anytime:  Remove-Item "$HOME\.meridianos-publish.token"
  (Optional cleanup of the old plaintext token:  npm config delete //npm.pkg.github.com/:_authToken)

  USAGE:  pwsh scripts/publish.ps1 [-Bump patch|minor]     # default: patch
#>
param([ValidateSet('patch', 'minor')][string]$Bump = 'patch')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot  = Split-Path $PSScriptRoot -Parent
$Node      = 'C:\Program Files\nodejs\node.exe'
$Npm       = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
$TokenFile = Join-Path $HOME '.meridianos-publish.token'
Set-Location $RepoRoot

function Fail($m) { Write-Error $m; exit 1 }

# --- Guards ---------------------------------------------------------------
if (-not (Test-Path $TokenFile)) { Fail "No publish token at $TokenFile. Run the one-time setup in this file's header." }
if (-not (Test-Path $Node))      { Fail "Node 24 not found at $Node." }
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Fail "Refusing to publish from '$branch' — checkout main first." }
& git fetch origin main --quiet
if ((& git rev-parse HEAD) -ne (& git rev-parse origin/main)) { Fail "Local main is not in sync with origin/main — pull/push first." }
if (@(& git status --porcelain).Count -ne 0) { Fail "Working tree is not clean — commit or stash first." }

# --- Tests must pass (Node 24) -------------------------------------------
Write-Host "Running test suite (Node 24)…"
& $Node --disable-warning=ExperimentalWarning --test "tests/*.test.mjs"
if ($LASTEXITCODE -ne 0) { Fail "Tests failed — refusing to publish." }

# --- Version bump (package.json only; NOT committed until publish succeeds) ---
& $Node $Npm version $Bump --no-git-tag-version --silent | Out-Null
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

# --- Publish: token decrypted in-process, never persisted or printed ------
$TmpNpmrc  = Join-Path $RepoRoot '.npmrc.publish'
$bstr      = [IntPtr]::Zero
$published = $false
try {
  $sec  = (Get-Content $TokenFile -Raw).Trim() | ConvertTo-SecureString   # DPAPI decrypt (user+machine bound)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:NODE_AUTH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  # temp user-config: scope map + an ENV-VAR REFERENCE (no token text on disk); removed in finally
  "@gravity-7:registry=https://npm.pkg.github.com`n//npm.pkg.github.com/:_authToken=`${NODE_AUTH_TOKEN}" |
    Set-Content $TmpNpmrc -NoNewline
  & $Node $Npm publish --userconfig $TmpNpmrc
  $published = ($LASTEXITCODE -eq 0)
}
finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $env:NODE_AUTH_TOKEN = $null
  Remove-Item $TmpNpmrc -Force -ErrorAction SilentlyContinue
}

if (-not $published) {
  & git checkout -- package.json package-lock.json   # discard the un-published bump
  Fail "npm publish failed — version bump reverted, nothing committed or pushed."
}

# --- Publish succeeded → record the release on main -----------------------
& git commit -am "chore: release v$version" | Out-Null
& git push origin main
if ($LASTEXITCODE -ne 0) { Write-Warning "v$version PUBLISHED to the registry, but 'git push' failed — push the release commit manually." }

Write-Host "PUBLISHED @gravity-7/meridianos-core@$version"
