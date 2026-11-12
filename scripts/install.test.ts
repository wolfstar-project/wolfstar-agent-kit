// The agent-gh installers. The full install (clone, pnpm, sync) needs the
// network, so these cover what decides correctness without it: the Node
// floor, the options, a dry run that writes nothing, and the PowerShell token
// handling against a stand-in GitHub, which on Windows checks the icacls ACL.
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const windows = process.platform === 'win32'
const pwsh = process.env.WOLFSTAR_PWSH ?? 'pwsh'
const available =
  spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0
if (!available && process.env.CI) throw new Error(`PowerShell 7 is required in CI: ${pwsh}`)

const bashInstaller = resolve('scripts/install.sh')
const psInstaller = resolve('scripts/install.ps1')
const wrapper = resolve('scripts/github-public.ps1')
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function tempHome() {
  const root = mkdtempSync(join(tmpdir(), 'agent-gh-install-'))
  roots.push(root)
  return root
}

describe('installer requirements', () => {
  it('keeps the Node floor equal to the engines field', () => {
    const engines = JSON.parse(readFileSync('packages/wolfstar-github-agent/package.json', 'utf8')).engines.node
    const floor = engines.replace(/^>=/, '')
    // A Windows checkout may carry CRLF line endings.
    expect(readFileSync(bashInstaller, 'utf8')).toMatch(
      new RegExp(`^min_node=${floor.replaceAll('.', '\\.')}\r?$`, 'm'),
    )
    expect(readFileSync(psInstaller, 'utf8')).toContain(`$MinNode = [version]'${floor}'`)
  })
})

