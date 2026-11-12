#Requires -Version 7.0
# Context-aware session start: detect the project type and show relevant info.
# The twin of session-start.sh.
. "$PSScriptRoot/check-config.ps1"

$agentType = Get-HookField (Read-HookInput) 'agent_type'
# Quiet mode for sub-agents shows only warnings.
$quiet = $agentType -ceq 'task'

$escape = [char]27
function Write-Colored([string]$Code, [string]$Text) { [Console]::Out.Write("$escape[$($Code)m$Text$escape[0m`n") }
function Show([string]$Text) { if (-not $quiet) { Write-Colored '36' $Text } }
function Show-Dim([string]$Text) { if (-not $quiet) { Write-Colored '90' $Text } }
function Show-Warning([string]$Text) { Write-Colored '33' $Text }

# Finds a file by name within a shallow depth, skipping node_modules.
function Find-Shallow([string]$Directory, [string]$Name, [int]$Depth) {
  foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($Directory)) {
    $leaf = [System.IO.Path]::GetFileName($entry)
    if ([System.IO.Directory]::Exists($entry)) {
      if ($leaf -ceq 'node_modules' -or $Depth -le 1) { continue }
      if (Find-Shallow $entry $Name ($Depth - 1)) { return $true }
    }
    elseif ($leaf -ceq $Name) { return $true }
  }
  return $false
}

$branch = (& git branch --show-current 2>$null)
$branch = if ($branch) { "$branch".Trim() } else { '' }

if (Test-Path -LiteralPath 'package.json' -PathType Leaf) {
  $text = [System.IO.File]::ReadAllText('package.json')
  $name = 'unnamed'
  $hasWorkspaces = $false
  try {
    $package = $text | ConvertFrom-Json -Depth 20
    if ($package.PSObject.Properties['name'] -and $package.name) { $name = $package.name }
    $hasWorkspaces = $null -ne $package.PSObject.Properties['workspaces']
  }
  catch [System.ArgumentException] { } # A broken package.json keeps the defaults.

  # Detect a monorepo, by pnpm workspace or the package.json workspaces field.
  $workspace = $hasWorkspaces -or (Test-Path -LiteralPath 'pnpm-workspace.yaml' -PathType Leaf)

  # In a monorepo the indicators live in sub-packages, so a shallow scan runs before "Node Project".
  if ((Test-Path -LiteralPath 'src/module.ts' -PathType Leaf) -or $text.Contains('nuxt-module-build')) { Show "Nuxt Module: $name" }
  elseif (Test-Path -LiteralPath 'nuxt.config.ts' -PathType Leaf) { Show "Nuxt App: $name" }
  elseif (Test-Path -LiteralPath 'build.config.ts' -PathType Leaf) { Show "UnJS Package: $name" }
  elseif ($text.Contains('"vue"')) { Show "Vue Project: $name" }
  elseif ($workspace -and (Find-Shallow '.' 'nuxt.config.ts' 3)) { Show "Nuxt Monorepo: $name" }
  elseif ($workspace) { Show "Monorepo: $name" }
  else { Show "Node Project: $name" }

  if ($branch -ne '') {
    & git diff-index --quiet HEAD -- 2>$null
    if ($LASTEXITCODE -ne 0) { Show-Dim "Branch: $branch (dirty)" } else { Show-Dim "Branch: $branch" }
    $last = (& git log -1 --format=%s 2>$null)
    if ($last) {
      $last = "$last"
      Show-Dim "Last: $($last.Substring(0, [Math]::Min(50, $last.Length)))"
    }
  }

  # Package manager check.
  if (Test-Path -LiteralPath 'pnpm-lock.yaml' -PathType Leaf) { }
  elseif (Test-Path -LiteralPath 'package-lock.json' -PathType Leaf) { Show-Warning 'npm detected - use pnpm' }
  elseif (Test-Path -LiteralPath 'yarn.lock' -PathType Leaf) { Show-Warning 'yarn detected - use pnpm' }
}

# Project instructions hint.
$instructions = '.claude/AGENTS.md', 'AGENTS.md', '.claude/CLAUDE.md', 'CLAUDE.md'
if (-not ($instructions | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })) {
  Show-Dim 'Tip: /init-module to add AGENTS.md'
}
exit 0
