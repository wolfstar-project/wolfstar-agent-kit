#Requires -Version 7.0
# Keeps every worktree under the `wt` (worktrunk) tool and its canonical path.
# The twin of wt-only.sh. A call counts only at a command position, so prose
# that names a command or the banned path is not a call.
. "$PSScriptRoot/check-config.ps1"
. "$PSScriptRoot/command-text.ps1"
if (Test-HookDisabled 'wt-only') { exit 0 }

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'
if ($command -eq '') { exit 0 }

$code = ConvertTo-CommandCode $command

$commandStart = '(^|[|&;(]\s*)'
$commandEnd = '(\s|;|$)'
$gitWorktree = $commandStart + 'git\s+([^|&;]*\s)?worktree\s+(add|remove|move|prune)' + $commandEnd
$wtClobber = $commandStart + 'wt\s+[^|&;]*--clobber(=|' + $commandEnd + ')'
$wtForceRemove = $commandStart + 'wt\s+remove\s+[^|&;]*--force'

if ($code -cmatch $gitWorktree) {
  Write-HookDeny 'Use wt, not git worktree. Create: wt switch --create <branch> --base <base>. Enter: wt switch <branch>. Remove: wt remove <branch>. Read paths from wt list --format=json. See references/worktree-isolation.md.'
  exit 0
}
# Windows spells the banned directory with a backslash.
if ($code.Contains('.claude/worktrees') -or $code.Contains('.claude\worktrees')) {
  Write-HookDeny '.claude/worktrees is banned. wt owns every worktree at <parent>/<repo>.<branch-slug>. See references/worktree-isolation.md.'
  exit 0
}
if ($code -cmatch $wtClobber) {
  Write-HookDeny "wt switch --clobber destroys another task's worktree. Pick a different branch name."
  exit 0
}
if ($code -cmatch $wtForceRemove) {
  Write-HookDeny 'wt remove --force drops unmerged work. Merge or land the branch first.'
  exit 0
}
exit 0
