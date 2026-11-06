import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { platformCommand } from './agent-context-platform.ts'

const scripts = '/repo/scripts'

describe('context sync platform routing', () => {
  it.each(['linux', 'darwin'] as const)('keeps the bash sync and check on %s', (platform) => {
    expect(platformCommand(platform, 'sync', 'local', [], scripts)).toEqual({
      command: 'bash',
      args: [join(scripts, 'sync-agent-context.sh'), 'local'],
    })
    expect(platformCommand(platform, 'check', 'local', [], scripts)).toEqual({
      command: 'bash',
      args: [join(scripts, 'check-agent-context.sh')],
    })
  })

  it('installs the PowerShell agent-gh on Windows', () => {
    expect(platformCommand('win32', 'sync', 'local', ['-AddToPath'], scripts)).toEqual({
      command: 'pwsh',
      args: ['-NoProfile', '-File', join(scripts, 'sync-agent-context.ps1'), '-Mode', 'local', '-AddToPath'],
    })
    expect(platformCommand('win32', 'check', 'local', [], scripts)).toEqual({
      command: 'pwsh',
      args: ['-NoProfile', '-File', join(scripts, 'sync-agent-context.ps1'), '-Mode', 'check'],
    })
  })

  it('keeps Hogwild sync off Windows', () => {
    expect(platformCommand('win32', 'sync', 'hogwild', [], scripts)).toHaveProperty('error')
  })
})
