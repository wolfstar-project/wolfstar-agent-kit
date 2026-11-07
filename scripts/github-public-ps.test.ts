// The PowerShell agent-gh, driven through pwsh exactly as a Windows user runs
// it. The suite also runs on Linux, where pwsh exercises the same policy and
// environment handling; the ACL cases run on Windows only.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const windows = process.platform === 'win32'
const pwsh = process.env.WOLFSTAR_PWSH ?? 'pwsh'
const available =
  spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0
// CI must run these, so a missing pwsh there is a failure rather than a skip.
if (!available && process.env.CI) throw new Error(`PowerShell 7 is required in CI: ${pwsh}`)

const wrapper = resolve('scripts/github-public.ps1')
const bashWrapper = resolve('scripts/github-public.sh')
const installer = resolve('scripts/sync-agent-context.ps1')
const fixtureToken = 'github_pat_fixture'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

interface Recorded {
  args: string[]
  env: Record<string, string | null>
}

// A fake gh that records its arguments and the credential variables it saw.
// Windows only trusts gh.exe, so there it is a copy of node that preloads the
// recorder through NODE_OPTIONS.
const recorder = `const { basename } = require('node:path')
const args = process.env.FAKE_GH_PRELOAD ? [basename(process.argv[1]), ...process.argv.slice(2)] : process.argv.slice(2)
const names = ['GH_TOKEN', 'GH_HOST', 'GH_PROMPT_DISABLED', 'GH_CONFIG_DIR', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG']
const env = Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]))
require('node:fs').writeFileSync(process.env.RECORD, JSON.stringify({ args, env }))
process.exit(Number(process.env.RESULT ?? 0))
`

function installFakeGh(directory: string, root: string) {
  mkdirSync(directory, { recursive: true })
  const script = join(root, 'recorder.cjs')
  writeFileSync(script, recorder)
  if (windows) {
    copyFileSync(process.execPath, join(directory, 'gh.exe'))
    // NODE_OPTIONS reads a backslash as an escape, so pass the path with forward slashes.
    return { NODE_OPTIONS: `--require "${script.replaceAll('\\', '/')}"`, FAKE_GH_PRELOAD: '1' }
  }
  writeFileSync(join(directory, 'gh'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, {
    mode: 0o755,
  })
  return {}
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'public-gh-ps-'))
  roots.push(root)
  const config = join(root, '.config', 'wolfstar-agent-kit')
  mkdirSync(config, { recursive: true })
  const token = join(config, 'github-public-token')
  const recorded = join(root, 'request.json')
  const work = join(root, 'work')
  mkdirSync(work)
  const fakeEnv = installFakeGh(join(root, '.local', 'bin'), root)
  const env = (extra: Record<string, string>) => ({
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    GH_TOKEN: 'personal',
    GITHUB_TOKEN: 'personal',
    GH_ENTERPRISE_TOKEN: 'personal',
    GH_DEBUG: '1',
    GH_HOST: 'other.example',
    GH_CONFIG_DIR: join(root, 'personal'),
    RECORD: recorded,
    ...fakeEnv,
    ...extra,
  })
  // Runs a PowerShell snippet with the wrapper's functions loaded.
  const script = (body: string, extra: Record<string, string> = {}) => {
    const driver = join(root, `driver-${Math.random().toString(36).slice(2)}.ps1`)
    writeFileSync(driver, `$ErrorActionPreference = 'Stop'\n. ${quote(wrapper)}\n${body}\n`)
    return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', driver], {
      encoding: 'utf8',
      cwd: work,
      env: env(extra),
    })
  }
  const writeToken = (value = fixtureToken) => {
    const result = script(`Write-AgentGhToken -Token ${quote(value)} -Path ${quote(token)} -Replace`)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }
  return {
    root,
    token,
    work,
    env,
    script,
    writeToken,
    run: (args: string[], extra: Record<string, string> = {}): SpawnSyncReturns<string> =>
      spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', wrapper, ...args], {
        encoding: 'utf8',
        cwd: work,
        env: env(extra),
      }),
    request: (): Recorded | undefined =>
      existsSync(recorded) ? JSON.parse(readFileSync(recorded, 'utf8')) : undefined,
  }
}

