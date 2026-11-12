#Requires -Version 7.0
# PostToolUse (Write|Edit): lint and format the edited file with Oxlint and Oxfmt.
. "$PSScriptRoot/check-config.ps1"
if (Test-HookDisabled 'oxlint') { exit 0 }

$filePath = Get-HookField (Read-HookInput) 'tool_input', 'file_path'

# Skip files Oxlint does not lint.
if ($filePath -cnotmatch '\.(js|jsx|ts|tsx|vue|mjs|cjs|md|json|yaml|yml)$') { exit 0 }
# Skip node_modules and build output.
if ($filePath -cmatch 'node_modules|[/\\]dist[/\\]|\.nuxt') { exit 0 }

# A project binary wins over one on PATH. Windows installs a .cmd shim.
function Find-HookTool([string]$Name) {
  foreach ($candidate in "node_modules/.bin/$Name.cmd", "node_modules/.bin/$Name") {
    if ([System.IO.File]::Exists($candidate)) { return [System.IO.Path]::GetFullPath($candidate) }
  }
  $found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  return $null
}

# A failed lint never blocks an edit, as in the bash hook.
$oxlint = Find-HookTool 'oxlint'
if ($oxlint) { & $oxlint $filePath --fix --allow no-unused-vars --allow prefer-const | Out-Null }
$oxfmt = Find-HookTool 'oxfmt'
if ($oxfmt) { & $oxfmt $filePath | Out-Null }
exit 0
