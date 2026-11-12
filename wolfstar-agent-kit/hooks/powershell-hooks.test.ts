// Holds every PowerShell hook to the decisions of its bash twin. Each case feeds
// one stdin JSON to both scripts and compares the parsed stdout. The suite
// needs pwsh 7 and bash with jq. CI must run it, so a missing pwsh there fails.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const hooks = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(hooks, '..')
const pwsh = process.env.WOLFSTAR_PWSH ?? 'pwsh'
const available = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', '1']).status === 0
if (!available && process.env.CI) throw new Error(`PowerShell 7 is required in CI: ${pwsh}`)
const hasBash = process.platform !== 'win32' && spawnSync('jq', ['--version']).status === 0

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'ps-hooks-'))
  roots.push(root)
  return root
}

interface Run {
  stdout: string
  status: number | null
}

function run(command: string, args: string[], input: string, cwd: string, env: Record<string, string>): Promise<Run> {
  return new Promise((resolveRun) => {
    // Concurrent pwsh processes corrupt one shared startup cache, so each gets its own.
    const cache = command === pwsh ? { XDG_CACHE_HOME: temporary() } : {}
    const child = spawn(command, args, { cwd, env: { ...process.env, ...cache, ...env } })
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.on('close', (status) => resolveRun({ stdout, status }))
    child.stdin.end(input)
  })
}

const bashHook = (name: string, input: unknown, cwd: string, env: Record<string, string> = {}) =>
  run('bash', [join(hooks, `${name}.sh`)], JSON.stringify(input), cwd, env)
const powerShellHook = (name: string, input: unknown, cwd: string, env: Record<string, string> = {}) =>
  run(pwsh, ['-NoProfile', '-NonInteractive', '-File', join(hooks, `${name}.ps1`)], JSON.stringify(input), cwd, env)

/** The hook answer as data, so key order and spacing cannot differ. */
const answer = (run: Run): unknown => {
  expect(run.status).toBe(0)
  const text = run.stdout.trim()
  return text === '' ? null : JSON.parse(text)
}

async function expectSameAnswers(name: string, inputs: unknown[], env: Record<string, string> = {}) {
  const cwd = temporary()
  const [bash, powerShell] = await Promise.all([
    Promise.all(inputs.map((input) => bashHook(name, input, cwd, env))),
    Promise.all(inputs.map((input) => powerShellHook(name, input, cwd, env))),
  ])
  inputs.forEach((input, index) => {
    expect(answer(powerShell[index]!), JSON.stringify(input)).toEqual(answer(bash[index]!))
  })
}

const bashInput = (command: string) => ({ tool_input: { command } })
const heredoc = (...lines: string[]) => lines.join('\n')

