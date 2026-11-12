#Requires -Version 7.0
<#
.SYNOPSIS
Installs agent-gh from nothing on Windows, natively in PowerShell 7.

.DESCRIPTION
Checks the prerequisites, clones this repository unless it already runs from a
checkout, installs the root package, runs `pnpm sync:context`, saves the public
GitHub token after GitHub confirms its login, and checks the result with
agent-gh itself.

Windows needs no WSL for this: `pnpm sync:context` already installs the native
PowerShell build of agent-gh there (scripts/sync-agent-context.ps1).

Running it again changes nothing that is already right. It never replaces a
working token without confirmation, and it never prints the token, passes it
as an argument, or leaves it in the environment of a child process.

.EXAMPLE
pwsh -NoProfile -File .\scripts\install.ps1

.EXAMPLE
pwsh -NoProfile -File .\scripts\install.ps1 -DryRun
#>
# The switches are read by the functions below, through script scope.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', '', Justification = 'Read in script scope by the functions below.')]
# -DryRun is this script's what-if, so its functions do not take -WhatIf.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = '-DryRun covers every change.')]
[CmdletBinding()]
param(
  # Checkout to use or clone into. Default: the checkout this script runs
  # from, else ~\pkg\wolfstar-agent-kit.
  [string]$Directory,
  # Never clone. Fail unless a checkout already exists.
  [switch]$SkipClone,
  # Replace a working saved token without asking.
  [switch]$ReplaceToken,
  # Add ~\.local\bin to the user PATH without asking.
  [switch]$AddToPath,
  # Check prerequisites and print each change instead of making it.
  [switch]$DryRun,
  [switch]$Help
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'
# Exit codes are checked by hand, so a failing probe such as git rev-parse
# outside a repository stays a probe.
$PSNativeCommandUseErrorActionPreference = $false

# The Node floor: engines.node in packages/wolfstar-github-agent/package.json,
# which CI also runs. --experimental-strip-types itself needs 22.6.
# scripts/install.test.ts keeps this equal to the engines field.
$MinNode = [version]'24.0.0'
$RepoUrl = if ($env:WOLFSTAR_AGENT_KIT_REPO) { $env:WOLFSTAR_AGENT_KIT_REPO } else { 'https://github.com/wolfstar-project/wolfstar-agent-kit.git' }
# Only the token check reads this. agent-gh itself always talks to github.com.
$GitHubApi = if ($env:WOLFSTAR_AGENT_GITHUB_API) { $env:WOLFSTAR_AGENT_GITHUB_API } else { 'https://api.github.com' }
$ExpectedLogin = if ($env:WOLFSTAR_AGENT_GITHUB_LOGIN) { $env:WOLFSTAR_AGENT_GITHUB_LOGIN } else { 'wolfstarbot' }
# PowerShell on Windows fills $HOME from the user profile, as agent-gh does.
$UserHome = if ($IsWindows -and $env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$BinDir = [System.IO.Path]::Combine($UserHome, '.local', 'bin')
$AgentGh = if ($IsWindows) { [System.IO.Path]::Combine($BinDir, 'agent-gh.ps1') } else { [System.IO.Path]::Combine($BinDir, 'agent-gh') }

# Take the token out of the environment before anything starts, so neither
# git, pnpm, nor the sync scripts inherit it.
$script:SuppliedToken = $env:WOLFSTAR_AGENT_GITHUB_TOKEN
Remove-Item -LiteralPath Env:WOLFSTAR_AGENT_GITHUB_TOKEN -ErrorAction SilentlyContinue

class InstallFailure : System.Exception {
  InstallFailure([string]$Message) : base($Message) {}
}

function Stop-Install([string]$Message) { throw [InstallFailure]::new($Message) }
# agent-gh's own refusals carry a message meant for the user, like ours. The
# class comes from the dot-sourced wrapper, so match it by name.
function Test-Expected([System.Exception]$Exception) {
  return $Exception -is [InstallFailure] -or $Exception.GetType().Name -ceq 'AgentGhRefusal'
}
function Write-Line([string]$Message = '') { [Console]::Out.WriteLine($Message) }
function Write-Caution([string]$Message) { [Console]::Error.WriteLine("warning: $Message") }

function Show-Usage {
  Write-Line @"
Usage: pwsh -NoProfile -File scripts\install.ps1 [options]

Install agent-gh for public GitHub reads as $ExpectedLogin.

Options:
  -Directory PATH   Checkout to use or clone into.
                    Default: the checkout this script runs from, else ~\pkg\wolfstar-agent-kit.
  -SkipClone        Never clone. Fail unless a checkout already exists.
  -ReplaceToken     Replace a working saved token without asking.
  -AddToPath        Add ~\.local\bin to your user PATH without asking.
  -DryRun           Check prerequisites and print each change instead of making it.
  -Help             Show this help.

Environment:
  WOLFSTAR_AGENT_GITHUB_TOKEN   The fine-grained token. Without it, the script asks for it, hidden.
  WOLFSTAR_AGENT_GITHUB_LOGIN   The account the token must belong to. Default: wolfstarbot.
  WOLFSTAR_AGENT_KIT_DIR        Same as -Directory.
  WOLFSTAR_AGENT_KIT_REPO       Repository to clone. Default: $RepoUrl.
  WOLFSTAR_AGENT_GITHUB_API     API the token check calls, for tests. Default: https://api.github.com.
"@
}

function Format-Command([string]$Command, [string[]]$Arguments) {
  $quoted = foreach ($argument in @($Command) + $Arguments) {
    if ($argument -match '^[\w./:\\@=+-]+$') { $argument } else { "'$($argument.Replace("'", "''"))'" }
  }
  return $quoted -join ' '
}

# Runs a native command and stops on a non-zero exit. A dry run prints it.
function Invoke-Step([string]$Command, [string[]]$Arguments = @()) {
  if ($DryRun) {
    Write-Line "[dry-run] $(Format-Command $Command $Arguments)"
    return
  }
  # Out-Host keeps the command's output off this function's return value.
  & $Command @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { Stop-Install "$(Format-Command $Command $Arguments) failed with exit code $LASTEXITCODE." }
}

function Test-Interactive {
  return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
}

# Asks a yes or no question. No terminal means no.
function Confirm-Choice([string]$Question) {
  if (-not (Test-Interactive)) { return $false }
  $answer = Read-Host -Prompt "$Question [y/N]"
  return $answer -match '^(?i)y(es)?$'
}

function Get-PackageField([string]$Path, [string]$Name) {
  $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $property = $json.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return [string]$property.Value
}

function Test-Checkout([string]$Path) {
  if (-not $Path) { return $false }
  $manifest = [System.IO.Path]::Combine($Path, 'package.json')
  if (-not [System.IO.File]::Exists($manifest)) { return $false }
  if (-not [System.IO.File]::Exists([System.IO.Path]::Combine($Path, 'scripts', 'agent-context-platform.ts'))) { return $false }
  & git -C $Path rev-parse --is-inside-work-tree *> $null
  if ($LASTEXITCODE -ne 0) { return $false }
  return (Get-PackageField $manifest 'name') -ceq 'wolfstar-agent-kit'
}

function Test-PathEntry([string]$PathValue, [string]$Entry) {
  if (-not $PathValue) { return $false }
  $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  $wanted = $Entry.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  foreach ($item in $PathValue.Split([System.IO.Path]::PathSeparator)) {
    if ([string]::Equals($item.TrimEnd([System.IO.Path]::DirectorySeparatorChar), $wanted, $comparison)) { return $true }
  }
  return $false
}

function Test-Prerequisite {
  $missing = [System.Collections.Generic.List[string]]::new()
  if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
    $missing.Add('git: winget install --id Git.Git')
  }
  $nodeVersion = $null
  if (-not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
    $missing.Add("Node.js $MinNode or later: winget install --id OpenJS.NodeJS.LTS")
  }
  else {
    $nodeVersion = [version]((& node -p 'process.versions.node').Trim())
    if ($nodeVersion -lt $MinNode) {
      $missing.Add("Node.js $MinNode or later, found ${nodeVersion}: winget install --id OpenJS.NodeJS.LTS")
    }
    else {
      & node --experimental-strip-types -e '' *> $null
      if ($LASTEXITCODE -ne 0) { $missing.Add("Node.js that accepts --experimental-strip-types, found $nodeVersion") }
    }
  }
  # Node 25 stopped bundling Corepack.
  if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
    $missing.Add('corepack: npm install --global corepack')
  }
  if ($missing.Count -gt 0) {
    Stop-Install "missing prerequisites:`n$(($missing | ForEach-Object { "  - $_" }) -join "`n")"
  }
  Write-Line "Prerequisites: git, Node.js $nodeVersion, corepack."
}

function Resolve-Checkout {
  $target = if ($Directory) { $Directory } elseif ($env:WOLFSTAR_AGENT_KIT_DIR) { $env:WOLFSTAR_AGENT_KIT_DIR } else { $null }
  if ($target) {
    $target = [System.IO.Path]::GetFullPath($target, (Get-Location).ProviderPath)
    if (Test-Checkout $target) { return $target }
    if ($SkipClone) { Stop-Install "No wolfstar-agent-kit checkout at $target. Drop -SkipClone to clone it." }
    return Copy-Repository $target
  }
  $scriptRoot = if ($PSScriptRoot) { [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..')) } else { $null }
  if (Test-Checkout $scriptRoot) { return $scriptRoot }
  $top = (& git rev-parse --show-toplevel 2> $null)
  if ($LASTEXITCODE -eq 0 -and $top -and (Test-Checkout ([System.IO.Path]::GetFullPath($top.Trim())))) {
    return [System.IO.Path]::GetFullPath($top.Trim())
  }
  if ($SkipClone) { Stop-Install 'Not inside a wolfstar-agent-kit checkout. Pass -Directory PATH, or drop -SkipClone to clone it.' }
  return Copy-Repository ([System.IO.Path]::Combine($UserHome, 'pkg', 'wolfstar-agent-kit'))
}

function Copy-Repository([string]$Path) {
  if ([System.IO.Directory]::Exists($Path) -and @([System.IO.Directory]::EnumerateFileSystemEntries($Path)).Count -gt 0) {
    Stop-Install "$Path exists and is not a wolfstar-agent-kit checkout. Choose another -Directory."
  }
  if ([System.IO.File]::Exists($Path)) { Stop-Install "$Path is a file. Choose another -Directory." }
  Write-Line "Cloning $RepoUrl into $Path."
  if (-not $DryRun) { [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null }
  Invoke-Step 'git' @('clone', '--', $RepoUrl, $Path)
  return $Path
}

# agent-gh runs only a gh.exe at a trusted path, never one from PATH.
function Test-GitHubCli([string]$Repository) {
  if (-not (Get-Command Resolve-AgentGh -ErrorAction SilentlyContinue)) {
    Write-Line 'Would check for a trusted GitHub CLI after the clone.'
    return
  }
  $gh = Resolve-AgentGh -Candidates (Get-AgentGhCandidates $UserHome) -UserHome $UserHome
  if ($null -eq $gh) {
    $hint = if ($IsWindows) { 'winget install --id GitHub.cli' } else { 'sudo apt install gh' }
    Stop-Install "The GitHub CLI is missing from the paths agent-gh trusts (docs/agent-gh.md). Install it with: $hint"
  }
  Write-Line "GitHub CLI: $gh"
}

function Install-Workspace([string]$Repository) {
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  $manifest = [System.IO.Path]::Combine($Repository, 'package.json')
  if (-not [System.IO.File]::Exists($manifest)) {
    Write-Line 'Would enable pnpm at the packageManager version from the cloned package.json.'
    Invoke-Step 'corepack' @('enable', 'pnpm')
    Invoke-Step 'corepack' @('install', '--global', 'pnpm@<packageManager version>')
    Invoke-Step 'corepack' @('pnpm', 'install', '--frozen-lockfile', '--filter', 'wolfstar-agent-kit')
    Invoke-Step 'corepack' @('pnpm', 'sync:context')
    return
  }
  $spec = Get-PackageField $manifest 'packageManager'
  if (-not $spec -or -not $spec.StartsWith('pnpm@')) { Stop-Install "package.json names no pnpm in packageManager: $spec" }
  $version = $spec.Substring(5).Split('+')[0]
  $current = $null
  # Ask outside the checkout: inside it, a Corepack shim always answers with
  # the packageManager version. A shim also downloads pnpm to answer, so a dry
  # run never asks.
  if (-not $DryRun -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Push-Location -LiteralPath ([System.IO.Path]::GetTempPath())
    try { $current = (& pnpm --version 2> $null | Select-Object -First 1) }
    finally { Pop-Location }
  }
  if ($current -and $current.Trim() -eq $version) {
    Write-Line "pnpm $version is active."
  }
  else {
    Write-Line "Activating pnpm $version through Corepack."
    $enabled = $false
    if ($DryRun) {
      Invoke-Step 'corepack' @('enable', 'pnpm')
      Write-Line "If that needs administrator rights, it falls back to:"
    }
    else {
      # Node installed for all users keeps its directory admin only.
      & corepack enable pnpm *> $null
      $enabled = $LASTEXITCODE -eq 0
    }
    if (-not $enabled) {
      if (-not $DryRun) { [System.IO.Directory]::CreateDirectory($BinDir) | Out-Null }
      Invoke-Step 'corepack' @('enable', '--install-directory', $BinDir, 'pnpm')
    }
    # Makes this version the default outside any project too.
    Invoke-Step 'corepack' @('install', '--global', "pnpm@$version")
  }
  # Corepack runs the packageManager version whatever pnpm is first on PATH.
  # agent-gh needs the root package only, as the Windows CI job shows.
  Invoke-Step 'corepack' @('pnpm', 'install', '--frozen-lockfile', '--filter', 'wolfstar-agent-kit')
  $syncArguments = @('pnpm', 'sync:context')
  if ($IsWindows -and -not (Test-PathEntry ([Environment]::GetEnvironmentVariable('Path', 'User')) $BinDir) -and -not (Test-PathEntry $env:PATH $BinDir)) {
    if ($AddToPath -or (Confirm-Choice "Add $BinDir to your user PATH, so agent-gh runs from any window?")) {
      $syncArguments += @('--', '-AddToPath')
    }
  }
  Invoke-Step 'corepack' $syncArguments
}

# Asks GitHub who a token belongs to. Status is ok, rejected, or unreachable.
# The token stays in this process: it goes in a request header, never on a
# command line.
function Get-GitHubLogin([string]$Token) {
  $headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  $status = 0
  try {
    $user = Invoke-RestMethod -Uri "$GitHubApi/user" -Headers $headers -SkipHttpErrorCheck -StatusCodeVariable status -TimeoutSec 30
  }
  catch {
    return [pscustomobject]@{ Status = 'unreachable'; Login = $null }
  }
  if ($status -eq 401) { return [pscustomobject]@{ Status = 'rejected'; Login = $null } }
  if ($status -ne 200 -or $null -eq $user -or -not $user.PSObject.Properties['login']) {
    Write-Caution "GitHub answered HTTP $status."
    return [pscustomobject]@{ Status = 'unreachable'; Login = $null }
  }
  return [pscustomobject]@{ Status = 'ok'; Login = [string]$user.login }
}

function Read-NewToken {
  if ($script:SuppliedToken) {
    $token = $script:SuppliedToken.Trim()
  }
  else {
    if (-not (Test-Interactive)) { Stop-Install 'No terminal to ask for the token. Set WOLFSTAR_AGENT_GITHUB_TOKEN instead.' }
    Write-Line "Create a fine-grained token on $ExpectedLogin with Public repositories access and no account permissions."
    $secure = Read-Host -Prompt 'Paste the token (hidden)' -AsSecureString
    $token = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
    $secure.Dispose()
  }
  if (-not (Test-AgentGhTokenFormat $token)) { Stop-Install 'Use a fine-grained token that begins with github_pat_. Nothing was saved.' }
  return $token
}

# Leaves the token readable by the current user only: no inherited rules, no
# SYSTEM, no Administrators. agent-gh accepts that subset of its own ACL.
function Set-OwnerOnlyAccess([string]$Path) {
  if (-not $IsWindows) {
    [System.IO.File]::SetUnixFileMode($Path, [System.IO.UnixFileMode]::UserRead -bor [System.IO.UnixFileMode]::UserWrite)
    return
  }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $Path /inheritance:r /grant:r "*${sid}:(F)" /remove:g '*S-1-5-18' '*S-1-5-32-544' | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Install "icacls could not restrict $Path." }
  $problem = Get-AgentGhTokenAccessProblem $Path
  if ($problem) { Stop-Install $problem }
}

function Install-Token {
  $path = Get-AgentGhTokenPath $UserHome
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if ($null -ne $item -and ($item.PSIsContainer -or (Test-AgentGhReparsePoint $item))) {
    Stop-Install "The token path is not a plain file: $path. Remove it and run again."
  }
  if ($DryRun) {
    if ($null -ne $item) { Write-Line "Would check the saved token at $path and keep it if it belongs to $ExpectedLogin." }
    elseif ($script:SuppliedToken) { Write-Line "Would check WOLFSTAR_AGENT_GITHUB_TOKEN with GitHub and save it to $path." }
    else { Write-Line "Would ask for the token, hidden, check it with GitHub, and save it to $path." }
    $icacls = if ($IsWindows) { 'icacls' } else { 'chmod 600' }
    Write-Line "Would restrict it with $icacls to the current user only."
    return $path
  }

  if ($GitHubApi -cne 'https://api.github.com') { Write-Caution "Checking tokens against $GitHubApi, not GitHub." }
  $savedOk = $false
  $saved = $null
  if ($null -ne $item) {
    try { $saved = Read-AgentGhToken $path }
    catch {
      if ($_.Exception.GetType().Name -cne 'AgentGhRefusal') { throw }
      Write-Caution "$($_.Exception.Message) It will be replaced."
    }
    if ($saved) {
      $check = Get-GitHubLogin $saved
      switch ($check.Status) {
        'ok' {
          if ($check.Login -ceq $ExpectedLogin) { $savedOk = $true }
          else { Write-Caution "The saved token belongs to $($check.Login), not $ExpectedLogin. It will be replaced." }
        }
        'rejected' { Write-Caution 'GitHub rejected the saved token. It expired or was revoked, so it will be replaced.' }
        default { Stop-Install 'Could not reach GitHub to check the saved token. Nothing changed. Run again when GitHub is reachable.' }
      }
    }
  }
  if ($savedOk) {
    if ($script:SuppliedToken -and $script:SuppliedToken.Trim() -ceq $saved) {
      Write-Line "The saved token already belongs to $ExpectedLogin."
      Set-OwnerOnlyAccess $path
      return $path
    }
    if ($ReplaceToken) {
      Write-Line "Replacing the working token for $ExpectedLogin, as -ReplaceToken asks."
    }
    elseif (-not (Confirm-Choice "A working token for $ExpectedLogin is already saved. Replace it?")) {
      if ($script:SuppliedToken) { Write-Caution 'Kept the saved token and ignored WOLFSTAR_AGENT_GITHUB_TOKEN. Pass -ReplaceToken to rotate it.' }
      Write-Line "Keeping the saved token for $ExpectedLogin."
      Set-OwnerOnlyAccess $path
      return $path
    }
  }

  $token = Read-NewToken
  $check = Get-GitHubLogin $token
  switch ($check.Status) {
    'ok' {}
    'rejected' { Stop-Install 'GitHub rejected the token. Nothing was saved.' }
    default { Stop-Install 'Could not reach GitHub to check the token. Nothing was saved.' }
  }
  if ($check.Login -cne $ExpectedLogin) { Stop-Install "The token belongs to $($check.Login), not $ExpectedLogin. Nothing was saved." }
  # agent-gh's own writer creates the file with an owner-only ACL before any
  # byte lands, then moves it into place. icacls narrows it to this user.
  Write-AgentGhToken -Token $token -Path $path -Replace
  $token = $null
  Set-OwnerOnlyAccess $path
  Write-Line "Saved the token for ${ExpectedLogin}: $path"
  return $path
}

# Runs the installed agent-gh in a fresh pwsh, as a user would.
function Invoke-AgentGh([string[]]$Arguments) {
  $output = & ([Environment]::ProcessPath) -NoProfile -File $AgentGh @Arguments
  if ($LASTEXITCODE -ne 0) { Stop-Install "agent-gh $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
  return ($output -join "`n")
}

function Test-Installation([string]$Repository, [string]$TokenPath) {
  if ($DryRun) {
    Write-Line "[dry-run] $(Format-Command $AgentGh @('api', 'user', '--jq', '.login'))"
    Write-Line "[dry-run] $(Format-Command $AgentGh @('api', 'rate_limit'))"
    return
  }
  if (-not [System.IO.File]::Exists($AgentGh)) { Stop-Install "pnpm sync:context did not install $AgentGh." }
  $login = (Invoke-AgentGh @('api', 'user', '--jq', '.login')).Trim()
  if ($login -cne $ExpectedLogin) { Stop-Install "agent-gh reads as $login, not $ExpectedLogin." }
  $core = (Invoke-AgentGh @('api', 'rate_limit') | ConvertFrom-Json).resources.core
  $reset = [DateTimeOffset]::FromUnixTimeSeconds([long]$core.reset).LocalDateTime
  Write-Line
  Write-Line 'agent-gh is ready.'
  Write-Line "  Login:     $login"
  Write-Line "  Quota:     $($core.remaining) of $($core.limit), resets $($reset.ToString('yyyy-MM-dd HH:mm'))"
  Write-Line "  Binary:    $AgentGh"
  Write-Line "  Token:     $TokenPath"
  Write-Line "  Checkout:  $Repository"
}

function Show-PathHint {
  if (Test-PathEntry $env:PATH $BinDir) { return }
  Write-Line
  if ($IsWindows -and (Test-PathEntry ([Environment]::GetEnvironmentVariable('Path', 'User')) $BinDir)) {
    Write-Line 'Open a new PowerShell window to run agent-gh by name.'
  }
  elseif ($IsWindows) {
    Write-Line "$BinDir is not on PATH. Run again with -AddToPath, or run: pnpm sync:context -- -AddToPath"
  }
  else {
    Write-Line "$BinDir is not on PATH. Add it in your shell profile."
  }
}

# Dot-sourcing loads the functions for tests without installing anything.
if ($MyInvocation.InvocationName -eq '.') { return }

if ($Help) {
  Show-Usage
  exit 0
}

try {
  if ($DryRun) { Write-Line 'Dry run: nothing will change.' }
  if (-not $IsWindows) {
    if (-not $DryRun) { Stop-Install 'install.ps1 installs the native Windows build. On Linux and WSL, run scripts/install.sh.' }
    Write-Caution 'install.ps1 targets Windows. On Linux and WSL, run scripts/install.sh. Continuing the dry run.'
  }
  Test-Prerequisite
  $repository = Resolve-Checkout
  Write-Line "Checkout: $repository"
  $wrapper = [System.IO.Path]::Combine($repository, 'scripts', 'github-public.ps1')
  # Loads agent-gh's own functions without running a command, so the token
  # path, ACL check, and trusted gh list are the ones agent-gh uses.
  if ([System.IO.File]::Exists($wrapper)) { . $wrapper }
  Test-GitHubCli $repository
  Install-Workspace $repository
  if (-not (Get-Command Get-AgentGhTokenPath -ErrorAction SilentlyContinue)) {
    Write-Line 'Would ask for the token, hidden, check it with GitHub, and save it with an owner-only ACL.'
    $tokenPath = [System.IO.Path]::Combine($UserHome, '.config', 'wolfstar-agent-kit', 'github-public-token')
  }
  else {
    $tokenPath = Install-Token
  }
  Test-Installation $repository $tokenPath
  Show-PathHint
  if ($DryRun) { Write-Line 'Dry run complete. Nothing changed.' }
}
catch {
  if (-not (Test-Expected $_.Exception)) { throw }
  [Console]::Error.WriteLine("error: $($_.Exception.Message)")
  exit 1
}
finally {
  $script:SuppliedToken = $null
}
exit 0
