import { describe, expect, it } from 'vitest'
import { handleRequest } from '../src/app.ts'
import { controllerOrigin } from '../src/dashboard.ts'
import { CONTROLLER_URL, ORIGIN, createTestEdge } from './fixtures.ts'

describe('dashboard proxy', () => {
  it('sends a read to the controller, keeping the path and query', async () => {
    const edge = createTestEdge()

    const response = await handleRequest(new Request(`${ORIGIN}/api/state?limit=5`), edge.dependencies)

    expect(await response.text()).toBe('dashboard')
    expect(edge.controller[0]).toMatchObject({ url: `${CONTROLLER_URL}/api/state?limit=5`, method: 'GET' })
  })

  it('translates the exact public Origin on a write and keeps the body', async () => {
    const edge = createTestEdge()

    await handleRequest(
      new Request(`${ORIGIN}/api/pause`, { method: 'POST', headers: { origin: ORIGIN }, body: '{"paused":true}' }),
      edge.dependencies,
    )

    expect(edge.controller[0]?.headers.get('origin')).toBe(CONTROLLER_URL)
    expect(edge.controller[0]?.body).toBe('{"paused":true}')
  })

  it('refuses a write with a missing or foreign Origin before the controller sees it', async () => {
    const edge = createTestEdge()

    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: CONTROLLER_URL }]) {
      const response = await handleRequest(
        new Request(`${ORIGIN}/api/pause`, { method: 'POST', headers }),
        edge.dependencies,
      )
      expect(response.status).toBe(403)
    }
    expect(edge.controller).toHaveLength(0)
  })

  it('passes the Authorization header through, because the controller checks the password', async () => {
    const edge = createTestEdge()

    await handleRequest(
      new Request(`${ORIGIN}/`, { headers: { authorization: 'Basic YWdlbnQ6eA==' } }),
      edge.dependencies,
    )

    expect(edge.controller[0]?.headers.get('authorization')).toBe('Basic YWdlbnQ6eA==')
  })

  it('sends a WebSocket upgrade to the controller, translating the Origin', async () => {
    const edge = createTestEdge()

    await handleRequest(
      new Request(`${ORIGIN}/api/terminal/sessions/a/stream`, {
        headers: { upgrade: 'websocket', origin: ORIGIN },
      }),
      edge.dependencies,
    )

    expect(edge.controller[0]).toMatchObject({ url: `${CONTROLLER_URL}/api/terminal/sessions/a/stream`, method: 'GET' })
    expect(edge.controller[0]?.headers.get('origin')).toBe(CONTROLLER_URL)
    expect(edge.controller[0]?.headers.get('upgrade')).toBe('websocket')
  })

  it('redirects plain HTTP to HTTPS', async () => {
    const edge = createTestEdge()

    const response = await handleRequest(new Request('http://agent.example.com/history?x=1'), edge.dependencies)

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://agent.example.com/history?x=1')
  })
})

describe('controller origin', () => {
  it('keeps only the origin of an https address', () => {
    expect(controllerOrigin('https://agent.example.com/some/path?x=1')).toBe('https://agent.example.com')
  })

  it('refuses a missing, malformed, or plain HTTP address', () => {
    expect(() => controllerOrigin(undefined)).toThrow('not a URL')
    expect(() => controllerOrigin('agent.example.com')).toThrow('not a URL')
    expect(() => controllerOrigin('http://agent.example.com')).toThrow('https')
  })
})
