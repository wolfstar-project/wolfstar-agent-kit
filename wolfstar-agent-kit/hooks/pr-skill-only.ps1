#Requires -Version 7.0
# Require the PR skill for pull request creation and description changes.
# The twin of pr-skill-only.sh.
. "$PSScriptRoot/check-config.ps1"
. "$PSScriptRoot/command-text.ps1"
if (Test-HookDisabled 'pr-skill-only') { exit 0 }

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'
if ($command -eq '') { exit 0 }

# A multi-line call puts gh on its own line, so the text is normalized first.
$code = ConvertTo-CommandCode $command

$commandStart = '(^|[|&;(`]\s*)'
# An inline assignment or an env or timeout wrapper keeps gh at the command
# position, so the patterns must see through a leading prefix of them.
$wrap = '(env|timeout(\s+\S+)?)'
$leadItem = '[A-Za-z_][A-Za-z0-9_]*=\S*|env|timeout(\s+\S+)?'
$lead = "((${leadItem})\s+)*"
# The allow patterns accept wrappers around the skill assignment, but the
# assignment itself must be exactly WOLFSTAR_AGENT_PR_SKILL=1.
$skillItem = 'WOLFSTAR_AGENT_PR_SKILL=1|env|timeout(\s+\S+)?'
$skillLead = "((${skillItem})\s+)*WOLFSTAR_AGENT_PR_SKILL=1\s+(${wrap}\s+)*"
$prCreate = "${commandStart}${lead}gh\s+pr\s+create(\s|$)"
$prBodyEdit = "${commandStart}${lead}gh\s+pr\s+edit\s[^|&;]*(--body-file|--body|-b)(=|\s|$)"
$skillCreate = "${commandStart}${skillLead}gh\s+pr\s+create(\s|$)"
$skillBodyEdit = "${commandStart}${skillLead}gh\s+pr\s+edit\s[^|&;]*(--body-file|--body|-b)(=|\s|$)"

if ($code -cmatch $skillCreate -or $code -cmatch $skillBodyEdit) { exit 0 }

if ($code -cmatch $prCreate -or $code -cmatch $prBodyEdit) {
  Write-HookDeny 'Use the Wolfstar Agent Kit PR skill: `wolfstar-agent-kit:pr`. Claude Code invokes it as `/wolfstar-agent-kit:pr`. Codex invokes it as `$wolfstar-agent-kit:pr`. It loads the repository template and required disclosure.'
}
exit 0
