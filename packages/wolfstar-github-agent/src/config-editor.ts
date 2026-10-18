import type { ConfigIssue } from './config.ts'
import type { Result } from './result.ts'
import type { AgentConfig } from './types.ts'
import { constants } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import process from 'node:process'
import { parseDocument } from 'yaml'
import { parseConfigText } from './config.ts'
import { err, ok } from './result.ts'
import { defaultPreflightDependencies, loadServiceInputs } from './service-preflight.ts'

export interface ConfigurationView {
  path: string
  revision: string
  values: Record<string, unknown>
}

export type ConfigurationError = { _tag: 'Invalid'; issues: ConfigIssue[] } | { _tag: 'Conflict' } | { _tag: 'Busy' }

export interface ConfigurationEditor {
  read: () => Promise<Result<ConfigurationView, ConfigurationError>>
  save: (input: unknown) => Promise<Result<ConfigurationView, ConfigurationError>>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const revision = (text: string): string => createHash('sha256').update(text).digest('hex')
const invalid = (message: string): Result<never, ConfigurationError> =>
  err({ _tag: 'Invalid', issues: [{ path: '$', message }] })

/** Changes YAML nodes only where the form changed a value, retaining comments and unknown settings. */
function updateDocument(text: string, values: Record<string, unknown>): string {
  const document = parseDocument(text)
  function update(before: unknown, after: unknown, path: (string | number)[]): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    if (Array.isArray(before) && Array.isArray(after)) {
      for (let index = before.length - 1; index >= after.length; index--) document.deleteIn([...path, index])
      after.forEach((value, index) => update(before[index], value, [...path, index]))
    } else if (record(before) && record(after)) {
      for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) document.deleteIn([...path, key])
      for (const [key, value] of Object.entries(after)) update(before[key], value, [...path, key])
    } else {
      document.setIn(path, after)
    }
  }
  update(document.toJS(), values, [])
  return document.toString()
}

/** A fixed, service-owned path; the browser never chooses which file to read or write. */
export function createConfigurationEditor(
  path: string,
  validate: (config: AgentConfig) => Promise<Result<unknown, ConfigIssue[]>> = (config) =>
    loadServiceInputs(path, {
      ...defaultPreflightDependencies,
      loadConfig: async () => ok(config),
    }),
): ConfigurationEditor {
  async function readText(): Promise<Result<string, ConfigurationError>> {
    if ((await lstat(path)).isSymbolicLink()) return invalid('Configuration path must not be a symbolic link.')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await file.stat()
      if (!metadata.isFile()) return invalid('Configuration path is not a regular file.')
      if (process.getuid !== undefined && metadata.uid !== process.getuid())
        return invalid('Configuration file has the wrong owner.')
      if (process.getuid !== undefined && (metadata.mode & 0o077) !== 0)
        return invalid('Configuration file must use mode 0600.')
      return ok(await file.readFile('utf8'))
    } finally {
      await file.close()
    }
  }

  function view(text: string): Result<ConfigurationView, ConfigurationError> {
    const parsed = parseConfigText(text)
    if (parsed._tag === 'Err') return err({ _tag: 'Invalid', issues: parsed.error })
    return ok({ path, revision: revision(text), values: parseDocument(text).toJS() as Record<string, unknown> })
  }

  return {
    async read() {
      const text = await readText()
      return text._tag === 'Err' ? text : view(text.value)
    },
    async save(input) {
      if (!record(input) || typeof input.revision !== 'string' || !record(input.values))
        return invalid('A configuration object and its revision are required.')
      const parsed = parseConfigText(JSON.stringify(input.values))
      if (parsed._tag === 'Err') return err({ _tag: 'Invalid', issues: parsed.error })

      const lockPath = `${path}.lock`
      const lock = await open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return null
        throw error
      })
      if (lock === null) return err({ _tag: 'Busy' })
      const temporaryPath = `${path}.${randomUUID()}.tmp`
      try {
        const before = await readText()
        if (before._tag === 'Err') return before
        if (revision(before.value) !== input.revision) return err({ _tag: 'Conflict' })
        const checked = await validate(parsed.value)
        if (checked._tag === 'Err') return err({ _tag: 'Invalid', issues: checked.error })
        const next = updateDocument(before.value, input.values)
        const nextView = view(next)
        if (nextView._tag === 'Err') return nextView
        const temporary = await open(temporaryPath, 'wx', 0o600)
        try {
          await temporary.writeFile(next, 'utf8')
          await temporary.sync()
        } finally {
          await temporary.close()
        }
        const current = await readText()
        if (current._tag === 'Err') return current
        if (revision(current.value) !== input.revision) return err({ _tag: 'Conflict' })
        await rename(temporaryPath, path)
        return nextView
      } finally {
        await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
          // No temporary exists when validation failed or rename succeeded.
          if (error.code !== 'ENOENT') throw error
        })
        await lock.close()
        await unlink(lockPath)
      }
    },
  }
}
