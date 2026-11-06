#Requires -Version 7.0
# The Windows half of `pnpm sync:context` and `pnpm check:context`.
#
# Windows has no bash, so it installs the one command that has a native
# PowerShell build: agent-gh. The instructions, git hooks, and opencode plugin
# are bash, so sync those from Linux or WSL with scripts/sync-agent-context.sh.
#
# Installing twice changes nothing, and neither mode reads, writes, or moves
# the token file. Neither needs administrator rights.
param(
  [ValidateSet('local', 'check')]
  [string]$Mode = 'local',
  # Adds the install directory to the user PATH. Never the machine PATH.
  [switch]$AddToPath
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'github-public.ps1'
$targetHome = if ($env:WOLFSTAR_AGENT_CONTEXT_HOME) { $env:WOLFSTAR_AGENT_CONTEXT_HOME }
elseif ($IsWindows -and $env:USERPROFILE) { $env:USERPROFILE }
else { $HOME }
if (-not [System.IO.Path]::IsPathFullyQualified($targetHome)) {
  [Console]::Error.WriteLine('The local home path must be absolute.')
  exit 1
}
$binDir = [System.IO.Path]::Combine($targetHome, '.local', 'bin')
# PowerShell finds a .ps1 on PATH by its bare name, so this runs as `agent-gh`.
$installed = [System.IO.Path]::Combine($binDir, 'agent-gh.ps1')

if (-not [System.IO.File]::Exists($source)) {
  [Console]::Error.WriteLine("The public GitHub CLI is missing: $source")
  exit 1
}

function Test-SameContent([string]$Left, [string]$Right) {
  if (-not [System.IO.File]::Exists($Right)) { return $false }
  $a = [System.IO.File]::ReadAllBytes($Left)
  $b = [System.IO.File]::ReadAllBytes($Right)
  return [System.Linq.Enumerable]::SequenceEqual($a, $b)
}

function Test-PathEntry([string]$PathValue, [string]$Directory) {
  if (-not $PathValue) { return $false }
  $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  $wanted = $Directory.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  foreach ($entry in $PathValue.Split([System.IO.Path]::PathSeparator)) {
    if ([string]::Equals($entry.TrimEnd([System.IO.Path]::DirectorySeparatorChar), $wanted, $comparison)) { return $true }
  }
  return $false
}

if ($Mode -eq 'check') {
  if (-not (Test-SameContent $source $installed)) {
    [Console]::Out.WriteLine('FAIL  The public GitHub CLI differs. Run pnpm sync:context.')
    exit 1
  }
  [Console]::Out.WriteLine('ok    agent-gh matches its tracked source')
  exit 0
}

[System.IO.Directory]::CreateDirectory($binDir) | Out-Null
if (Test-SameContent $source $installed) {
  [Console]::Out.WriteLine("agent-gh is current: $installed")
}
else {
  # Write a fresh file and move it into place, so a running agent-gh never
  # reads half a script. Copying the bytes leaves behind any download mark on
  # the checkout, which RemoteSigned would otherwise refuse.
  $staged = "$installed.next.$([guid]::NewGuid().ToString('N'))"
  try {
    [System.IO.File]::WriteAllBytes($staged, [System.IO.File]::ReadAllBytes($source))
    [System.IO.File]::Move($staged, $installed, $true)
  }
  finally {
    if ([System.IO.File]::Exists($staged)) { [System.IO.File]::Delete($staged) }
  }
  [Console]::Out.WriteLine("Installed agent-gh: $installed")
}

if (-not (Test-PathEntry $env:PATH $binDir)) {
  if ($AddToPath) {
    if (-not $IsWindows) {
      [Console]::Error.WriteLine("Add $binDir to PATH in your shell profile.")
      exit 1
    }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Test-PathEntry $userPath $binDir)) {
      $next = if ($userPath) { "$userPath;$binDir" } else { $binDir }
      [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    }
    [Console]::Out.WriteLine("Added $binDir to your user PATH. Open a new PowerShell window to use agent-gh.")
  }
  else {
    [Console]::Out.WriteLine("$binDir is not on PATH. Run pnpm sync:context -- -AddToPath, or add it yourself.")
  }
}

# Loads the wrapper's functions without running a command, to find gh the
# same way agent-gh will.
. $source
if ($null -eq (Resolve-AgentGh -Candidates (Get-AgentGhCandidates $targetHome) -UserHome $targetHome)) {
  [Console]::Out.WriteLine('No trusted GitHub CLI found. Install it with: winget install --id GitHub.cli')
}

$token = [System.IO.Path]::Combine($targetHome, '.config', 'wolfstar-agent-kit', 'github-public-token')
if (-not [System.IO.File]::Exists($token)) {
  [Console]::Out.WriteLine('No public GitHub token yet. Run agent-gh --setup-token to save it.')
}
if ($IsWindows) {
  [Console]::Out.WriteLine('Windows installs agent-gh only. Sync the Agent instructions and hooks from Linux or WSL.')
}
exit 0