describe.skipIf(windows)('install.sh', { timeout: 60_000 }, () => {
  const bash = (args: string[], home: string, extra: Record<string, string> = {}) =>
    spawnSync('bash', [bashInstaller, ...args], {
      encoding: 'utf8',
      cwd: resolve('.'),
      env: { ...process.env, HOME: home, ...extra },
    })

  it('prints its options', () => {
    const result = bash(['--help'], tempHome())
    expect(result.status).toBe(0)
    for (const option of ['--dry-run', '--skip-clone', '--dir', '--replace-token', 'WOLFSTAR_AGENT_GITHUB_TOKEN'])
      expect(result.stdout).toContain(option)
  })

  it('refuses an unknown option', () => {
    const result = bash(['--nope'], tempHome())
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown option: --nope')
  })

  // Needs the real prerequisites, which CI has and an older local Node lacks.
  it.skipIf(Number(process.versions.node.split('.')[0]) < 24)('writes nothing in a dry run', () => {
    const home = tempHome()
    // agent-gh trusts a gh in ~/.local/bin, so the prerequisite check passes anywhere.
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const before = readdirSync(home, { recursive: true })
    const result = bash(['--dry-run', '--skip-clone'], home, { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_secret' })
    expect(result.stderr).not.toContain('error:')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[dry-run] corepack pnpm sync:context')
    expect(result.stdout).toContain('Dry run complete. Nothing changed.')
    expect(`${result.stdout}${result.stderr}`).not.toContain('github_pat_secret')
    expect(readdirSync(home, { recursive: true })).toEqual(before)
  })
})

describe.skipIf(!available)('install.ps1', { timeout: 60_000 }, () => {
  // A stand-in for GET /user that answers by token.
  const logins: Record<string, string> = {
    github_pat_good: 'wolfstarbot',
    github_pat_good2: 'wolfstarbot',
    github_pat_other: 'someoneelse',
  }
  let server: Server
  let api = ''
  beforeAll(async () => {
    server = createServer((request, response) => {
      const login = logins[(request.headers.authorization ?? '').replace(/^Bearer /, '')]
      if (request.url !== '/user' || !login) {
        response.writeHead(401).end('{"message":"Bad credentials"}')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ login }))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((done) => server.close(() => done())))

  // Loads the installer's and agent-gh's functions, then runs a snippet. The
  // server answers in this process, so the child must run asynchronously.
  async function snippet(home: string, body: string, extra: Record<string, string> = {}) {
    const driver = join(home, `driver-${Math.random().toString(36).slice(2)}.ps1`)
    writeFileSync(driver, `$ErrorActionPreference = 'Stop'\n. ${quote(psInstaller)}\n. ${quote(wrapper)}\n${body}\n`)
    try {
      const { stdout, stderr } = await run(pwsh, ['-NoProfile', '-NonInteractive', '-File', driver], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, WOLFSTAR_AGENT_GITHUB_API: api, ...extra },
      })
      return { status: 0, stdout, stderr }
    } catch (error) {
      const failed = error as { code: number; stdout: string; stderr: string }
      return { status: failed.code, stdout: failed.stdout, stderr: failed.stderr }
    }
  }
  const tokenPath = (home: string) => join(home, '.config', 'wolfstar-agent-kit', 'github-public-token')

  // Owner-only on both platforms: mode 600, or one allow rule for the current
  // user and no inherited rules.
  async function expectOwnerOnly(home: string) {
    if (!windows) {
      expect(statSync(tokenPath(home)).mode & 0o777).toBe(0o600)
      return
    }
    const result = await snippet(
      home,
      `$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl([System.IO.FileInfo]::new(${quote(tokenPath(home))}))
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
@{ protected = $acl.AreAccessRulesProtected; sids = @($rules | ForEach-Object { $_.IdentityReference.Value }); user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress`,
    )
    const acl = JSON.parse(result.stdout)
    expect(acl.protected).toBe(true)
    expect(acl.sids).toEqual([acl.user])
  }

  it('defines no function that the dot-sourced agent-gh would replace', () => {
    const names = (path: string) =>
      new Set([...readFileSync(path, 'utf8').matchAll(/^function ([\w-]+)/gm)].map((m) => m[1]))
    const wrapperNames = names(wrapper)
    expect([...names(psInstaller)].filter((name) => wrapperNames.has(name))).toEqual([])
  })

  it('runs pnpm inside the checkout, wherever it starts', async () => {
    const home = tempHome()
    const record = join(home, 'corepack.log')
    // A function named corepack wins over the real command, so each call
    // records its directory and arguments.
    const result = await snippet(
      home,
      `function corepack { Add-Content -LiteralPath ${quote(record)} -Value "$((Get-Location).ProviderPath)|$($args -join ' ')"; $global:LASTEXITCODE = 0 }
Set-Location -LiteralPath ${quote(home)}
Install-Workspace ${quote(resolve('.'))}`,
    )
    expect(result.stderr).toBe('')
    const calls = readFileSync(record, 'utf8').trim().split(/\r?\n/)
    const pnpm = calls.filter((line) => line.split('|')[1].startsWith('pnpm '))
    expect(pnpm.map((line) => line.split('|')[1])).toEqual([
      'pnpm install --frozen-lockfile --filter wolfstar-agent-kit',
      'pnpm sync:context',
    ])
    for (const line of pnpm) expect(line.split('|')[0]).toBe(resolve('.'))
  })

  it('prints its options', async () => {
    const { stdout } = await run(pwsh, ['-NoProfile', '-NonInteractive', '-File', psInstaller, '-Help'])
    for (const option of ['-DryRun', '-SkipClone', '-Directory', '-ReplaceToken', '-AddToPath'])
      expect(stdout).toContain(option)
  })

  it('saves a token that GitHub confirms, owner only, and never prints it', async () => {
    const home = tempHome()
    const result = await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good' })
    expect(result.stderr).not.toContain('error')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Saved the token for wolfstarbot')
    expect(`${result.stdout}${result.stderr}`).not.toContain('github_pat_good')
    expect(readFileSync(tokenPath(home), 'utf8')).toBe('github_pat_good')
    await expectOwnerOnly(home)
  })

  it('keeps a working token unless asked to replace it', async () => {
    const home = tempHome()
    await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good' })
    const kept = await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good2' })
    expect(kept.stdout).toContain('Keeping the saved token')
    expect(readFileSync(tokenPath(home), 'utf8')).toBe('github_pat_good')
    const replaced = await snippet(home, '$ReplaceToken = $true; Install-Token | Out-Null', {
      WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good2',
    })
    expect(replaced.stdout).toContain('Saved the token for wolfstarbot')
    expect(readFileSync(tokenPath(home), 'utf8')).toBe('github_pat_good2')
    await expectOwnerOnly(home)
  })

  it('refuses a token for another account and saves nothing', async () => {
    const home = tempHome()
    const result = await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_other' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('The token belongs to someoneelse, not wolfstarbot. Nothing was saved.')
    expect(existsSync(tokenPath(home))).toBe(false)
  })

  it('replaces a saved token that GitHub rejects', async () => {
    const home = tempHome()
    await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good' })
    await snippet(home, `Write-AgentGhToken -Token 'github_pat_revoked' -Path ${quote(tokenPath(home))} -Replace`)
    const result = await snippet(home, 'Install-Token | Out-Null', { WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_good' })
    expect(result.stderr).toContain('GitHub rejected the saved token')
    expect(readFileSync(tokenPath(home), 'utf8')).toBe('github_pat_good')
  })

  // The dry run has nothing Windows specific to skip, so it runs on Linux too.
  it.skipIf(Number(process.versions.node.split('.')[0]) < 24)('writes nothing in a dry run', async () => {
    const home = tempHome()
    const fake = join(home, '.local', 'bin', windows ? 'gh.exe' : 'gh')
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const before = readdirSync(home, { recursive: true })
    const { stdout } = await run(
      pwsh,
      ['-NoProfile', '-NonInteractive', '-File', psInstaller, '-DryRun', '-SkipClone'],
      {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, USERPROFILE: home, WOLFSTAR_AGENT_GITHUB_TOKEN: 'github_pat_secret' },
      },
    )
    expect(stdout).toContain('[dry-run] corepack pnpm sync:context')
    expect(stdout).toContain('Dry run complete. Nothing changed.')
    expect(stdout).not.toContain('github_pat_secret')
    // pwsh keeps its own caches under the home: ~/.cache and ~/.local/share
    // on Linux, AppData on Windows.
    const own = new Set(['.cache', join('.local', 'share')])
    const added = readdirSync(home, { recursive: true })
      .map(String)
      .filter(
        (path) => !before.includes(path) && !own.has(path) && !/powershell/i.test(path) && !/^AppData(\\|$)/.test(path),
      )
    expect(added).toEqual([])
  })
})
