import { execFile, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setHostSlotPolicy } from '../src/host-slot-policy.ts'
import { parseMaintenanceAuthority } from '../src/maintenance-scope.ts'
import { createTerminalAdmissionCli } from '../src/terminal-admission.ts'
import { parseHostTerminalCapacity } from '../src/terminal-capacity.ts'

const command = resolve(import.meta.dirname, '../../wolfstar-github-edge/container/wolfstar-host-capacity')
const run = promisify(execFile)

let state: string
let previous: string | undefined
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'host-capacity-'))
  previous = process.env.WOLFSTAR_HOST_CAPACITY_STATE
  process.env.WOLFSTAR_HOST_CAPACITY_STATE = state
})
afterEach(() => {
  if (previous === undefined) delete process.env.WOLFSTAR_HOST_CAPACITY_STATE
  else process.env.WOLFSTAR_HOST_CAPACITY_STATE = previous
  rmSync(state, { recursive: true, force: true })
})

describe('single account host capacity command', () => {
  it('is executable, so the image can run it without a shell', () => {
    expect(statSync(command).mode & 0o111).not.toBe(0)
  })

  it('answers status in the shape the controller requires', async () => {
    const { stdout } = await run(command, ['status'])

    expect(() => parseMaintenanceAuthority(JSON.parse(stdout))).not.toThrow()
    expect(JSON.parse(stdout).policy).toEqual({ agentSlots: 0, maintenanceReserve: 0 })
  })

  it('records the policy the controller sets, and the controller accepts the answer', async () => {
    await expect(setHostSlotPolicy(command, 2)).resolves.toBeUndefined()

    const { stdout } = await run(command, ['status'])
    expect(JSON.parse(stdout).policy).toEqual({ agentSlots: 2, maintenanceReserve: 1 })
  })

  it('keeps one host and boot identity across calls', async () => {
    const first = JSON.parse((await run(command, ['status'])).stdout)
    const second = JSON.parse((await run(command, ['status'])).stdout)

    expect(second.hostId).toBe(first.hostId)
    expect(second.bootId).toBe(first.bootId)
  })

  it('refuses a policy the host cannot hold', async () => {
    for (const args of [['policy', '2', '3'], ['policy', 'x', '1'], ['policy', '999', '1'], ['policy']]) {
      await expect(run(command, args)).rejects.toMatchObject({ code: 2 })
    }
  })

  it('runs an admitted command with its output and exit code intact', () => {
    const ok = spawnSync(command, [
      'run',
      'maintenance:abc',
      '4',
      process.execPath,
      '-e',
      'console.log(JSON.stringify({a:1}))',
    ])
    const failed = spawnSync(command, ['run', 'maintenance:abc', '4', process.execPath, '-e', 'process.exit(7)'])

    expect(ok.stdout.toString()).toBe('{"a":1}\n')
    expect(ok.status).toBe(0)
    expect(failed.status).toBe(7)
  })

  it('hands each admitted command its own host reservation, which the maintenance worker requires', () => {
    const args = [
      'run',
      'maintenance:abc',
      '4',
      process.execPath,
      '-e',
      'console.log(process.env.WOLFSTAR_HOST_RESERVATION)',
    ]
    const first = spawnSync(command, args, { env: { ...process.env, WOLFSTAR_HOST_RESERVATION: '' } })
    const second = spawnSync(command, args)

    const reservations = [first, second].map((result) => result.stdout.toString().trim())
    expect(reservations[0]).not.toBe('')
    expect(reservations[1]).not.toBe('')
    expect(reservations[0]).not.toBe(reservations[1])
  })

  it('passes the proof channel through stdin', () => {
    const echoed = spawnSync(
      command,
      ['run', 'maintenance:abc', '4', process.execPath, '-e', 'process.stdin.pipe(process.stdout)'],
      {
        input: '{"id":1}\n',
      },
    )

    expect(echoed.stdout.toString()).toBe('{"id":1}\n')
  })

  it('refuses a run with no command', () => {
    expect(spawnSync(command, ['run', 'maintenance:abc', '4']).status).toBe(2)
  })
})