function expectNoLeak(result: SpawnSyncReturns<string>) {
  expect(`${result.stdout}${result.stderr}`).not.toContain(fixtureToken)
  expect(`${result.stdout}${result.stderr}`).not.toContain('personal')
}

// One refusal table for both wrappers, so the two policies cannot drift apart.
const refused: string[][] = [
  ['pr', 'create'],
  ['pr', 'merge', '236', '-R', 'wolfstar-project/stars-components'],
  ['issue', 'create', '-R', 'wolfstar-project/stars-components'],
  ['issue', 'comment', '1'],
  ['repo', 'delete', 'owner/repo'],
  ['run', 'rerun', '1'],
  ['auth', 'token'],
  ['auth', 'status'],
  ['alias', 'set', 'x', 'pr merge'],
  ['extension', 'install', 'owner/gh-x'],
  ['PR', 'VIEW', '1'],
  ['pr view', '1'],
  [],
  ['api'],
  ['api', '-X', 'GET'],
  ['api', 'graphql', '-f', 'query=query { viewer { login } }'],
  ['api', '/graphql'],
  ['api', 'repos/owner/repo', '-X', 'DELETE'],
  ['api', 'repos/owner/repo', '-X', 'get'],
  ['api', 'repos/owner/repo', '-X'],
  ['api', 'repos/owner/repo', '-XPOST'],
  ['api', 'repos/owner/repo', '--method', 'POST'],
  ['api', 'repos/owner/repo', '--method=PATCH'],
  ['api', 'https://other.example/path'],
  ['api', '//other.example/path'],
  ['api', 'repos\\owner\\repo'],
  ['api', 'repos/owner/repo', '--hostname', 'other.example'],
  ['api', 'repos/owner/repo', '-H', 'Authorization: token personal'],
  ['api', 'repos/owner/repo', '--header=Authorization: token personal'],
  ['api', 'repos/owner/repo', '--input', 'body.json'],
  ['pr', 'view', '1', '--web'],
  ['repo', 'view', '-w'],
  ['issue', 'list', '--hostname=other.example'],
]

const allowed: string[][] = [
  ['repo', 'view', 'wolfstar-project/stars-components'],
  ['issue', 'list', '-R', 'wolfstar-project/stars-components'],
  ['pr', 'view', '236', '-R', 'wolfstar-project/stars-components'],
  ['api', 'repos/owner/repo', '-XGET'],
  ['api', 'repos/owner/repo', '--method=GET'],
  ['api', '/repos/owner/repo', '-X', 'GET', '--jq', '.name'],
]

