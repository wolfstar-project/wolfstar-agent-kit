// Routes `pnpm sync:context` and `pnpm check:context` to the script for this
// platform. pnpm runs package scripts through cmd on Windows, which has no
// bash, so Windows gets the PowerShell installer and every other platform keeps
// the bash scripts unchanged.
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ContextAction = 'sync' | 'check'

export interface PlatformCommand {
  command: string
  args: string[]
}

export function platformCommand(
  platform: NodeJS.Platform,
  action: ContextAction,
  mode: string,
  rest: string[],
  scripts: string,
): PlatformCommand | { error: string } {
  if (platform === 'win32') {
    if (action === 'sync' && mode !== 'local')
      return { error: 'Hogwild sync needs ssh and bash. Run it from Linux or WSL.' }
    return {
      command: 'pwsh',
      args: [
        '-NoProfile',
        '-File',
        join(scripts, 'sync-agent-context.ps1'),
        '-Mode',
        action === 'check' ? 'check' : 'local',
        ...rest,
      ],
    }
  }
  if (action === 'check') return { command: 'bash', args: [join(scripts, 'check-agent-context.sh'), ...rest] }
  return { command: 'bash', args: [join(scripts, 'sync-agent-context.sh'), mode, ...rest] }
}

function main(argv: string[]): number {
  // pnpm forwards the `--` that separates its own options from the script's.
  const [action, mode = 'local', ...rest] = argv.filter((arg, index) => !(index === 2 && arg === '--'))
  if (action !== 'sync' && action !== 'check') {
    process.stderr.write('Use sync or check.\n')
    return 1
  }
  const planned = platformCommand(process.platform, action, mode, rest, dirname(fileURLToPath(import.meta.url)))
  if ('error' in planned) {
    process.stderr.write(`${planned.error}\n`)
    return 1
  }
  const result = spawnSync(planned.command, planned.args, { stdio: 'inherit' })
  if (result.error) {
    const hint = planned.command === 'pwsh' ? ' Install PowerShell 7: winget install --id Microsoft.PowerShell' : ''
    process.stderr.write(`Could not start ${planned.command}: ${result.error.message}.${hint}\n`)
    return 1
  }
  return result.status ?? 1
}

const self = fileURLToPath(import.meta.url)
const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
const direct = process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self
if (direct) process.exitCode = main(process.argv.slice(2))
