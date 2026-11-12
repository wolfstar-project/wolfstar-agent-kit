#Requires -Version 7.0
# Inject commit guidelines for git commit. additionalContext does not block.
. "$PSScriptRoot/check-config.ps1"

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'
if ($command -cmatch '^git\s+commit') {
  Write-HookJson ([ordered]@{
      additionalContext = 'Commit format: type(scope): description. Types: feat/fix/docs/refactor/test/chore. Scope: monorepo folder or treeshakable export name, omit if neither applies. Subject under 70 chars.'
    })
}
exit 0