const commands: Record<string, string[]> = {
  'pnpm-only': ['npm install', 'yarn add x', 'npx vitest', 'npm', 'pnpm install', 'echo npm install', 'git status'],
  'wt-only': [
    'git worktree add ../foo bar',
    'git -C /repo worktree remove foo',
    'git worktree prune',
    'cd .claude/worktrees/x && pnpm test',
    'wt switch --clobber feat/x',
    'wt remove feat/x --force',
    'pnpm install && git worktree add ../foo bar',
    'pnpm install; git worktree prune',
    'git worktree list',
    'wt switch --create feat/x --base main',
    'echo git worktree adds',
    'echo "never write to .claude/worktrees"',
    "rg -n '.claude/worktrees' docs/",
    'grep -r "git worktree add" docs/',
    heredoc('cat > notes.md <<EOF', 'Never use .claude/worktrees here.', 'Use wt, not git worktree add.', 'EOF'),
    heredoc("cat > notes.md <<'DOC'", 'wt remove feat/x --force drops work.', 'DOC'),
    heredoc('cat > notes.md <<EOF', 'harmless prose', 'EOF', 'git worktree add ../foo bar'),
    heredoc('echo "see cat <<EOF notes"', 'git worktree add /tmp/x b'),
    'git worktree list \\\n&& git worktree add x y',
    '',
  ],
  'pr-skill-only': [
    'gh pr create --title "fix: example" --body "wrong"',
    'cd /repo && gh pr create --fill',
    'gh pr edit 42 --body "wrong"',
    'gh pr edit 42 --body-file /tmp/pr.md',
    'gh pr edit 42 \\\n--body-file /tmp/pr.md',
    'cd /repo \\\n&& gh pr edit 42 --body-file /tmp/pr.md',
    'WOLFSTAR_AGENT_PR_SKILL=1 gh pr edit 42 \\\n--body-file /tmp/pr.md',
    heredoc('cat > /tmp/pr.md <<EOF \\', 'ignored', 'EOF', 'gh pr create --title t --body-file /tmp/pr.md'),
    heredoc('echo "see cat <<EOF notes"', 'gh pr create --fill'),
    'echo "see cat <<EOF notes"',
    'FOO=1 gh pr create --fill',
    '`gh pr create --fill`',
    'WOLFSTAR_AGENT_PR_SKILL=1 gh pr create --title "fix: example" --body "right"',
    'WOLFSTAR_AGENT_PR_SKILL=1 gh pr edit 42 --body "right"',
    'env WOLFSTAR_AGENT_PR_SKILL=1 gh pr create --fill',
    'WOLFSTAR_AGENT_PR_SKILL=2 gh pr create --fill',
    heredoc('cd /repo', 'gh pr create --fill'),
    heredoc('cd /repo', 'WOLFSTAR_AGENT_PR_SKILL=1 gh pr create --fill'),
    'gh pr edit 42 --add-label ready',
    'gh pr view 42 --json body',
    'echo gh pr create',
  ],
  'himalaya-read-only': [
    'himalaya envelope list',
    'himalaya -a clients envelope list --folder INBOX',
    'himalaya message read 12',
    'himalaya message export 12',
    'himalaya message delete 12',
    'himalaya message move 12 Trash',
    'himalaya flag add 12 seen',
    'himalaya send',
    'himalaya template send',
    'himalaya folder list',
    'himalaya folder delete X',
    'himalaya attachment download 4',
    'himalaya account list',
    'himalaya account configure x',
    'himalaya --help',
    'himalaya',
    'himalaya manual',
    'himalaya envelope list | head && himalaya message delete 1',
    'cd ~ && himalaya envelope thread 1',
    'echo himalaya message delete 1',
    'ls | himalaya message write',
    heredoc('echo hi', 'himalaya message delete 3'),
  ],
  'github-read-routing': [
    'gh api repos/owner/public/issues',
    'agent-gh api repos/owner/public/issues',
    'gh pr view 1 --repo owner/public',
    'gh --repo owner/public pr view 1',
    'gh pr list',
    'gh issue view 4',
    'gh search issues foo',
    'gh search code foo',
    'gh run watch 123',
    'gh api user',
    'gh api user -X POST',
    'gh api repos/owner/public --method DELETE',
    'gh api graphql -f query=x',
    'gh pr create --fill',
    'gh pr merge 3',
    'gh repo clone owner/x',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr view 1 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr view 1 --repo owner/other',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr view 1',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh repo view owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh api repos/owner/private/issues',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh api repos/owner/other/issues',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr view 1 --repo owner/private; gh api repos/owner/public/issues',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --interval 3 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --interval=59 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --interval 60 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 -i60 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --interval 060 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh run watch 123 --interval --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr checks 1 --watch --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr checks 1 --watch --interval 60 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh pr checks 1 --repo owner/private',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh --repo owner/private run watch 123',
    'WOLFSTAR_AGENT_GITHUB_PRIVATE=owner/private gh -R owner/private run watch 123 --interval 60',
    'env -u GH_TOKEN gh api repos/owner/public',
    'timeout 5 gh pr view 1',
    '/usr/bin/gh pr view 1',
    'echo "gh pr view 1"',
    'bash -c "gh pr view 1"',
    'cd x && gh issue list',
    heredoc('cd x', 'gh issue list'),
    'echo ok',
  ],
  'pre-commit-push': ['git commit -m x', 'git commit', 'git push', 'echo git commit', ''],
}