// Each case starts pwsh at least once, which takes a second or more.
describe.skipIf(!available)('PowerShell agent-gh', { timeout: 60_000 }, () => {
  describe('read policy', () => {
    it('allows the same read commands as the bash wrapper', () => {
      const bash = readFileSync(bashWrapper, 'utf8')
      const block = bash.slice(bash.indexOf("'pr view'"), bash.indexOf(') ;;', bash.indexOf("'pr view'")))
      const bashCommands = [...block.matchAll(/'([a-z]+ [a-z]+)'/g)].map((match) => match[1])
      const f = fixture()
      const result = f.script('$script:AgentGhReadCommands | ConvertTo-Json -Compress')
      expect(JSON.parse(result.stdout)).toEqual(bashCommands)
    })

    it('refuses and allows exactly what the bash wrapper does', () => {
      const f = fixture()
      const cases = [...refused, ...allowed]
      const result = f.script(`
$cases = ConvertFrom-Json ${quote(JSON.stringify(cases))} -NoEnumerate
foreach ($case in $cases) {
  try { $null = Get-AgentGhArguments ([string[]]@($case)); 'allowed' }
  catch [AgentGhRefusal] { 'refused' }
}`)
      expect(result.stderr).toBe('')
      const powershell = result.stdout.trim().split(/\r?\n/)
      const bash = windows
        ? undefined
        : cases.map((args) => {
            const run = spawnSync('bash', [bashWrapper, ...args], {
              encoding: 'utf8',
              env: { ...process.env, HOME: f.root },
            })
            // Past the policy, bash stops on the token this home lacks.
            return run.stderr.includes('token is missing') ? 'allowed' : 'refused'
          })
      expect(powershell).toEqual(cases.map((_, index) => (index < refused.length ? 'refused' : 'allowed')))
      if (bash) expect(powershell).toEqual(bash)
    })

    it.each([
      ['issue', 'create', '-R', 'wolfstar-project/stars-components'],
      ['pr', 'merge', '236', '-R', 'wolfstar-project/stars-components'],
      ['api', 'graphql', '-f', 'query=query { viewer { login } }'],
      ['api', 'repos/owner/repo', '-X', 'DELETE'],
    ])('rejects %s %s before reading the token or starting gh', (...args) => {
      const f = fixture()
      f.writeToken()
      const result = f.run(args)
      expect(result.status).toBe(1)
      expect(result.stderr).not.toBe('')
      expect(f.request()).toBeUndefined()
      expectNoLeak(result)
    })
  })

  describe('allowed reads', () => {
    it('forwards every argument unchanged with the agent credential', () => {
      const f = fixture()
      f.writeToken()
      const args = ['pr', 'view', '236', '-R', 'wolfstar-project/stars-components', '--jq', '.title | "a b"', '', 'x y']
      const result = f.run(args)
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const request = f.request()
      expect(request?.args).toEqual(args)
      expect(request?.env).toEqual({
        GH_TOKEN: fixtureToken,
        GH_HOST: 'github.com',
        GH_PROMPT_DISABLED: '1',
        GH_CONFIG_DIR: join(f.root, '.config', 'wolfstar-agent-kit', 'gh-public'),
        GITHUB_TOKEN: null,
        GH_ENTERPRISE_TOKEN: null,
        GITHUB_ENTERPRISE_TOKEN: null,
        GH_DEBUG: null,
      })
      expectNoLeak(result)
    })

    it.each(allowed.slice(0, 3))('runs the acceptance read %s %s', (...args) => {
      const f = fixture()
      f.writeToken()
      expect(f.run(args).status).toBe(0)
      expect(f.request()?.args).toEqual(args)
    })

    it('keeps API field requests on GET', () => {
      const f = fixture()
      f.writeToken()
      expect(f.run(['api', 'repos/owner/repo/issues', '-f', 'state=open']).status).toBe(0)
      expect(f.request()?.args).toEqual(['api', 'repos/owner/repo/issues', '-f', 'state=open', '--method', 'GET'])
    })

    it.each([1, 4, 8])('passes exit status %i through without switching credentials', (code) => {
      const f = fixture()
      f.writeToken()
      const result = f.run(['run', 'watch', '123', '--repo', 'owner/repo', '--exit-status'], { RESULT: String(code) })
      expect(result.status).toBe(code)
      expect(f.request()?.env.GH_TOKEN).toBe(fixtureToken)
    })

    it('restores the calling session environment after an in-session call', () => {
      const f = fixture()
      f.writeToken()
      const result = f.script(
        `
$before = @{}
$names = 'GH_TOKEN', 'GH_HOST', 'GH_PROMPT_DISABLED', 'GH_CONFIG_DIR', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG'
foreach ($name in $names) { $before[$name] = [Environment]::GetEnvironmentVariable($name) }
$output = & ${quote(wrapper)} repo view owner/repo
$code = $LASTEXITCODE
$after = @{}
foreach ($name in $names) { $after[$name] = [Environment]::GetEnvironmentVariable($name) }
@{ before = $before; after = $after; code = $code } | ConvertTo-Json -Compress`,
        { RESULT: '3' },
      )
      expect(result.stderr).toBe('')
      const { before, after, code } = JSON.parse(result.stdout)
      expect(code).toBe(3)
      expect(after).toEqual(before)
      expect(after.GH_PROMPT_DISABLED).toBeNull()
      expect(f.request()?.env.GH_TOKEN).toBe(fixtureToken)
    })

    it('prints usage without a token', () => {
      const f = fixture()
      const result = f.run(['--help'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Usage: agent-gh')
    })
  })

  describe('token file', () => {
    it('does not fall back when the token is missing', () => {
      const f = fixture()
      const result = f.run(['repo', 'view', 'owner/repo'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('agent-gh --setup-token')
      expect(f.request()).toBeUndefined()
      expect(existsSync(f.token)).toBe(false)
      expectNoLeak(result)
    })

    it.each(['ghp_classictoken', 'github_pat_ has space', '', 'GITHUB_PAT_upper'])(
      'refuses a token that is not fine-grained: %j',
      (value) => {
        const f = fixture()
        f.writeToken()
        // Overwrite the content but keep the file's protected access.
        const result0 = f.script(`[System.IO.File]::WriteAllText(${quote(f.token)}, ${quote(value)})`)
        expect(result0.status).toBe(0)
        const result = f.run(['repo', 'view', 'owner/repo'])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('fine-grained token')
        expect(f.request()).toBeUndefined()
        if (value) expect(result.stderr).not.toContain(value)
      },
    )

    it('accepts a token saved with a trailing newline', () => {
      const f = fixture()
      f.writeToken()
      expect(f.script(`[System.IO.File]::WriteAllText(${quote(f.token)}, "${fixtureToken}\`r\`n")`).status).toBe(0)
      expect(f.run(['repo', 'view', 'owner/repo']).status).toBe(0)
      expect(f.request()?.env.GH_TOKEN).toBe(fixtureToken)
    })

    it('refuses a directory in place of the token', () => {
      const f = fixture()
      mkdirSync(f.token)
      expect(f.run(['repo', 'view', 'owner/repo']).status).toBe(1)
      expect(f.request()).toBeUndefined()
    })

    it('never creates a token during a read', () => {
      const f = fixture()
      f.run(['api', 'user'])
      expect(existsSync(f.token)).toBe(false)
    })

    it('writes a new token only through setup, and refuses to replace it silently', () => {
      const f = fixture()
      f.writeToken()
      const again = f.script(`Write-AgentGhToken -Token 'github_pat_other' -Path ${quote(f.token)}`)
      expect(again.status).not.toBe(0)
      expect(again.stderr).toContain('--replace')
      expect(f.script(`[System.IO.File]::ReadAllText(${quote(f.token)})`).stdout.trim()).toBe(fixtureToken)
      expect(f.script(`Write-AgentGhToken -Token 'not-a-pat' -Path ${quote(f.token)} -Replace`).status).not.toBe(0)
    })

    it('refuses interactive setup when input is redirected', () => {
      const f = fixture()
      const result = spawnSync(pwsh, ['-NoProfile', '-File', wrapper, '--setup-token'], {
        encoding: 'utf8',
        input: `${fixtureToken}\n`,
        env: f.env({}),
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('interactive')
      expect(existsSync(f.token)).toBe(false)
    })

    it.skipIf(windows)('refuses a token readable by others, as bash does', () => {
      const f = fixture()
      f.writeToken()
      chmodSync(f.token, 0o644)
      const result = f.run(['repo', 'view', 'owner/repo'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('owner-only')
      expect(f.request()).toBeUndefined()
    })

    it.skipIf(windows)('accepts a token file the bash setup made with chmod 600', () => {
      const f = fixture()
      writeFileSync(f.token, `${fixtureToken}\n`, { mode: 0o600 })
      expect(f.run(['repo', 'view', 'owner/repo']).status).toBe(0)
    })

    it.skipIf(windows)('refuses a linked token file', () => {
      const f = fixture()
      const real = join(f.root, 'real-token')
      writeFileSync(real, fixtureToken, { mode: 0o600 })
      symlinkSync(real, f.token)
      expect(f.run(['repo', 'view', 'owner/repo']).status).toBe(1)
      expect(f.request()).toBeUndefined()
    })
  })

  describe.runIf(windows)('Windows ACLs and paths', () => {
    const aclReport = `
$sid = [System.Security.Principal.SecurityIdentifier]
$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.FileInfo]::new($path))
@{
  protected = $acl.AreAccessRulesProtected
  owner = $acl.GetOwner($sid).Value
  user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
} | ConvertTo-Json -Compress`

    it('writes the token with an owner-only ACL', () => {
      const f = fixture()
      f.writeToken()
      const result = f.script(`$path = ${quote(f.token)}\n${aclReport}`)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout)
      expect(report.protected).toBe(true)
      expect(report.owner).toBe(report.user)
      expect(report.rules).toEqual([report.user, 'S-1-5-18', 'S-1-5-32-544'].sort())
    })

    it.each([
      ['Everyone', 'S-1-1-0'],
      ['Users', 'S-1-5-32-545'],
      ['Authenticated Users', 'S-1-5-11'],
    ])('refuses a token %s can read', (_, sid) => {
      const f = fixture()
      f.writeToken()
      const grant = f.script(`
$info = [System.IO.FileInfo]::new(${quote(f.token)})
$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl($info)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('${sid}'), 'Read', 'Allow'))
[System.IO.FileSystemAclExtensions]::SetAccessControl($info, $acl)`)
      expect(grant.stderr).toBe('')
      const result = f.run(['repo', 'view', 'owner/repo'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('readable by other accounts')
      expect(f.request()).toBeUndefined()
    })

    it('refuses a token file created with inherited access the profile does not restrict', () => {
      const f = fixture()
      writeFileSync(f.token, fixtureToken)
      const widen = f.script(`
$info = [System.IO.FileInfo]::new(${quote(f.token)})
$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl($info)
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'Read', 'Allow'))
[System.IO.FileSystemAclExtensions]::SetAccessControl($info, $acl)`)
      expect(widen.status).toBe(0)
      expect(f.run(['repo', 'view', 'owner/repo']).status).toBe(1)
    })

    it('reads the token from the Windows user profile and trusts only gh.exe paths', () => {
      const f = fixture()
      const result = f.script(
        `@{ token = Get-AgentGhTokenPath; candidates = Get-AgentGhCandidates } | ConvertTo-Json -Compress`,
      )
      const { token, candidates } = JSON.parse(result.stdout)
      expect(token).toBe(join(f.root, '.config', 'wolfstar-agent-kit', 'github-public-token'))
      expect(candidates.length).toBeGreaterThan(2)
      for (const candidate of candidates) expect(candidate).toMatch(/\\gh\.exe$/)
      expect(candidates).toContain(join(f.root, '.local', 'bin', 'gh.exe'))
      expect(candidates.some((candidate: string) => /\\GitHub CLI\\gh\.exe$/.test(candidate))).toBe(true)
    })
  })

  describe('GitHub CLI resolution', () => {
    it('never runs a gh from PATH or the working directory', () => {
      const f = fixture()
      f.writeToken()
      const marker = join(f.root, 'captured')
      const evil = join(f.root, 'evil')
      mkdirSync(evil)
      for (const directory of [evil, f.work]) {
        if (windows) {
          writeFileSync(join(directory, 'gh.cmd'), `@echo %GH_TOKEN%> "${marker}"\r\n`)
          writeFileSync(join(directory, 'gh.ps1'), `$env:GH_TOKEN | Set-Content ${quote(marker)}\n`)
        } else {
          writeFileSync(join(directory, 'gh'), `#!/bin/sh\nprintf '%s' "$GH_TOKEN" > ${quote(marker)}\n`, {
            mode: 0o755,
          })
        }
      }
      const result = f.run(['repo', 'view', 'owner/repo'], {
        PATH: `${evil}${windows ? ';' : ':'}${f.work}${windows ? ';' : ':'}${process.env.PATH ?? ''}`,
      })
      expect(result.status).toBe(0)
      expect(existsSync(marker)).toBe(false)
      expect(f.request()?.env.GH_TOKEN).toBe(fixtureToken)
    })

    it('skips untrusted candidates and reports a missing CLI', () => {
      const f = fixture()
      const untrusted = join(f.root, windows ? 'gh.cmd' : 'gh')
      writeFileSync(untrusted, windows ? '@exit 0\r\n' : '#!/bin/sh\n', { mode: 0o644 })
      const result = f.script(`
$found = Resolve-AgentGh -Candidates @(${quote(untrusted)}, ${quote(wrapper)}, ${quote(join(f.root, 'absent'))})
if ($null -eq $found) { 'none' } else { $found }`)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim()).toBe('none')
    })

    it.skipIf(windows)('checks the same install locations as bash, in the same order', () => {
      const bash = readFileSync(bashWrapper, 'utf8')
      const line = bash.split('\n').find((text) => text.startsWith('for binary in '))!
      const bashCandidates = line
        .replace(/^for binary in /, '')
        .replace(/; do$/, '')
        .split(' ')
        .map((path) => path.replaceAll('"', ''))
      const f = fixture()
      const result = f.script('Get-AgentGhCandidates | ConvertTo-Json -Compress')
      expect(JSON.parse(result.stdout)).toEqual(bashCandidates.map((path) => path.replace('$HOME', f.root)))
    })
  })

  describe('installer', () => {
    function install(home: string, mode = 'local') {
      return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', installer, '-Mode', mode], {
        encoding: 'utf8',
        env: { ...process.env, WOLFSTAR_AGENT_CONTEXT_HOME: home, USERPROFILE: home, HOME: home },
      })
    }

    it('installs agent-gh idempotently and leaves the token alone', () => {
      const home = mkdtempSync(join(tmpdir(), 'public-gh-install-'))
      roots.push(home)
      const installed = join(home, '.local', 'bin', 'agent-gh.ps1')
      expect(install(home, 'check').status).toBe(1)

      const first = install(home)
      expect(first.stderr).toBe('')
      expect(first.status).toBe(0)
      expect(first.stdout).toContain('Installed agent-gh')
      expect(first.stdout).toContain('agent-gh --setup-token')
      expect(readFileSync(installed)).toEqual(readFileSync(wrapper))
      expect(existsSync(join(home, '.config', 'wolfstar-agent-kit', 'github-public-token'))).toBe(false)

      const token = join(home, '.config', 'wolfstar-agent-kit', 'github-public-token')
      mkdirSync(join(home, '.config', 'wolfstar-agent-kit'), { recursive: true })
      writeFileSync(token, 'github_pat_keep', { mode: 0o600 })
      const second = install(home)
      expect(second.status).toBe(0)
      expect(second.stdout).toContain('agent-gh is current')
      expect(readFileSync(token, 'utf8')).toBe('github_pat_keep')
      expect(install(home, 'check').status).toBe(0)

      writeFileSync(installed, '# stale\n')
      const drift = install(home, 'check')
      expect(drift.status).toBe(1)
      expect(drift.stdout).toContain('differs')
      expect(install(home).stdout).toContain('Installed agent-gh')
    })

    it('runs as a bare agent-gh command from PATH', () => {
      const f = fixture()
      f.writeToken()
      expect(install(f.root).status).toBe(0)
      const bin = join(f.root, '.local', 'bin')
      const result = spawnSync(
        pwsh,
        ['-NoProfile', '-NonInteractive', '-Command', 'agent-gh repo view owner/repo; exit $LASTEXITCODE'],
        {
          encoding: 'utf8',
          cwd: f.work,
          env: f.env({ PATH: `${bin}${windows ? ';' : ':'}${process.env.PATH ?? ''}`, RESULT: '5' }),
        },
      )
      expect(result.stderr).toBe('')
      expect(result.status).toBe(5)
      expect(f.request()?.args).toEqual(['repo', 'view', 'owner/repo'])
    })
  })
})
