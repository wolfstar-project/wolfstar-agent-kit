import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { isMap, isScalar, parseDocument } from 'yaml'
import { createConfigurationEditor } from '../src/config-editor.ts'
import { ok } from '../src/result.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'wolfstar-config-'))
  directories.push(directory)
  const path = join(directory, 'config.yml')
  const text = `# Keep this local explanation.
github:
  app_id: 12345
  private_key_path: ${JSON.stringify(join(homedir(), 'app.pem'))}
  allowed_owners: [wolfstar-project]
server:
  host: 127.0.0.1
  port: 3210
  allowed_origin: https://wolfstar-github-agent.localhost
storage:
  path: ${JSON.stringify(join(homedir(), '.local/share/wolfstar-github-agent/state.sqlite'))}
mutations_enabled: false
poll_interval_seconds: 60
issue_cutoff: 2026-07-14
external_repositories: []
repositories: []
future_setting: { keep: yes }
`
  await writeFile(path, text, { mode: 0o600 })
  const editor = createConfigurationEditor(path, async () => ok(undefined))
  const loaded = await editor.read()
  if (loaded._tag === 'Err') throw new Error(JSON.stringify(loaded.error))
  return { path, editor, loaded: loaded.value }
}

describe('local configuration editing', () => {
  it('saves a form change while preserving comments and advanced configuration', async () => {
    const { path, editor, loaded } = await fixture()
    const result = await editor.save({
      revision: loaded.revision,
      values: { ...loaded.values, poll_interval_seconds: 120 },
    })
    expect(result._tag).toBe('Ok')
    const saved = parseDocument(await readFile(path, 'utf8'))
    expect(saved.get('poll_interval_seconds')).toBe(120)
    expect(saved.getIn(['future_setting', 'keep'])).toBe('yes')
    const firstKey = isMap(saved.contents) ? saved.contents.items[0]?.key : undefined
    expect(isScalar(firstKey) && firstKey.commentBefore).toContain('Keep this local explanation.')
  })

  it('rejects invalid form values without changing the file', async () => {
    const { editor, loaded } = await fixture()
    const result = await editor.save({
      revision: loaded.revision,
      values: { ...loaded.values, poll_interval_seconds: 1 },
    })
    expect(result._tag === 'Err' && result.error._tag).toBe('Invalid')
    expect(await editor.read()).toEqual(ok(loaded))
  })

  it('refuses to overwrite a newer file from another dashboard or manual edit', async () => {
    const { path, editor, loaded } = await fixture()
    await writeFile(path, `${await readFile(path, 'utf8')}# A later edit.\n`)
    const newer = await editor.read()
    const result = await editor.save({
      revision: loaded.revision,
      values: { ...loaded.values, poll_interval_seconds: 120 },
    })
    expect(result).toEqual({ _tag: 'Err', error: { _tag: 'Conflict' } })
    expect(await editor.read()).toEqual(newer)
  })

  it('rejects a configuration that fails service preflight before replacing the file', async () => {
    const { path, loaded } = await fixture()
    const editor = createConfigurationEditor(path, async () => ({
      _tag: 'Err',
      error: [{ path: '$.github.private_key_path', message: 'Missing key.' }],
    }))
    const result = await editor.save({
      revision: loaded.revision,
      values: { ...loaded.values, poll_interval_seconds: 120 },
    })
    expect(result).toEqual({
      _tag: 'Err',
      error: { _tag: 'Invalid', issues: [{ path: '$.github.private_key_path', message: 'Missing key.' }] },
    })
    expect(await editor.read()).toEqual(ok(loaded))
  })

  it('serializes saves and prevents a second editor from replacing a file under validation', async () => {
    const { path, loaded } = await fixture()
    let finish!: () => void
    let entered!: () => void
    const validating = new Promise<void>((resolve) => {
      entered = resolve
    })
    const waiting = new Promise<void>((resolve) => {
      finish = resolve
    })
    const editor = createConfigurationEditor(path, async () => {
      entered()
      await waiting
      return ok(undefined)
    })
    const input = { revision: loaded.revision, values: { ...loaded.values, poll_interval_seconds: 120 } }
    const first = editor.save(input)
    await validating
    const second = await createConfigurationEditor(path, async () => ok(undefined)).save(input)
    finish()
    expect(second).toEqual({ _tag: 'Err', error: { _tag: 'Busy' } })
    expect((await first)._tag).toBe('Ok')
  })

  it.skipIf(process.getuid === undefined)('refuses a configuration readable by other users', async () => {
    const { path, editor } = await fixture()
    await chmod(path, 0o644)
    const result = await editor.read()
    expect(result._tag === 'Err' && result.error._tag).toBe('Invalid')
  })
})
