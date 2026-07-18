<#
  register-conductor.ps1 - register (or remove) the MeridianOS continuity conductor as a Windows
  Scheduled Task that runs `node conductor.mjs` every 5 minutes (card C8; ACCELERATION-PLAN section 9).

  The conductor itself is lease-guarded and no-LLM: most ticks are a fast no-op (orchestrator-alive
  / resume_at-in-future). It only spawns a fresh `claude -p @RESUME-PROMPT.md` when a work window is
  actually open. Registering this task is the standing-automation action gated on founder Gate 3.

  Keep this file ASCII-only: Windows PowerShell 5.1 reads a no-BOM UTF-8 file as CP1252, and a stray
  multibyte char (em-dash, section sign) then injects phantom quotes and breaks parsing.

  Usage (from PowerShell 7 `pwsh` or Windows PowerShell):
    pwsh -File scripts/register-conductor.ps1              # register / update
    pwsh -File scripts/register-conductor.ps1 -Unregister  # remove
    pwsh -File scripts/register-conductor.ps1 -DryRun      # print what it WOULD do
#>
[CmdletBinding()]
param(
  [switch]$Unregister,
  [switch]$DryRun,
  [string]$TaskName = 'MeridianOS-Conductor',
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path -Parent $PSScriptRoot
$conductor  = Join-Path $repoRoot 'conductor.mjs'
$node       = (Get-Command node -ErrorAction SilentlyContinue).Source

if ($Unregister) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    if ($DryRun) { Write-Host "[dry-run] would unregister '$TaskName'"; return }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Unregistered '$TaskName'."
  } else { Write-Host "'$TaskName' not present - nothing to do." }
  return
}

if (-not $node)                  { throw "node not found on PATH - install Node 24 or add it to PATH." }
if (-not (Test-Path $conductor)) { throw "conductor.mjs not found at $conductor" }

# Run every $IntervalMinutes indefinitely, starting ~1 min from now.
$quotedConductor = '"' + $conductor + '"'   # quote the path (may contain spaces)
$action  = New-ScheduledTaskAction -Execute $node -Argument $quotedConductor -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if ($DryRun) {
  Write-Host "[dry-run] would register '$TaskName':"
  Write-Host "  node        : $node"
  Write-Host "  conductor   : $conductor"
  Write-Host "  working dir : $repoRoot"
  Write-Host "  interval    : every $IntervalMinutes min, MultipleInstances=IgnoreNew"
  return
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered '$TaskName' - runs 'node conductor.mjs' every $IntervalMinutes min."
Write-Host "Remove with: pwsh -File scripts/register-conductor.ps1 -Unregister"
