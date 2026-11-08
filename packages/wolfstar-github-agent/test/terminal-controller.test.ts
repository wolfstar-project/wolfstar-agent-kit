import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { controllerTerminalPaths, terminalDashboardAccess } from '../src/terminal-controller.ts'

function request(credentials: string, publicIngress = false) {
  return {
    headers: {
      authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
      ...(publicIngress ? { 'x-wolfstar-agent-ingress': 'public' } : {}),
    },
  } as IncomingMessage
}

describe('terminal controller authorization', () => {
  it('refuses malformed credentials that contain no separator', () => {
    expect(terminalDashboardAccess(request('agentx'), 'agentx')).toBe(false)
  })

  it('accepts the private Agent credentials and refuses public ingress', () => {
    expect(terminalDashboardAccess(request('agent:password'), 'password')).toBe(true)
    expect(terminalDashboardAccess(request('agent:password', true), 'password')).toBe(false)
    expect(terminalDashboardAccess(request('other:password'), 'password')).toBe(false)
    expect(terminalDashboardAccess(request('agent:incorrect'), 'password')).toBe(false)
  })
})

describe('controller terminal paths', () => {
  const root = '/srv/kit'
  const package_ = `${root}/packages/wolfstar-github-agent`
  const claim = `${root}/wolfstar-agent-kit/scripts/worktree-claim.sh`
  const staticDirectory = `${package_}/dashboard/.output/public`

  it('finds the helper, claim script, and dashboard from the source layout', () => {
    const files = new Set([`${package_}/src/terminal-helper.ts`, claim, staticDirectory])
    expect(controllerTerminalPaths(`file://${package_}/src/terminal-controller.ts`, (path) => files.has(path))).toEqual(
      {
        helperSource: `${package_}/src/terminal-helper.ts`,
        claimScript: claim,
        staticDirectory,
      },
    )
  })

  it('finds them from the bundled chunk, which sits one directory deeper', () => {
    const files = new Set([`${package_}/dist/terminal-helper.mjs`, claim, staticDirectory])
    expect(controllerTerminalPaths(`file://${package_}/dist/_chunks/service.mjs`, (path) => files.has(path))).toEqual({
      helperSource: `${package_}/dist/terminal-helper.mjs`,
      claimScript: claim,
      staticDirectory,
    })
  })

  it('names the first candidate when nothing exists, so the failure shows the expected path', () => {
    expect(controllerTerminalPaths(`file://${package_}/dist/_chunks/service.mjs`, () => false)).toEqual({
      helperSource: `${package_}/dist/_chunks/terminal-helper.mjs`,
      claimScript: `${root}/packages/wolfstar-agent-kit/scripts/worktree-claim.sh`,
      staticDirectory: `${package_}/dist/dashboard/.output/public`,
    })
  })
})
