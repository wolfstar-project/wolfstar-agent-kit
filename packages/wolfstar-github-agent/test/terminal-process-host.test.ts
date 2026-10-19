import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { createTerminalProcessHost, processControlGroup, processStartTime } from '../src/terminal-process-host.ts'

const unit = 'wolfstar-terminal-000000000000000000000000.service'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'terminal-process-host-'))
  roots.push(root)
  const digest = createHash('sha256').update(source).digest('hex')
  const directory = join(root, digest)
  await mkdir(directory)
  const entry = join(directory, 'helper.ts')
  const wasm = join(directory, 'engine.wasm')
  const claimScript = join(directory, 'worktree-claim.sh')
  await writeFile(entry, source)
  await writeFile(wasm, 'fixture-engine')
  await writeFile(claimScript, 'fixture-claim')
  const artifact = {
    entry,
    digest,
    wasm,
    wasmDigest: createHash('sha256').update('fixture-engine').digest('hex'),
    claimScript,
    claimDigest: createHash('sha256').update('fixture-claim').digest('hex'),
  }
  return { root, artifact, host: createTerminalProcessHost(process.execPath, join(root, 'units')) }
}

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 50 && !(await check()); attempt++) await setTimeout(100)
}

it('starts a helper as a detached process with its reservation, and stops its whole group', async () => {
  const { root, artifact, host } = await fixture(
    `require('node:fs').writeFileSync(process.argv[2], process.env.WOLFSTAR_HOST_RESERVATION); setInterval(() => {}, 1000)`,
  )
  const config = join(root, 'reservation.txt')

  expect(await host.inspect(unit)).toMatchObject({ loadState: 'not-found', mainPid: 0 })
  await host.start({ unit, artifact, config, reservationId: 'fixture-reservation', memoryGiB: 1 })
  await until(async () => (await readFile(config, 'utf8').catch(() => '')) !== '')

  const running = await host.inspect(unit)
  expect(await readFile(config, 'utf8')).toBe('fixture-reservation')
  expect(running).toMatchObject({ loadState: 'loaded', activeState: 'active' })
  expect(running.controlGroup).toBe(processControlGroup(running.mainPid, (await processStartTime(running.mainPid))!))
  await expect(
    host.start({ unit, artifact, config, reservationId: 'fixture-reservation', memoryGiB: 1 }),
  ).rejects.toThrow('already running')

  expect(await host.stop(unit, 'another-invocation')).toBe('Unknown')
  expect(await host.stop(unit, running.invocationId)).toBe('Stopped')
  expect(await host.inspect(unit)).toMatchObject({ activeState: 'inactive', mainPid: 0 })
})

it('refuses a helper artifact that changed after it was built', async () => {
  const { root, artifact, host } = await fixture('process.exit(0)')
  await writeFile(artifact.claimScript, 'changed-claim')

  await expect(
    host.start({ unit, artifact, config: join(root, 'config.json'), reservationId: 'reservation', memoryGiB: 1 }),
  ).rejects.toThrow('Terminal artifact changed')
})

it('names one process by PID and start time, and none once it exited', async () => {
  expect(await processStartTime(process.pid)).toMatch(/^\d+$/)
  expect(await processStartTime(0)).toBeNull()
  expect(await processStartTime(2 ** 30)).toBeNull()
})
