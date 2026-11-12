#Requires -Version 7.0
# The Windows half of `pnpm sync:context` and `pnpm check:context`.
#
# Windows has no bash, so it installs what has a native PowerShell build:
# agent-gh, the PowerShell twins of the plugin hooks with their Windows
# manifest, and the opencode plugin that runs them. The instructions and git
# hooks are bash, so sync those from Linux or WSL with
# scripts/sync-agent-context.sh.
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

# The plugin hooks. The Windows manifest is the only place the PowerShell hooks
# register, as plugin.json is for the bash hooks. Both land where the Linux sync
# puts them, so opencode finds one layout on every platform.
$pluginRoot = [System.IO.Path]::Combine((Split-Path -Parent $PSScriptRoot), 'wolfstar-agent-kit')
$hooksSource = [System.IO.Path]::Combine($pluginRoot, 'hooks')
$manifestSource = [System.IO.Path]::Combine($pluginRoot, '.claude-plugin', 'plugin.windows.json')
$opencodeSource = [System.IO.Path]::Combine($pluginRoot, 'plugins', 'opencode', 'wolfstar-hooks.ts')
$shareDir = [System.IO.Path]::Combine($targetHome, '.local', 'share', 'wolfstar-agent-kit')
$hooksTarget = [System.IO.Path]::Combine($shareDir, 'hooks')
$manifestTarget = [System.IO.Path]::Combine($shareDir, '.claude-plugin', 'plugin.json')
$opencodeTarget = [System.IO.Path]::Combine($targetHome, '.config', 'opencode', 'plugins', 'wolfstar-hooks.ts')

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

# Every hook file the Windows manifest registers, once each, in manifest order.
function Get-ManifestHookFiles([string]$Manifest) {
  $parsed = [System.IO.File]::ReadAllText($Manifest) | ConvertFrom-Json -Depth 20
  $files = [System.Collections.Generic.List[string]]::new()
  foreach ($event in $parsed.hooks.PSObject.Properties) {
    foreach ($group in $event.Value) {
      foreach ($hook in $group.hooks) {
        $found = [regex]::Match($hook.command, '([A-Za-z0-9._-]+\.ps1)"?\s*$')
        if ($found.Success -and -not $files.Contains($found.Groups[1].Value)) { $files.Add($found.Groups[1].Value) }
      }
    }
  }
  return , $files.ToArray()
}

# Every sibling script the hooks dot-source. The manifest never lists them,
# because they are not hooks.
function Get-SupportFiles([string]$HooksDirectory, [string[]]$HookFiles) {
  $files = [System.Collections.Generic.List[string]]::new()
  foreach ($hook in $HookFiles) {
    $path = [System.IO.Path]::Combine($HooksDirectory, $hook)
    if (-not [System.IO.File]::Exists($path)) { continue }
    foreach ($line in [System.IO.File]::ReadAllLines($path)) {
      $found = [regex]::Match($line, '^\s*\.\s+"\$PSScriptRoot/([A-Za-z0-9._-]+)"')
      if ($found.Success -and -not $files.Contains($found.Groups[1].Value)) { $files.Add($found.Groups[1].Value) }
    }
  }
  return , $files.ToArray()
}

# The files the hook install places, as source and target pairs. Support files
# come first, so a partial install never leaves a hook without its loader.
function Get-HookInstallPlan {
  if (-not [System.IO.File]::Exists($manifestSource)) {
    [Console]::Error.WriteLine("The Windows hook manifest is missing: $manifestSource")
    exit 1
  }
  # Assigning the result unrolls the array the helpers return with a leading comma.
  [string[]]$hookFiles = Get-ManifestHookFiles $manifestSource
  [string[]]$supportFiles = Get-SupportFiles $hooksSource $hookFiles
  $plan = [System.Collections.Generic.List[hashtable]]::new()
  foreach ($file in ($supportFiles + $hookFiles)) {
    $plan.Add(@{ Source = [System.IO.Path]::Combine($hooksSource, $file); Target = [System.IO.Path]::Combine($hooksTarget, $file); Label = $file })
  }
  $plan.Add(@{ Source = $manifestSource; Target = $manifestTarget; Label = 'plugin.json' })
  $plan.Add(@{ Source = $opencodeSource; Target = $opencodeTarget; Label = 'wolfstar-hooks.ts' })
  return , $plan.ToArray()
}

# Write a fresh file and move it into place, so a running hook never reads half
# a script. Copying the bytes leaves behind any download mark on the checkout,
# which RemoteSigned would otherwise refuse.
function Copy-IntoPlace([string]$From, [string]$To) {
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($To)) | Out-Null
  $staged = "$To.next.$([guid]::NewGuid().ToString('N'))"
  try {
    [System.IO.File]::WriteAllBytes($staged, [System.IO.File]::ReadAllBytes($From))
    [System.IO.File]::Move($staged, $To, $true)
  }
  finally {
    if ([System.IO.File]::Exists($staged)) { [System.IO.File]::Delete($staged) }
  }
}

if ($Mode -eq 'check') {
  $failed = $false
  if (-not (Test-SameContent $source $installed)) {
    [Console]::Out.WriteLine('FAIL  The public GitHub CLI differs. Run pnpm sync:context.')
    $failed = $true
  }
  else { [Console]::Out.WriteLine('ok    agent-gh matches its tracked source') }
  foreach ($item in (Get-HookInstallPlan)) {
    if (-not [System.IO.File]::Exists($item.Target)) {
      [Console]::Out.WriteLine("FAIL  $($item.Label) is not installed. Run pnpm sync:context.")
      $failed = $true
    }
    elseif (-not (Test-SameContent $item.Source $item.Target)) {
      [Console]::Out.WriteLine("FAIL  $($item.Label) differs. Run pnpm sync:context.")
      $failed = $true
    }
  }
  if (-not $failed) { [Console]::Out.WriteLine('ok    the PowerShell hooks match their tracked sources') }
  exit ([int]$failed)
}

[System.IO.Directory]::CreateDirectory($binDir) | Out-Null
if (Test-SameContent $source $installed) {
  [Console]::Out.WriteLine("agent-gh is current: $installed")
}
else {
  Copy-IntoPlace $source $installed
  [Console]::Out.WriteLine("Installed agent-gh: $installed")
}

$changed = 0
foreach ($item in (Get-HookInstallPlan)) {
  if (Test-SameContent $item.Source $item.Target) { continue }
  Copy-IntoPlace $item.Source $item.Target
  $changed++
}
if ($changed -gt 0) { [Console]::Out.WriteLine("Installed $changed PowerShell hook files: $shareDir") }
else { [Console]::Out.WriteLine("The PowerShell hooks are current: $shareDir") }

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
  [Console]::Out.WriteLine('Windows installs agent-gh, the PowerShell hooks, and the opencode plugin. Sync the Agent instructions from Linux or WSL.')
  [Console]::Out.WriteLine("Claude Code runs the hooks from a plugin: /plugin install $shareDir")
}
exit 0
