#Requires -Version 7.0
# PostToolUse (Bash): detect "command not found" and flag incompatibilities.
# Suggests an install fix once per session per command. The twin of command-not-found.sh.
. "$PSScriptRoot/check-config.ps1"
if (Test-HookDisabled 'command-not-found') { exit 0 }

$hook = Read-HookInput
$toolOutput = Get-HookField $hook 'tool_output'
$command = Get-HookField $hook 'tool_input', 'command'
if ($toolOutput -eq '') { exit 0 }

$sessionFile = Get-HookSessionFile 'claude-cmd-notfound'

function Get-InstallHint([string]$Name) {
  if ($IsMacOS) { return "brew install $Name" }
  if ($IsWindows) { return "winget install $Name`` or ``scoop install $Name" }
  return "sudo apt install $Name`` or ``pacman -S $Name"
}

# Detect "command not found" patterns, in bash and in PowerShell wording.
$name = ''
if ($toolOutput -match '(command not found|not found in PATH)') {
  $found = [regex]::Match($toolOutput, '(?i)(bash: |zsh: )?(?<name>[a-zA-Z0-9_.-]+): (command )?not found')
  if ($found.Success) { $name = $found.Groups['name'].Value }
}
if ($name -eq '') {
  $found = [regex]::Match($toolOutput, "The term '(?<name>[^']+)' is not recognized|'(?<name>[^']+)' is not recognized as an internal or external command")
  if ($found.Success) { $name = $found.Groups['name'].Value }
}
# Detect "No such file or directory" for executables, not regular files.
if ($name -eq '' -and $toolOutput -cmatch 'No such file or directory.*bin/') {
  $found = [regex]::Match($toolOutput, '(?<name>[a-zA-Z0-9_.-]+): No such file or directory')
  if ($found.Success) { $name = $found.Groups['name'].Value }
}

if ($name -ne '') {
  if (Test-HookSessionMark $sessionFile $name) { exit 0 }
  Add-HookSessionMark $sessionFile $name
  Write-HookFollowup "⚠️ ``$name`` is not installed. Try: ``$(Get-InstallHint $name)``"
  exit 0
}

# Detect BSD/GNU incompatibilities.
if ($toolOutput -match '(invalid option|illegal option|unrecognized option)') {
  $badOption = [regex]::Match($toolOutput, '(?i)(invalid|illegal|unrecognized) option[: -]*[''"]?-?-?[a-zA-Z0-9-]+').Value
  $first = ($command.Trim() -split '\s+' | Select-Object -First 1)
  $baseCommand = if ($first) { Split-Path -Leaf $first } else { '' }
  if ($baseCommand -eq '') { exit 0 }
  if (Test-HookSessionMark $sessionFile "compat-$baseCommand") { exit 0 }
  Add-HookSessionMark $sessionFile "compat-$baseCommand"
  if ($IsMacOS) {
    Write-HookFollowup "⚠️ BSD/GNU incompatibility: ``$badOption`` for ``$baseCommand``. macOS ships BSD utils — install GNU version: ``brew install coreutils`` (or ``brew install gnu-sed``, ``brew install grep``, etc.)"
  }
  else {
    Write-HookFollowup "⚠️ ``$badOption`` for ``$baseCommand`` — check if the flag exists in this version (``$baseCommand --help``)."
  }
}
exit 0