describe('single account Agent session admission', () => {
  const reservation = (key: string) => ({
    requestId: `request-${key}`,
    fingerprint: `fingerprint-${key}`,
    key,
    role: 'interactive' as const,
    memoryGiB: 1,
    unit: `unit-${key}`,
    admission: 'Regular' as const,
  })
  /** A stand-in session helper: it binds through the command, as the real helper does, then waits. */
  function helper(key: string, reservationId: string) {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:child_process').execFile(${JSON.stringify(command)}, ['bind', process.argv[1]], (error, stdout) => { process.stdout.write(stdout); setInterval(() => {}, 1000) })`,
        JSON.stringify({ key, reservationId, unit: `unit-${key}`, invocationId: 'invocation' }),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const bound = new Promise<unknown>((resolve) =>
      child.stdout.once('data', (data) => resolve(JSON.parse(String(data)))),
    )
    return { child, bound }
  }

  it('reports capacity the dashboard accepts, limited by the slot policy', async () => {
    const admission = createTerminalAdmissionCli(command)
    await setHostSlotPolicy(command, 2)

    const capacity = await admission.capacity()
    expect(parseHostTerminalCapacity(capacity)).toMatchObject({
      _tag: 'Ok',
      value: { _tag: 'Available', agentSlots: 2 },
    })

    expect(await admission.reserve(reservation('terminal:a'))).toMatchObject({
      _tag: 'Admitted',
      disposition: 'Created',
    })
    expect(await admission.reserve(reservation('terminal:b'))).toMatchObject({ _tag: 'Admitted' })
    expect(await admission.reserve(reservation('terminal:c'))).toEqual({ _tag: 'AtCapacity', reason: 'Slots' })
    expect(await admission.capacity()).toMatchObject({ agentSlotsUsed: 2, regular: { _tag: 'AtCapacity' } })
  })

  it('replays the same request and refuses a different one for the same session', async () => {
    const admission = createTerminalAdmissionCli(command)
    await setHostSlotPolicy(command, 2)
    const first = await admission.reserve(reservation('terminal:a'))

    expect(await admission.reserve(reservation('terminal:a'))).toMatchObject({
      _tag: 'Admitted',
      disposition: 'Existing',
      reservationId: first._tag === 'Admitted' ? first.reservationId : '',
    })
    expect(await admission.reserve({ ...reservation('terminal:a'), requestId: 'other' })).toEqual({ _tag: 'Conflict' })
  })

  it('follows a bound helper until it exits, then releases its slot', async () => {
    const admission = createTerminalAdmissionCli(command)
    await setHostSlotPolicy(command, 1)
    const admitted = await admission.reserve(reservation('terminal:a'))
    if (admitted._tag !== 'Admitted') throw new Error('The session was not admitted.')
    const { child, bound } = helper('terminal:a', admitted.reservationId)
    // The helper that called `bind` owns the reservation, named by its PID and start time.
    expect(await bound).toMatchObject({
      _tag: 'Bound',
      scope: { controlGroup: expect.stringMatching(new RegExp(`^process:${child.pid}:\\d+$`)) },
    })
    expect(await admission.reconcile('terminal:a')).toMatchObject({ _tag: 'Alive' })
    expect(await admission.release('terminal:a')).toMatchObject({ _tag: 'Unknown' })

    await new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill('SIGKILL')
    })
    expect(await admission.reconcile('terminal:a')).toEqual({ _tag: 'Empty' })
    expect(await admission.capacity()).toMatchObject({ agentSlotsUsed: 0, regular: { _tag: 'Allowed' } })
    expect(await admission.release('terminal:a')).toEqual({ _tag: 'Empty' })
    expect(await admission.reconcile('terminal:a')).toEqual({ _tag: 'Missing' })
    expect(
      await admission.completedReceipt({
        requestId: 'request-terminal:a',
        fingerprint: 'fingerprint-terminal:a',
        key: 'terminal:a',
        reservationId: admitted.reservationId,
        unit: 'unit-terminal:a',
      }),
    ).toEqual({ _tag: 'Completed' })
  })

  it('cancels a reservation no helper bound, and refuses another reservation id', async () => {
    const admission = createTerminalAdmissionCli(command)
    await setHostSlotPolicy(command, 1)
    const admitted = await admission.reserve(reservation('terminal:a'))
    if (admitted._tag !== 'Admitted') throw new Error('The session was not admitted.')

    expect(await admission.cancel({ key: 'terminal:a', reservationId: 'other' })).toEqual({ _tag: 'Conflict' })
    expect(await admission.cancel({ key: 'terminal:a', reservationId: admitted.reservationId })).toEqual({
      _tag: 'Empty',
    })
    expect(await admission.reconcile('terminal:a')).toEqual({ _tag: 'Missing' })
  })

  it('has no manual override', async () => {
    const admission = createTerminalAdmissionCli(command)
    await setHostSlotPolicy(command, 1)

    expect(await admission.reserve({ ...reservation('terminal:a'), admission: 'ManualOverride' })).toMatchObject({
      _tag: 'Unavailable',
    })
  })
})
