#Requires -Version 7.0
# Block modifications to branches with merged PRs. The twin of merged-branch-guard.sh.
. "$PSScriptRoot/check-config.ps1"
if (Test-HookDisabled 'merged-branch-guard') { exit 0 }

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'
if ($command -eq '') { exit 0 }

# Only check git mutation commands.
if ($command -cnotmatch '^git\s+(push|commit|rebase|cherry-pick|merge|reset)') { exit 0 }

$branch = (& git branch --show-current 2>$null)
if ([string]::IsNullOrEmpty($branch)) { exit 0 }
$branch = "$branch".Trim()
if ($branch -ceq 'main' -or $branch -ceq 'master') { exit 0 }

# Cache a merged branch per session, so the next call needs no GitHub lookup.
$cache = Get-HookSessionFile 'claude-merged-branch'
if (Test-HookSessionMark $cache $branch) {
  Write-HookDeny "Branch ``$branch`` has a merged PR. Switch to a new branch or main before making changes."
  exit 0
}

# Query GitHub only if gh is available.
if ($null -eq (Get-Command gh -CommandType Application -ErrorAction SilentlyContinue)) { exit 0 }

$mergedPr = (& gh pr list --head $branch --state merged --json number --jq '.[0].number' 2>$null)
if (-not [string]::IsNullOrWhiteSpace("$mergedPr")) {
  Add-HookSessionMark $cache $branch
  Write-HookDeny "Branch ``$branch`` has a merged PR (#$("$mergedPr".Trim())). Switch to a new branch or main before making changes."
}
exit 0