describe.skipIf(!available || !hasBash)('PowerShell hooks match their bash twins', { timeout: 180_000 }, () => {
  it.each(Object.keys(commands))('%s decides each command the same way', async (name) => {
    await expectSameAnswers(name, commands[name]!.map(bashInput))
  })

  it('github-read-routing reads the cmd input key', async () => {
    await expectSameAnswers('github-read-routing', [{ tool_input: { cmd: 'gh api repos/owner/public/issues' } }])
  })

  it('answers nothing for an empty or unreadable input', async () => {
    const cwd = temporary()
    for (const name of Object.keys(commands)) {
      const result = await run(pwsh, ['-NoProfile', '-File', join(hooks, `${name}.ps1`)], '', cwd, {})
      expect(result.status, name).toBe(0)
      expect(result.stdout.trim(), name).toBe('')
    }
  })

  it('pnpm-only rewrites to the same command', async () => {
    const cwd = temporary()
    const result = answer(await powerShellHook('pnpm-only', bashInput('npx vitest run'), cwd)) as {
      hookSpecificOutput: { updatedInput: { command: string } }
    }
    expect(result.hookSpecificOutput.updatedInput.command).toBe('pnpm dlx vitest run')
  })

  it('a hook listed in .claude/hooks.json stays off', async () => {
    const cwd = temporary()
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(join(cwd, '.claude', 'hooks.json'), JSON.stringify({ disabled: ['wt-only', 'himalaya-read-only'] }))
    const input = bashInput('git worktree add ../foo bar')
    expect(answer(await powerShellHook('wt-only', input, cwd))).toBeNull()
    expect(answer(await powerShellHook('himalaya-read-only', bashInput('himalaya send'), cwd))).toBeNull()
  })

  it('merged-branch-guard allows every command off a feature branch with no merged pull request', async () => {
    const cwd = temporary()
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd })
    // Both hooks stop at main, and ignore a command that is not a mutation.
    const inputs = ['git push', 'git commit -m x', 'git status', 'echo hi'].map(bashInput)
    for (const input of inputs) {
      expect(answer(await powerShellHook('merged-branch-guard', input, cwd))).toBeNull()
      expect(answer(await bashHook('merged-branch-guard', input, cwd))).toBeNull()
    }
  })

  it('merged-branch-guard denies a branch cached as merged', async () => {
    const cwd = temporary()
    spawnSync('git', ['init', '-q', '-b', 'feature/done'], { cwd })
    const session = `ps-hooks-${process.pid}-${Date.now()}`
    const cache = join(tmpdir(), `claude-merged-branch-${session}`)
    writeFileSync(cache, 'feature/done\n')
    roots.push(cache)
    const env = { CLAUDE_SESSION_ID: session, TMPDIR: tmpdir() }
    const input = bashInput('git push')
    const bash = answer(await bashHook('merged-branch-guard', input, cwd, env))
    const powerShell = answer(await powerShellHook('merged-branch-guard', input, cwd, env))
    expect(powerShell).toEqual(bash)
    expect(JSON.stringify(powerShell)).toContain('has a merged PR')
  })

  it('command-not-found suggests an install once per session', async () => {
    const cwd = temporary()
    const session = `ps-hooks-cnf-${process.pid}-${Date.now()}`
    const input = { tool_input: { command: 'frobnicate --now' }, tool_output: 'bash: frobnicate: command not found' }
    const env = { CLAUDE_SESSION_ID: session, TMPDIR: tmpdir() }
    roots.push(join(tmpdir(), `claude-cmd-notfound-${session}`))
    const first = answer(await powerShellHook('command-not-found', input, cwd, env)) as {
      hookSpecificOutput: { decision: string; message: string }
    }
    expect(first.hookSpecificOutput.decision).toBe('followup_message')
    expect(first.hookSpecificOutput.message).toContain('`frobnicate` is not installed')
    expect(answer(await powerShellHook('command-not-found', input, cwd, env))).toBeNull()
  })

  it('command-not-found reads a PowerShell error too', async () => {
    const cwd = temporary()
    const input = {
      tool_input: { command: 'frobnicate' },
      tool_output:
        "The term 'frobnicate' is not recognized as a name of a cmdlet, function, script file, or executable program.",
    }
    const env = { CLAUDE_SESSION_ID: `ps-hooks-cnf2-${process.pid}-${Date.now()}` }
    const result = answer(await powerShellHook('command-not-found', input, cwd, env)) as {
      hookSpecificOutput: { message: string }
    }
    expect(result.hookSpecificOutput.message).toContain('`frobnicate` is not installed')
  })

  it('command-not-found flags an unknown option once', async () => {
    const cwd = temporary()
    const input = { tool_input: { command: '/bin/ls --nope' }, tool_output: "ls: unrecognized option '--nope'" }
    const env = { CLAUDE_SESSION_ID: `ps-hooks-cnf3-${process.pid}-${Date.now()}` }
    const result = answer(await powerShellHook('command-not-found', input, cwd, env)) as {
      hookSpecificOutput: { message: string }
    }
    expect(result.hookSpecificOutput.message).toContain('for `ls`')
  })

  it('session-start prints the same project lines as the bash hook', async () => {
    const cwd = temporary()
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { vue: '^3' } }))
    writeFileSync(join(cwd, 'package-lock.json'), '{}')
    const [bash, powerShell] = await Promise.all([
      run('bash', [join(hooks, 'session-start.sh')], '{}', cwd, {}),
      run(pwsh, ['-NoProfile', '-File', join(hooks, 'session-start.ps1')], '{}', cwd, {}),
    ])
    expect(powerShell.status).toBe(0)
    expect(powerShell.stdout).toBe(bash.stdout)
    expect(powerShell.stdout).toContain('Vue Project: demo')
    expect(powerShell.stdout).toContain('npm detected - use pnpm')
  })

  it('session-start stays quiet for a sub-agent', async () => {
    const cwd = temporary()
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo' }))
    writeFileSync(join(cwd, 'yarn.lock'), '')
    const result = await run(
      pwsh,
      ['-NoProfile', '-File', join(hooks, 'session-start.ps1')],
      '{"agent_type":"task"}',
      cwd,
      {},
    )
    expect(result.stdout).toContain('yarn detected - use pnpm')
    expect(result.stdout).not.toContain('Node Project')
  })

  it('oxlint skips a file it does not lint', async () => {
    const cwd = temporary()
    const result = await powerShellHook('oxlint', { tool_input: { file_path: join(cwd, 'a.png') } }, cwd)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('the Windows manifest registers the same hooks as plugin.json, in order, with the same matchers and timeouts', () => {
    type Manifest = { hooks: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]> }
    const read = (name: string) =>
      JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', name), 'utf8')) as Manifest
    const shape = (manifest: Manifest, script: (command: string) => string) =>
      Object.fromEntries(
        Object.entries(manifest.hooks).map(([event, groups]) => [
          event,
          groups.map((group) => ({
            matcher: group.matcher,
            hooks: group.hooks.map((hook) => ({ script: script(hook.command), timeout: hook.timeout })),
          })),
        ]),
      )
    const bash = shape(read('plugin.json'), (command) => command.split('/').pop()!.replace(/\.sh$/, ''))
    const windows = shape(read('plugin.windows.json'), (command) => {
      const found =
        /^pwsh -NoProfile -NonInteractive -File "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([A-Za-z0-9-]+)\.ps1"$/.exec(command)
      expect(found, command).not.toBeNull()
      return found![1]!
    })
    expect(Object.keys(bash).length).toBeGreaterThan(0)
    expect(windows).toEqual(bash)
  })

  it('every hook the Windows manifest registers has a PowerShell script', () => {
    const manifest = readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.windows.json'), 'utf8')
    const names = [...manifest.matchAll(/hooks\/([A-Za-z0-9-]+)\.ps1/g)].map((match) => match[1]!)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(() => readFileSync(join(hooks, `${name}.ps1`)), name).not.toThrow()
  })

  it('the Windows installer places hooks that run from the install directory', async () => {
    const home = temporary()
    const env = { WOLFSTAR_AGENT_CONTEXT_HOME: home, USERPROFILE: home, HOME: home }
    const installer = join(pluginRoot, '..', 'scripts', 'sync-agent-context.ps1')
    const install = (mode: string) =>
      run(pwsh, ['-NoProfile', '-NonInteractive', '-File', installer, '-Mode', mode], '', home, env)
    expect((await install('check')).status).toBe(1)
    const first = await install('local')
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('PowerShell hook files')
    expect((await install('check')).status).toBe(0)
    expect((await install('local')).stdout).toContain('The PowerShell hooks are current')

    const share = join(home, '.local', 'share', 'wolfstar-agent-kit')
    const installedManifest = JSON.parse(readFileSync(join(share, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      name: string
    }
    expect(installedManifest.name).toBe('wolfstar-agent-kit-hooks')
    const result = await run(
      pwsh,
      ['-NoProfile', '-NonInteractive', '-File', join(share, 'hooks', 'wt-only.ps1')],
      JSON.stringify(bashInput('git worktree prune')),
      home,
      {},
    )
    expect(JSON.stringify(answer(result))).toContain('Use wt')

    writeFileSync(join(share, 'hooks', 'wt-only.ps1'), '# stale\n')
    expect((await install('check')).status).toBe(1)
  })
})
