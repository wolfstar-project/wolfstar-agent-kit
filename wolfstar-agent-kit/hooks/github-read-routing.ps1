#Requires -Version 7.0
# Keep public reads on the separate GitHub account. The twin of github-read-routing.sh.
. "$PSScriptRoot/check-config.ps1"
. "$PSScriptRoot/command-text.ps1"
if (Test-HookDisabled 'github-read-routing') { exit 0 }

$hook = Read-HookInput
$command = Get-HookField $hook 'tool_input', 'command'
if ($command -eq '') { $command = Get-HookField $hook 'tool_input', 'cmd' }
if ($command -eq '') { exit 0 }
$code = ConvertTo-CommandCode $command -QuotedTokens

# The private exception belongs to one invocation and one explicit repository.
# It cannot grant the following command access to the ordinary account.
$leadItem = '[A-Za-z_][A-Za-z0-9_]*=\S*|env(\s+(-u\s+[A-Za-z_][A-Za-z0-9_]*|--unset=\S+|-i|--ignore-environment))*|timeout(\s+\S+)?|bash\s+-c|sh\s+-c|command|exec|do|then|else|!'
$lead = "((${leadItem})\s+)*"
$globalRepo = '((--repo|-R)\s+\S+\s+|--repo=\S+\s+)*'
# Windows installs gh.exe, and its path may use backslashes.
$readCall = '^[\s(`]*' + $lead + '(\S*[/\\])?gh(\.exe)?\s+' + $globalRepo + '(?<family>api|pr|issue|run|repo|search|release)\s+(?<action>\S+)'

$readCommands = @(
  'pr view', 'pr list', 'pr checks', 'pr diff', 'issue view', 'issue list',
  'repo view', 'repo list', 'run view', 'run list', 'run watch', 'run download',
  'release view', 'release list', 'release download'
)

function Write-RoutingDeny([string]$Reason) { Write-HookDeny $Reason; exit 0 }

foreach ($call in ($code -split '[;|&]')) {
  $matched = [regex]::Match($call, $readCall)
  if (-not $matched.Success) { continue }
  $invocation = $matched.Value
  $family = $matched.Groups['family'].Value
  $action = $matched.Groups['action'].Value
  # GitHub writes retain the existing approval and PR-skill rules.
  if ($family -ceq 'api') {
    if ($call -cmatch '\s(-X\s*|--method(=|\s+))(POST|PATCH|PUT|DELETE)(\s|$)') { continue }
    if ($action -ceq 'user' -and -not $call.Contains('graphql')) { continue }
  }
  else {
    $isRead = $readCommands -ccontains "$family $action" -or $family -ceq 'search'
    if (-not $isRead) { continue }
  }

  # A private credential exception must not permit three-second CI polling.
  $isWatch = "$family $action" -ceq 'run watch' -or ("$family $action" -ceq 'pr checks' -and $call -cmatch '\s--watch(=true)?(\s|$)')
  if ($isWatch) {
    $interval = ''
    $pending = $false
    foreach ($word in ($call -split '\s+' | Where-Object { $_ -ne '' })) {
      if ($pending) { $interval = $word; $pending = $false; continue }
      if ($word -ceq '--interval' -or $word -ceq '-i') { $pending = $true }
      elseif ($word.StartsWith('--interval=', [StringComparison]::Ordinal)) { $interval = $word.Substring(11) }
      elseif ($word -cmatch '^-i[0-9]') { $interval = $word.Substring(2) }
    }
    if ($pending -or $interval -cnotmatch '^[0-9]{1,9}$' -or [int64]$interval -lt 60) {
      Write-RoutingDeny 'If you must watch private CI, set --interval 60 or higher. Use the Service Control API for tracked pull requests.'
    }
  }

  $private = [regex]::Match($invocation, 'WOLFSTAR_AGENT_GITHUB_PRIVATE=([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(\s|$)')
  if ($private.Success) {
    $repository = $private.Groups[1].Value
    # API paths and explicit CLI repository arguments must match the exception.
    if ($family -ceq 'api') {
      if ($action -ceq "repos/$repository" -or $action.StartsWith("repos/$repository/", [StringComparison]::Ordinal) `
          -or $action -ceq "/repos/$repository" -or $action.StartsWith("/repos/$repository/", [StringComparison]::Ordinal)) { continue }
    }
    else {
      $hasMatch = $false
      $hasMismatch = $false
      $words = @($call -split '\s+' | Where-Object { $_ -ne '' })
      for ($index = 0; $index -lt $words.Count; $index++) {
        $word = $words[$index]
        if ($word -ceq '--repo' -or $word -ceq '-R') {
          $value = if ($index + 1 -lt $words.Count) { $words[$index + 1] } else { '' }
          if ($value -ceq $repository) { $hasMatch = $true } else { $hasMismatch = $true }
        }
        elseif ($word.StartsWith('--repo=', [StringComparison]::Ordinal)) {
          if ($word.Substring(7) -ceq $repository) { $hasMatch = $true } else { $hasMismatch = $true }
        }
      }
      $view = [regex]::Match($call, '\srepo\s+view\s+(\S+)')
      if ($view.Success -and $view.Groups[1].Value -ceq $repository) { $hasMatch = $true }
      if ($hasMatch -and -not $hasMismatch) { continue }
    }
  }
  Write-RoutingDeny 'Use agent-gh for public GitHub reads. For verified private repositories, set WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/repo on that command. Specify the same repository. Never switch credentials after agent-gh fails. On a host with no controller, agent-gh --full reads with your own gh login. Use the Service Control API to watch a tracked pull request.'
}
exit 0
