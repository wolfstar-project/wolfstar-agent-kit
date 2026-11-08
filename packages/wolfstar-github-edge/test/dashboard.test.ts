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
      new Request(`${ORIGIN}/api/state`, { headers: { authorization: 'Basic YWdlbnQ6eA==' } }),
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

describe('dashboard shell', () => {
  it('serves a page from its own build without asking the controller', async () => {
    const edge = createTestEdge()

    const response = await handleRequest(new Request(`${ORIGIN}/sessions`), edge.dependencies)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<script nonce="')
    expect(edge.controller).toHaveLength(0)
  })

  it('gives each page a fresh nonce that its Content-Security-Policy names', async () => {
    const edge = createTestEdge()

    const first = await handleRequest(new Request(`${ORIGIN}/`), edge.dependencies)
    const second = await handleRequest(new Request(`${ORIGIN}/`), edge.dependencies)
    const html = await first.text()
    const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1]

    expect(nonce).toBeDefined()
    expect(html).toContain(`<style nonce="${nonce}"`)
    expect(first.headers.get('content-security-policy')).toContain(`script-src 'self' 'nonce-${nonce}'`)
    expect(first.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(second.headers.get('content-security-policy')).not.toBe(first.headers.get('content-security-policy'))
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.headers.get('etag')).toBeNull()
  })

  it('serves a build file with a cache the shared caches cannot keep', async () => {
    const edge = createTestEdge()

    const response = await handleRequest(new Request(`${ORIGIN}/_nuxt/a.js`), edge.dependencies)

    expect(await response.text()).toBe('console.log(1)')
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(response.headers.get('content-security-policy')).toBeNull()
  })

  it('never serves the controller routes from its build', async () => {
    const edge = createTestEdge()

    for (const path of ['/api/state', '/health']) {
      const response = await handleRequest(new Request(`${ORIGIN}${path}`), edge.dependencies)
      expect(await response.text()).toBe('dashboard')
    }
    expect(edge.shell).toHaveLength(0)
    expect(edge.controller).toHaveLength(2)
  })

  it('sends a path its build does not hold to the controller', async () => {
    const edge = createTestEdge()

    await handleRequest(new Request(`${ORIGIN}/favicon.ico`), edge.dependencies)

    expect(edge.shell).toEqual(['/favicon.ico'])
    expect(edge.controller[0]?.url).toBe(`${CONTROLLER_URL}/favicon.ico`)
  })

  it('leaves a write to the controller, whatever the path', async () => {
    const edge = createTestEdge()

    await handleRequest(
      new Request(`${ORIGIN}/sessions`, { method: 'POST', headers: { origin: ORIGIN } }),
      edge.dependencies,
    )

    expect(edge.shell).toHaveLength(0)
    expect(edge.controller[0]).toMatchObject({ method: 'POST' })
  })

  it('answers a HEAD request without a body', async () => {
    const edge = createTestEdge()

    const response = await handleRequest(new Request(`${ORIGIN}/`, { method: 'HEAD' }), edge.dependencies)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
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
