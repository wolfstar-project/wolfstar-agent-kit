import type { ConfigurationEditor } from '../../../src/config-editor.ts'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createError } from 'h3'
import { stringify } from 'yaml'
import { createConfigurationEditor } from '../../../src/config-editor.ts'
import { ok } from '../../../src/result.ts'

let editor: Promise<ConfigurationEditor> | undefined

/** A real disposable file for the local Settings flow, with no GitHub credentials required. */
export function configurationMock(): Promise<ConfigurationEditor> {
  editor ??= mkdtemp(join(tmpdir(), 'wolfstar-dashboard-config-')).then(async (directory) => {
    const path = join(directory, 'config.yml')
    await writeFile(
      path,
      stringify({
        agent: {
          provider: 'codex',
          order: ['opencode', 'claude', 'codex'],
          reserve_percent: { claude: 20, codex: 20, opencode: 50 },
        },
        github: {
          app_id: 12345,
          private_key_path: join(homedir(), '.config/wolfstar-github-agent/app.pem'),
          allowed_owners: ['wolfstar-project'],
        },
        server: { host: '127.0.0.1', port: 3210, allowed_origin: 'https://wolfstar-github-agent.localhost' },
        storage: { path: join(homedir(), '.local/share/wolfstar-github-agent/state.sqlite') },
        mutations_enabled: false,
        poll_interval_seconds: 60,
        issue_cutoff: '2026-07-14',
        external_repositories: [],
        repositories: [],
      }),
      { mode: 0o600 },
    )
    return createConfigurationEditor(path, async () => ok(undefined))
  })
  return editor
}

export function configurationMockError(error: { _tag: string; issues?: unknown }): never {
  throw createError({
    statusCode: error._tag === 'Invalid' ? 422 : 409,
    message: error._tag === 'Invalid' ? 'Configuration is invalid.' : 'Configuration changed. Reload before saving.',
    data: { issues: error.issues },
  })
}
