import { describe, expect, it } from 'vitest'
import { proxyConfiguration } from '../src/configuration.ts'

function harness(status = 200) {
  const writes: unknown[] = []
  const values = { server: { port: 3210 }, auto_merge: { enabled: false } }
  const dependencies = {
    proxy: async (request: Request) =>
      request.method === 'GET'
        ? Response.json({ revision: 'before', values })
        : Response.json(
            { revision: 'after', values: ((await request.json()) as { values: unknown }).values },
            { status },
          ),
    persist: async (saved: Record<string, unknown>) => {
      writes.push(saved)
    },
  }
  const request = (next = values) =>
    new Request('https://controller/api/configuration', {
      method: 'POST',
      body: JSON.stringify({ revision: 'before', values: next }),
    })
  return { dependencies, writes, values, request }
}
describe('durable dashboard configuration', () => {
  it('labels deployment-owned values and persists no reads', async () => {
    const h = harness()
    const result = await proxyConfiguration(new Request('https://controller/api/configuration'), h.dependencies)
    expect(await result.json()).toMatchObject({
      revision: 'before',
      managedPaths: expect.arrayContaining(['$.server.port']),
    })
    expect(h.writes).toEqual([])
  })
  it('persists the validated response before acknowledging success', async () => {
    const h = harness()
    const result = await proxyConfiguration(h.request({ ...h.values, auto_merge: { enabled: true } }), h.dependencies)
    expect(result.status).toBe(200)
    expect(h.writes).toEqual([{ ...h.values, auto_merge: { enabled: true } }])
  })
  it('refuses transport changes and never persists invalid or conflicting saves', async () => {
    const h = harness()
    const result = await proxyConfiguration(h.request({ ...h.values, server: { port: 80 } }), h.dependencies)
    expect(result.status).toBe(422)
    expect(h.writes).toEqual([])
    for (const status of [422, 409, 401]) {
      const failed = harness(status)
      expect((await proxyConfiguration(failed.request(), failed.dependencies)).status).toBe(status)
      expect(failed.writes).toEqual([])
    }
  })
  it('does not acknowledge success when durable storage fails', async () => {
    const h = harness()
    await expect(
      proxyConfiguration(h.request(), {
        ...h.dependencies,
        persist: async () => {
          throw new Error('storage unavailable')
        },
      }),
    ).rejects.toThrow('storage unavailable')
  })
  it('keeps the deployment GitHub owner boundary consistent with provisioning and webhooks', async () => {
    const writes: unknown[] = []
    const values = { github: { allowed_owners: ['alice'] } }
    const request = new Request('https://controller/api/configuration', {
      method: 'POST',
      body: JSON.stringify({ values: { github: { allowed_owners: ['bob'] } } }),
    })
    const result = await proxyConfiguration(request, {
      proxy: async () => Response.json({ values }),
      persist: async (value) => {
        writes.push(value)
      },
    })
    expect(result.status).toBe(422)
    expect(writes).toEqual([])
  })
})
