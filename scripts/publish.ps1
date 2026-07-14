#requires -Version 7
<#
  publish.ps1 — Release @gravity-7/meridianos-core to GitHub Packages AND propagate to the
  PropertyVerdict tenant (bump its dependency + lockfile, open a PR). One command, whole loop.

  SAFE-BY-DESIGN:
   - The GitHub PAT is read from a DPAPI-encrypted file (bound to THIS Windows user + machine).
     It is decrypted only in-process, handed to `npm` via a transient env var + temp .npmrc files
     (which hold only an env-var *reference*, never the token), and is NEVER written to disk in
     plaintext, echoed, or logged. It is zeroed/cleared in a `finally`.
   - Refuses to publish unless: on `main`, working tree clean, in sync with origin/main, tests pass.
   - The core version bump is committed/pushed ONLY after a successful publish. The PV side runs in
     an isolated worktree and only ever opens a PR — it never merges into PV's live-daemon main
     (that stays a human/orchestrator step under daemon discipline).

  ONE-TIME SETUP (run in YOUR OWN interactive terminal — input hidden; no tooling ever sees it):
      Read-Host -AsSecureString "GitHub PAT (write:packages, read:packages)" |
        ConvertFrom-SecureString | Set-Content "$HOME\.meridianos-publish.token"
  Revoke anytime:  Remove-Item "$HOME\.meridianos-publish.token"

  USAGE:  pwsh scripts/publish.ps1 [-Bump patch|minor] [-PvRepo <path|''>]
          -Bump   : version bump type (default: patch)
          -PvRepo : PropertyVerdict repo to propagate to (default C:\projects\propertyverdict; '' = skip)
#>
param(
  [ValidateSet('patch', 'minor')][string]$Bump = 'patch',
  [string]$PvRepo = 'C:\projects\propertyverdict'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot     = Split-Path $PSScriptRoot -Parent
$Node         = 'C:\Program Files\nodejs\node.exe'
$Npm          = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
$TokenFile    = Join-Path $HOME '.meridianos-publish.token'
$CoreTmpNpmrc = Join-Path ([IO.Path]::GetTempPath()) 'mc-publish.npmrc'
$PvTmpNpmrc   = Join-Path ([IO.Path]::GetTempPath()) 'pv-publish.npmrc'
$NpmrcBody    = "@gravity-7:registry=https://npm.pkg.github.com`n//npm.pkg.github.com/:_authToken=`${NODE_AUTH_TOKEN}"
Set-Location $RepoRoot

function Fail($m) { Write-Error $m; exit 1 }

# --- Guards (no token touched yet) ---------------------------------------
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

# --- Core version bump (package.json only; NOT committed until publish OK) ---
& $Node $Npm version $Bump --no-git-tag-version --silent | Out-Null
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

# --- Token decrypted in-process; alive through BOTH publish + PV lockfile update ---
$bstr     = [IntPtr]::Zero
$wt       = $null
$pvBranch = $null
$prUrl    = $null
try {
  $sec  = (Get-Content $TokenFile -Raw).Trim() | ConvertTo-SecureString   # DPAPI decrypt (user+machine bound)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $env:NODE_AUTH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  # 1) Publish the core -----------------------------------------------------
  Set-Content $CoreTmpNpmrc $NpmrcBody -NoNewline
  & $Node $Npm publish --userconfig $CoreTmpNpmrc
  if ($LASTEXITCODE -ne 0) {
    & git checkout -- package.json package-lock.json     # discard the un-published bump
    throw "npm publish failed — version bump reverted, nothing committed or pushed."
  }
  & git commit -am "chore: release v$version" | Out-Null
  & git push origin main
  if ($LASTEXITCODE -ne 0) { Write-Warning "v$version PUBLISHED but 'git push' of the release commit failed — push it manually." }

  # 2) Propagate to PropertyVerdict (bump dep + lockfile, open a PR) ---------
  if ($PvRepo -and (Test-Path (Join-Path $PvRepo 'package.json'))) {
    try {
      & git -C $PvRepo fetch origin main --quiet
      $pvBase   = (& git -C $PvRepo rev-parse origin/main).Trim()
      $wt       = Join-Path (Split-Path $PvRepo -Parent) "pv-bump-$version"
      $pvBranch = "aios/bump-core-$version"
      & git -C $PvRepo worktree add $wt -b $pvBranch $pvBase | Out-Null

      $pkgPath = Join-Path $wt 'package.json'
      (Get-Content $pkgPath -Raw) -replace '("@gravity-7/meridianos-core"\s*:\s*")[^"]*(")', ('${1}^' + $version + '${2}') |
        Set-Content $pkgPath -NoNewline

      Set-Content $PvTmpNpmrc $NpmrcBody -NoNewline
      Push-Location $wt
      & $Node $Npm install --package-lock-only --userconfig $PvTmpNpmrc
      $lockOk = ($LASTEXITCODE -eq 0)
      Pop-Location
      if (-not $lockOk) { throw "npm install --package-lock-only failed in the PV worktree." }

      & git -C $wt commit -am "chore(aios): bump @gravity-7/meridianos-core to ^$version" | Out-Null
      & git -C $wt push origin $pvBranch
      $prBody = "Automated dependency bump to consume ``@gravity-7/meridianos-core@$version`` (just published from the meridianos-core repo). The local AIOS daemon resolves the core via a junction, so its runtime is unaffected by this pin; this bump is for CI / other consumers. Merge under daemon discipline."
      $prUrl = (& gh pr create --repo gravity-7/propertyverdict --head $pvBranch --base main `
                  --title "chore(aios): bump @gravity-7/meridianos-core to ^$version" --body $prBody)
    }
    catch {
      Write-Warning "Core v$version PUBLISHED OK, but the PV dep-bump step failed: $($_.Exception.Message). Do the PV bump manually."
    }
  }
}
finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $env:NODE_AUTH_TOKEN = $null
  Remove-Item $CoreTmpNpmrc, $PvTmpNpmrc -Force -ErrorAction SilentlyContinue
  if ($wt -and (Test-Path $wt)) {
    & git -C $PvRepo worktree remove $wt --force 2>$null
    & git -C $PvRepo worktree prune 2>$null
    if ($pvBranch) { & git -C $PvRepo branch -D $pvBranch 2>$null }
  }
}

Write-Host "PUBLISHED @gravity-7/meridianos-core@$version"
if ($prUrl) { Write-Host "PV dep-bump PR: $prUrl  (review CI, then merge under daemon discipline)" }
else        { Write-Host "PV propagation skipped or failed — bump PropertyVerdict's dep manually if needed." }
