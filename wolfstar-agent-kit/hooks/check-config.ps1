#Requires -Version 7.0
# Shared helpers for the PowerShell hooks, the twin of check-config.sh.
# Dot-source it from a hook: . "$PSScriptRoot/check-config.ps1"
#
# A hook reads one JSON object on stdin and answers with one JSON object on
# stdout. It never throws for a bad input; an unreadable input allows the call.

Set-StrictMode -Version 3.0

$script:HookUtf8 = [System.Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $script:HookUtf8 }
catch [System.IO.IOException] { } # No console is attached, so there is no encoding to set.

# Reads the hook input. Returns $null when stdin is empty or not JSON.
function Read-HookInput {
  $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $script:HookUtf8)
  try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  try { return ($text | ConvertFrom-Json -Depth 20) }
  catch [System.ArgumentException] { return $null }
}

# Reads a nested field as text. A missing field, a null, or a missing object
# reads as an empty string, the way jq -r '.a.b // empty' does.
function Get-HookField($Object, [string[]]$Path) {
  $current = $Object
  foreach ($name in $Path) {
    if ($null -eq $current) { return '' }
    $property = $current.PSObject.Properties[$name]
    if ($null -eq $property) { return '' }
    $current = $property.Value
  }
  if ($null -eq $current) { return '' }
  if ($current -is [string]) { return $current }
  return ($current | ConvertTo-Json -Compress -Depth 10)
}

# A project turns a hook off in .claude/hooks.json: {"disabled": ["name"]}.
function Test-HookDisabled([string]$Name) {
  $config = [System.IO.Path]::Combine((Get-Location).ProviderPath, '.claude', 'hooks.json')
  if (-not [System.IO.File]::Exists($config)) { return $false }
  try { $parsed = [System.IO.File]::ReadAllText($config) | ConvertFrom-Json -Depth 10 }
  catch [System.ArgumentException] { return $false } # A broken config disables nothing, as jq's failure does.
  $property = $parsed.PSObject.Properties['disabled']
  if ($null -eq $property -or $null -eq $property.Value) { return $false }
  return @($property.Value) -ccontains $Name
}

function Write-HookJson($Value) {
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 10) + "`n")
}

function Write-HookDeny([string]$Reason) {
  Write-HookJson ([ordered]@{
      hookSpecificOutput = [ordered]@{
        hookEventName            = 'PreToolUse'
        permissionDecision       = 'deny'
        permissionDecisionReason = $Reason
      }
    })
}

function Write-HookRewrite([string]$Command, [string]$Reason) {
  Write-HookJson ([ordered]@{
      hookSpecificOutput = [ordered]@{
        hookEventName            = 'PreToolUse'
        permissionDecision       = 'allow'
        permissionDecisionReason = $Reason
        updatedInput             = [ordered]@{ command = $Command }
      }
    })
}

function Write-HookFollowup([string]$Message) {
  Write-HookJson ([ordered]@{
      hookSpecificOutput = [ordered]@{
        hookEventName = 'PostToolUse'
        decision      = 'followup_message'
        message       = $Message
      }
    })
}

# One temp file per session, so a PostToolUse hook suggests each fix once.
function Get-HookSessionFile([string]$Prefix) {
  $session = if ($env:CLAUDE_SESSION_ID) { $env:CLAUDE_SESSION_ID } else { "$PID" }
  return [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "$Prefix-$session")
}

function Test-HookSessionMark([string]$File, [string]$Text) {
  if (-not [System.IO.File]::Exists($File)) { return $false }
  return [System.IO.File]::ReadAllText($File).Contains($Text)
}

function Add-HookSessionMark([string]$File, [string]$Text) {
  [System.IO.File]::AppendAllText($File, "$Text`n")
}
