#Requires -Version 7.0
# Public GitHub reads use the machine account. Controller writes use ordinary gh.
#
# The native PowerShell twin of github-public.sh, for Windows hosts without
# bash. The read policy below must stay equal to the bash case list:
# scripts/github-public-ps.test.ts compares the two and runs one refusal table
# against both wrappers.
#
# The script declares no param block, so PowerShell binds every argument to
# $args and none of them to a parameter of its own.

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:AgentGhReadCommands = @(
  'pr view', 'pr list', 'pr checks', 'pr diff',
  'issue view', 'issue list', 'repo view', 'repo list',
  'search code', 'search commits', 'search issues', 'search prs', 'search repos',
  'run view', 'run list', 'run watch', 'run download', 'release view', 'release list', 'release download'
)

# Variables that select another credential, host, or debug output for gh.
$script:AgentGhClearedVariables = @('GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG')

# The principals a token file may grant access to on Windows: the current user,
# SYSTEM, and the local Administrators group.
$script:AgentGhSystemSid = 'S-1-5-18'
$script:AgentGhAdministratorsSid = 'S-1-5-32-544'

# The machine account the token belongs to. The wrapper only names it; the
# installers compare it with the login the token returns.
function Get-AgentGhLogin {
  if ($env:WOLFSTAR_AGENT_GITHUB_LOGIN) { return $env:WOLFSTAR_AGENT_GITHUB_LOGIN }
  return 'wolfstarbot'
}

class AgentGhRefusal : System.Exception {
  AgentGhRefusal([string]$Message) : base($Message) {}
}

function Stop-AgentGh([string]$Message) {
  throw [AgentGhRefusal]::new($Message)
}

# Bash reads $HOME. PowerShell on Windows fills $HOME from the user profile, so
# read USERPROFILE there to honour the same override a test or service sets.
function Get-AgentGhHome {
  if ($IsWindows -and $env:USERPROFILE) { return $env:USERPROFILE }
  if ($env:HOME) { return $env:HOME }
  return $HOME
}

function Get-AgentGhTokenPath([string]$UserHome = (Get-AgentGhHome)) {
  return [System.IO.Path]::Combine($UserHome, '.config', 'wolfstar-agent-kit', 'github-public-token')
}

function Get-AgentGhConfigDir([string]$UserHome = (Get-AgentGhHome)) {
  return [System.IO.Path]::Combine($UserHome, '.config', 'wolfstar-agent-kit', 'gh-public')
}

