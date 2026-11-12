#Requires -Version 7.0
# Keeps every agent's email access read only. The twin of himalaya-read-only.sh.
#
# The rule is an allowlist. A denylist of mutating subcommands would miss the
# next subcommand himalaya adds. A call counts only at a command position.
. "$PSScriptRoot/check-config.ps1"
if (Test-HookDisabled 'himalaya-read-only') { exit 0 }

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'
if ($command -eq '') { exit 0 }

# Subcommands that only read. A trailing * is a prefix match, as in the bash case list.
$allowed = @(
  'envelope list *', 'envelope list', 'envelope thread*', 'envelope watch*',
  'message read*', 'message export*', 'folder list*', 'attachment download*',
  'account list*', 'manual *', 'completion *'
)
$guarded = @('envelope', 'message', 'folder', 'attachment', 'account', 'flag', 'template', 'send', 'manual', 'completion')

# Every himalaya call in the command, wherever it sits in a pipeline.
foreach ($line in ($command -split "`n")) {
  foreach ($match in [regex]::Matches($line, '(^|[|&;(]\s*)himalaya(\s+[^|&;)]*)?')) {
    $arguments = $match.Value -creplace '^[^h]*himalaya\s*', ''
    # Options carry no subcommand, so read the first two bare words.
    $words = @($arguments.Split(' ') | Where-Object { $_ -ne '' -and -not $_.StartsWith('-') } | Select-Object -First 2)
    $first = if ($words.Count -gt 0) { $words[0] } else { '' }
    $second = if ($words.Count -gt 1) { $words[1] } else { '' }
    # No subcommand means help or version output.
    if ($first -eq '') { continue }
    $pair = "$first $second"
    $isAllowed = $false
    foreach ($pattern in $allowed) { if ($pair -clike $pattern) { $isAllowed = $true; break } }
    if ($isAllowed -or $guarded -cnotcontains $first) { continue }
    $subcommand = if ($second -ne '') { "$first $second" } else { $first }
    Write-HookDeny "Email access is read only. ``himalaya $subcommand`` can change or send mail. Read with: envelope list, envelope thread, message read, message export, folder list, attachment download, account list. If you need a change, ask Wolfstar to make it."
    exit 0
  }
}
exit 0
