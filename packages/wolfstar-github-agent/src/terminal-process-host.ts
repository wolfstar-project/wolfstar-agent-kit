import type { TerminalProcessHost, TerminalScope } from './terminal-systemd.ts'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { createTerminalSystemdHost, verifyTerminalArtifact } from './terminal-systemd.ts'

/**
 * Which process manager owns terminal helpers on this host.
 *
 * Hogwild runs each helper as a systemd user unit. A Container has no systemd,
 * so the controller starts each helper as a detached process group and keeps
 * one record per unit in `directory`. The helper reads the same record to
 * prove who it is, so both sides must name the same kind.
 */
export type TerminalProcessHostKind = { _tag: 'Systemd' } | { _tag: 'Process'; directory: string }

export function createTerminalProcessHostFor(kind: TerminalProcessHostKind | undefined, nodePath: string) {
  return kind?._tag === 'Process'
    ? createTerminalProcessHost(nodePath, kind.directory)
    : createTerminalSystemdHost(nodePath)
}

interface UnitRecord {
  pid: number
  startTime: string
  invocationId: string
}

const UNIT = /^wolfstar-terminal-[a-f\d]{24}\.service$/

/**
 * The process start time from `/proc/<pid>/stat`, or null once the process is
 * gone or a zombie. Together with the PID it names one process, so a reused
 * PID never passes for the helper that held it.
 */
export async function processStartTime(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null)
  if (stat === null) return null
  // The command name may hold spaces and parentheses, so fields count from the last `)`.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  if (fields[0] === 'Z' || fields[0] === 'X') return null
  return fields[19] ?? null
}

/** The scope name a bound reservation records. `wolfstar-host-capacity` builds the same one. */
export function processControlGroup(pid: number, startTime: string): string {
  return `process:${pid}:${startTime}`
}

export function createTerminalProcessHost(
  nodePath: string,
  directory: string,
  path = process.env.PATH ?? '',
): TerminalProcessHost {
  if (!isAbsolute(directory)) throw new Error('Terminal process records require an absolute directory')
  const helperPath = [
    ...new Set([dirname(nodePath), ...path.split(':').filter(isAbsolute), '/usr/local/bin', '/usr/bin', '/bin']),
  ].join(':')
  const recordPath = (unit: string) => {
    if (!UNIT.test(unit)) throw new Error('Invalid terminal unit')
    return join(directory, `${unit}.json`)
  }
  async function readRecord(unit: string): Promise<UnitRecord | null> {
    const text = await readFile(recordPath(unit), 'utf8').catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') return null
      throw cause
    })
    if (text === null) return null
    const value = JSON.parse(text) as Partial<UnitRecord>
    return Number.isSafeInteger(value.pid) &&
      typeof value.startTime === 'string' &&
      typeof value.invocationId === 'string'
      ? (value as UnitRecord)
      : null
  }
  async function inspect(unit: string): Promise<TerminalScope> {
    const record = await readRecord(unit)
    if (record === null)
      return { loadState: 'not-found', activeState: 'inactive', invocationId: '', controlGroup: '', mainPid: 0 }
    const alive = (await processStartTime(record.pid)) === record.startTime
    return {
      loadState: 'loaded',
      activeState: alive ? 'active' : 'inactive',
      invocationId: record.invocationId,
      controlGroup: processControlGroup(record.pid, record.startTime),
      mainPid: alive ? record.pid : 0,
    }
  }
  return {
    inspect,
    async start(options) {
      await verifyTerminalArtifact(options.artifact)
      const target = recordPath(options.unit)
      const existing = await inspect(options.unit)
      if (existing.activeState === 'active') throw new Error('Terminal unit is already running')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // A detached group outlives a controller restart, as a systemd unit does.
      const child = spawn(nodePath, [options.artifact.entry, options.config], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: helperPath, WOLFSTAR_HOST_RESERVATION: options.reservationId },
      })
      const pid = await new Promise<number>((resolve, reject) => {
        child.once('spawn', () => resolve(child.pid!))
        child.once('error', reject)
      })
      child.unref()
      const startTime = await processStartTime(pid)
      if (startTime === null) throw new Error('Terminal helper exited before it was recorded')
      const record: UnitRecord = { pid, startTime, invocationId: randomUUID().replaceAll('-', '') }
      // Write beside the target and rename, so the helper never reads half a record.
      const next = `${target}.${process.pid}`
      await writeFile(next, JSON.stringify(record), { mode: 0o600 })
      await rename(next, target)
    },
    async stop(unit, invocationId) {
      const before = await inspect(unit)
      if (!invocationId || before.invocationId !== invocationId) return 'Unknown'
      if (before.mainPid === 0) return 'Stopped'
      const signal = (name: NodeJS.Signals) => {
        try {
          process.kill(-before.mainPid, name)
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause
        }
      }
      signal('SIGTERM')
      for (let check = 0; check < 100; check++) {
        if ((await inspect(unit)).mainPid === 0) return 'Stopped'
        await setTimeout(100)
      }
      signal('SIGKILL')
      await setTimeout(200)
      return (await inspect(unit)).mainPid === 0 ? 'Stopped' : 'Unknown'
    },
  }
}

/**
 * The helper's view of its own unit. The record is written right after the
 * spawn, so a helper that starts faster than that waits for it briefly.
 */
export async function inspectOwnTerminalScope(
  kind: TerminalProcessHostKind | undefined,
  unit: string,
): Promise<TerminalScope> {
  const host = createTerminalProcessHostFor(kind, process.execPath)
  let scope = await host.inspect(unit)
  for (let check = 0; kind?._tag === 'Process' && scope.mainPid !== process.pid && check < 50; check++) {
    await setTimeout(100)
    scope = await host.inspect(unit)
  }
  return scope
}