# Returns the arguments to forward, or throws AgentGhRefusal. Pure: it reads no
# file and no environment, so the tests drive it directly. Every comparison is
# case sensitive, as bash case patterns are.
function Get-AgentGhArguments([string[]]$Arguments) {
  $first = if ($Arguments.Count -gt 0) { $Arguments[0] } else { '' }
  $second = if ($Arguments.Count -gt 1) { $Arguments[1] } else { '' }
  $forward = [System.Collections.Generic.List[string]]::new()
  foreach ($argument in $Arguments) { $forward.Add($argument) }

  if ($first -ceq 'api') {
    $endpoint = $second
    if ($endpoint -eq '' -or $endpoint.StartsWith('-')) { Stop-AgentGh 'Provide the API endpoint before its options.' }
    if ($endpoint.Contains(':') -or $endpoint.Contains('//') -or $endpoint.Contains('\')) { Stop-AgentGh 'Use a GitHub API path.' }
    $trimmed = if ($endpoint.StartsWith('/')) { $endpoint.Substring(1) } else { $endpoint }
    if ($trimmed -ceq 'graphql') { Stop-AgentGh 'Use GitHub CLI read commands instead of raw GraphQL.' }
    $expectMethod = $false
    for ($index = 2; $index -lt $Arguments.Count; $index++) {
      $argument = $Arguments[$index]
      if ($expectMethod) {
        if ($argument -cne 'GET') { Stop-AgentGh 'Agents may only read GitHub.' }
        $expectMethod = $false
        continue
      }
      if ($argument -ceq '-X' -or $argument -ceq '--method') { $expectMethod = $true; continue }
      if ($argument -ceq '-XGET' -or $argument -ceq '--method=GET') { continue }
      if ($argument -clike '-X*' -or $argument -clike '--method*') { Stop-AgentGh 'Agents may only read GitHub.' }
      if ($argument -clike '-H*' -or $argument -clike '--header*' -or $argument -clike '--hostname*' -or $argument -clike '--input*') {
        Stop-AgentGh 'This API option is not allowed for public reads.'
      }
    }
    if ($expectMethod) { Stop-AgentGh 'The API method needs a value.' }
    $forward.Add('--method')
    $forward.Add('GET')
  }
  elseif ($script:AgentGhReadCommands -cnotcontains "$first $second") {
    Stop-AgentGh 'Agents may only read public GitHub data. The controller owns GitHub writes.'
  }

  foreach ($argument in $forward) {
    if ($argument -ceq '--web' -or $argument -ceq '-w' -or $argument -clike '--hostname*' -or $argument -clike '--host*') {
      Stop-AgentGh 'Use the GitHub API without opening a browser or changing hosts.'
    }
  }
  return , $forward.ToArray()
}

function Test-AgentGhReparsePoint([System.IO.FileSystemInfo]$Item) {
  return [bool]($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
}

# Returns $null for a safe token file, or the reason it is unsafe. On Windows
# the owner and every allow rule must be the current user, SYSTEM, or the
# local Administrators group. Elsewhere it matches bash: mode 600, owned by the
# current user.
function Get-AgentGhTokenAccessProblem([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if ($IsWindows) {
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $trusted = @($user, $script:AgentGhSystemSid, $script:AgentGhAdministratorsSid)
    $acl = [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.FileInfo]::new($Path))
    $sid = [System.Security.Principal.SecurityIdentifier]
    if ($acl.GetOwner($sid).Value -notin $trusted) { return 'The public GitHub token is owned by another account.' }
    foreach ($rule in $acl.GetAccessRules($true, $true, $sid)) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
      if ($rule.IdentityReference.Value -notin $trusted) {
        return 'The public GitHub token is readable by other accounts. Run agent-gh --setup-token --replace to rewrite it with an owner-only ACL.'
      }
    }
    return $null
  }
  $mode = [System.IO.File]::GetUnixFileMode($Path)
  $ownerOnly = [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
  $uid = (& id -u).Trim()
  if ($mode -ne $ownerOnly -or "$($item.UnixStat.UserId)" -ne $uid) {
    return 'The public GitHub token needs owner-only access. Run chmod 600 on its file.'
  }
  return $null
}

function Test-AgentGhTokenFormat([string]$Token) {
  return $Token -cmatch '^github_pat_[A-Za-z0-9_]+$'
}

# Reads the token without printing it. A missing, linked, shared, or malformed
# file stops the command; nothing falls back to another credential.
function Read-AgentGhToken([string]$Path = (Get-AgentGhTokenPath)) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item -or $item.PSIsContainer -or (Test-AgentGhReparsePoint $item)) {
    Stop-AgentGh "The public GitHub token is missing: $Path. Run agent-gh --setup-token to create it."
  }
  $problem = Get-AgentGhTokenAccessProblem $Path
  if ($problem) { Stop-AgentGh $problem }
  $token = [System.IO.File]::ReadAllText($Path).TrimEnd("`r", "`n")
  if (-not (Test-AgentGhTokenFormat $token)) {
    Stop-AgentGh 'Use a fine-grained token with Public repositories access and no account permissions.'
  }
  return $token
}

# Trusted install locations only, never PATH or the working directory, so a
# repository gh binary cannot capture the token. Windows accepts gh.exe only:
# a .cmd or .ps1 at one of these paths would run through another interpreter.
function Get-AgentGhCandidates([string]$UserHome = (Get-AgentGhHome)) {
  if ($IsWindows) {
    $candidates = @(
      [System.IO.Path]::Combine($UserHome, '.local', 'share', 'wolfstar-agent-kit', 'tools', 'bin', 'gh.exe'),
      [System.IO.Path]::Combine($UserHome, '.local', 'bin', 'gh.exe')
    )
    foreach ($folder in 'ProgramFiles', 'ProgramFilesX86') {
      $root = [Environment]::GetFolderPath($folder)
      if ($root) { $candidates += [System.IO.Path]::Combine($root, 'GitHub CLI', 'gh.exe') }
    }
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    if ($local) { $candidates += [System.IO.Path]::Combine($local, 'Programs', 'GitHub CLI', 'gh.exe') }
    $candidates += [System.IO.Path]::Combine($UserHome, 'scoop', 'apps', 'gh', 'current', 'bin', 'gh.exe')
    return , ($candidates | Select-Object -Unique)
  }
  return , @(
    '/run/agent/host-tools/gh',
    [System.IO.Path]::Combine($UserHome, '.local', 'share', 'wolfstar-agent-kit', 'tools', 'bin', 'gh'),
    [System.IO.Path]::Combine($UserHome, '.local', 'bin', 'gh'),
    '/usr/local/bin/gh', '/usr/bin/gh', '/bin/gh'
  )
}

function Resolve-AgentGhLink([string]$Path) {
  $target = [System.IO.File]::ResolveLinkTarget($Path, $true)
  if ($null -eq $target) { return [System.IO.Path]::GetFullPath($Path) }
  return $target.FullName
}

# Returns the first trusted GitHub CLI, or $null.
function Resolve-AgentGh([string[]]$Candidates = (Get-AgentGhCandidates), [string]$UserHome = (Get-AgentGhHome)) {
  $self = Resolve-AgentGhLink $PSCommandPath
  # Both installation names carry the same wrapper. Skip its worker directory.
  $wrappers = @(
    [System.IO.Path]::Combine($UserHome, '.local', 'share', 'wolfstar-agent-kit', 'github-bin', 'gh'),
    [System.IO.Path]::Combine($UserHome, '.local', 'bin', 'agent-gh'),
    [System.IO.Path]::Combine($UserHome, '.local', 'bin', 'agent-gh.ps1')
  )
  $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  foreach ($candidate in $Candidates) {
    if (-not [System.IO.File]::Exists($candidate)) { continue }
    $resolved = Resolve-AgentGhLink $candidate
    if (-not [System.IO.File]::Exists($resolved)) { continue }
    if ([string]::Equals($resolved, $self, $comparison)) { continue }
    if (@($wrappers | Where-Object { [string]::Equals($resolved, $_, $comparison) }).Count -gt 0) { continue }
    if ($IsWindows) {
      if (-not $resolved.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { continue }
    }
    elseif (-not ([System.IO.File]::GetUnixFileMode($resolved) -band [System.IO.UnixFileMode]::UserExecute)) {
      continue
    }
    return $resolved
  }
  return $null
}

# Runs gh with the agent credential in this process only. The caller's session
# keeps its own variables: every value set here is restored afterwards, and
# nothing reaches the user or machine environment.
function Invoke-AgentGhProcess([string]$Executable, [string[]]$Arguments, [string]$Token, [string]$ConfigDir) {
  $assigned = [ordered]@{
    GH_TOKEN           = $Token
    GH_HOST            = 'github.com'
    GH_PROMPT_DISABLED = '1'
    GH_CONFIG_DIR      = $ConfigDir
  }
  $names = @($assigned.Keys) + $script:AgentGhClearedVariables
  $saved = @{}
  foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
  # PowerShell passes $null to a .NET string parameter as an empty string, which
  # would leave a variable set to "". Remove-Item deletes it.
  $restore = {
    param([string]$Name, $Value)
    if ($null -eq $Value) { Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue }
    else { Set-Item -LiteralPath "Env:$Name" -Value $Value }
  }
  try {
    foreach ($name in $assigned.Keys) { & $restore $name $assigned[$name] }
    foreach ($name in $script:AgentGhClearedVariables) { & $restore $name $null }
    # Pass each argument to gh exactly as given, empty strings and quotes included.
    $PSNativeCommandArgumentPassing = 'Standard'
    # gh output stays on the pipeline, so `agent-gh ... | ConvertFrom-Json` works.
    & $Executable @Arguments
    $script:AgentGhExitCode = $LASTEXITCODE
  }
  finally {
    foreach ($name in $names) { & $restore $name $saved[$name] }
  }
}

# Writes a token file the read path accepts: owner-only ACL on Windows, mode
# 600 elsewhere. The token goes to a new file first and replaces the old one in
# one move, so a reader never sees a partial or unprotected token.
function Write-AgentGhToken([string]$Token, [string]$Path = (Get-AgentGhTokenPath), [switch]$Replace) {
  if (-not (Test-AgentGhTokenFormat $Token)) {
    Stop-AgentGh 'Use a fine-grained token that begins with github_pat_, with Public repositories access and no account permissions.'
  }
  $existing = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -ne $existing) {
    if ($existing.PSIsContainer -or (Test-AgentGhReparsePoint $existing)) { Stop-AgentGh "The token path is not a plain file: $Path" }
    if (-not $Replace) { Stop-AgentGh "The public GitHub token already exists: $Path. Run agent-gh --setup-token --replace to rotate it." }
  }
  $directory = [System.IO.Path]::GetDirectoryName($Path)
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $staged = [System.IO.Path]::Combine($directory, ".github-public-token.$([guid]::NewGuid().ToString('N'))")
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Token)
  try {
    if ($IsWindows) {
      $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
      $security = [System.Security.AccessControl.FileSecurity]::new()
      $security.SetAccessRuleProtection($true, $false)
      $security.SetOwner($user)
      foreach ($sid in $user, [System.Security.Principal.SecurityIdentifier]::new($script:AgentGhSystemSid), [System.Security.Principal.SecurityIdentifier]::new($script:AgentGhAdministratorsSid)) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
      }
      # The ACL applies when the file is created, before any byte is written.
      $stream = [System.IO.FileSystemAclExtensions]::Create(
        [System.IO.FileInfo]::new($staged), [System.IO.FileMode]::CreateNew,
        [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None,
        4096, [System.IO.FileOptions]::None, $security)
    }
    else {
      $options = [System.IO.FileStreamOptions]::new()
      $options.Mode = [System.IO.FileMode]::CreateNew
      $options.Access = [System.IO.FileAccess]::Write
      $options.UnixCreateMode = [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite
      $stream = [System.IO.FileStream]::new($staged, $options)
    }
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    [System.IO.File]::Move($staged, $Path, $true)
  }
  finally {
    [System.Array]::Clear($bytes, 0, $bytes.Length)
    if ([System.IO.File]::Exists($staged)) { [System.IO.File]::Delete($staged) }
  }
  $problem = Get-AgentGhTokenAccessProblem $Path
  if ($problem) { Stop-AgentGh $problem }
}

# The interactive setup. The prompt hides the token, and the token is never
# printed, logged, or placed in an environment variable.
function Install-AgentGhToken([switch]$Replace) {
  if ([Console]::IsInputRedirected) { Stop-AgentGh 'Run agent-gh --setup-token in an interactive PowerShell window.' }
  $path = Get-AgentGhTokenPath
  if ((Test-Path -LiteralPath $path) -and -not $Replace) {
    Stop-AgentGh "The public GitHub token already exists: $path. Run agent-gh --setup-token --replace to rotate it."
  }
  [Console]::Error.WriteLine("Create a fine-grained token on $(Get-AgentGhLogin) with Public repositories access and no account permissions.")
  $secure = Read-Host -Prompt 'Paste the token' -AsSecureString
  $token = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  Write-AgentGhToken -Token $token -Path $path -Replace:$Replace
  [Console]::Error.WriteLine("Saved the public GitHub token: $path")
  [Console]::Error.WriteLine('Check the account with: agent-gh api user --jq .login')
}

# Runs one agent-gh command and leaves its exit status in $script:AgentGhExitCode.
# The function returns nothing itself, so gh output is the only pipeline output.
function Invoke-AgentGh([string[]]$Arguments) {
  $script:AgentGhExitCode = 1
  try {
    if ($Arguments.Count -gt 0 -and $Arguments[0] -ceq '--help') {
      [Console]::Out.WriteLine('Usage: agent-gh <GitHub CLI read command>')
      [Console]::Out.WriteLine("Public reads use $(Get-AgentGhLogin). The controller owns writes.")
      [Console]::Out.WriteLine('Run agent-gh --setup-token once to save the fine-grained token.')
      $script:AgentGhExitCode = 0
      return
    }
    if ($Arguments.Count -gt 0 -and $Arguments[0] -ceq '--setup-token') {
      $rest = @($Arguments | Select-Object -Skip 1)
      if ($rest.Count -gt 1 -or ($rest.Count -eq 1 -and $rest[0] -cne '--replace')) { Stop-AgentGh 'Usage: agent-gh --setup-token [--replace]' }
      Install-AgentGhToken -Replace:($rest.Count -eq 1)
      $script:AgentGhExitCode = 0
      return
    }
    $forward = Get-AgentGhArguments $Arguments
    $token = Read-AgentGhToken
    $gh = Resolve-AgentGh
    if ($null -eq $gh) { Stop-AgentGh 'The GitHub CLI is missing. Install it from https://cli.github.com.' }
    Invoke-AgentGhProcess -Executable $gh -Arguments $forward -Token $token -ConfigDir (Get-AgentGhConfigDir)
  }
  catch [AgentGhRefusal] {
    [Console]::Error.WriteLine($_.Exception.Message)
    $script:AgentGhExitCode = 1
  }
}

# Dot-sourcing loads the functions for tests without running a command.
if ($MyInvocation.InvocationName -ne '.') {
  Invoke-AgentGh ([string[]]@($args | ForEach-Object { "$_" }))
  exit $script:AgentGhExitCode
}
