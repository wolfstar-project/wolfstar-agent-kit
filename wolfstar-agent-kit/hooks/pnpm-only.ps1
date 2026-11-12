#Requires -Version 7.0
. "$PSScriptRoot/check-config.ps1"

$command = Get-HookField (Read-HookInput) 'tool_input', 'command'

if ($command -cmatch '^npm\s') { Write-HookRewrite ('pnpm' + $command.Substring(3)) 'Rewritten: npm → pnpm'; exit 0 }
if ($command -cmatch '^yarn\s') { Write-HookRewrite ('pnpm' + $command.Substring(4)) 'Rewritten: yarn → pnpm'; exit 0 }
if ($command -cmatch '^npx\s') { Write-HookRewrite ('pnpm dlx' + $command.Substring(3)) 'Rewritten: npx → pnpm dlx'; exit 0 }
exit 0
