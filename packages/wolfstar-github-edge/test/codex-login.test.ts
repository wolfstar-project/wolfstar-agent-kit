import { describe, expect, it } from 'vitest'
import { handleRequest } from '../src/app.ts'
import { CODEX_CLIENT_ID } from '../src/codex-login.ts'
import { DASHBOARD_PASSWORD, ORIGIN, READY_SETUP, createTestEdge } from './fixtures.ts'

const BASIC = `Basic ${btoa(`agent:${DASHBOARD_PASSWORD}`)}`
const ACCOUNT = 'chatgpt-account-1'

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: BASIC, ...headers },
    body: JSON.stringify(body),
  })
}

function jwt(claims: unknown): string {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-')
  return `${part({ alg: 'none' })}.${part(claims)}.signature`
}

const ID_TOKEN = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT } })

interface OpenAiCall {
  url: string
  body: string
}

/** OpenAI's device code endpoints, approved after `pendingPolls` polls. */
function openAi(options: { pendingPolls?: number; usercode?: number; token?: number } = {}) {
  const calls: OpenAiCall[] = []
  let polls = 0
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : String(init?.body ?? '')
    calls.push({ url, body })
    if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode')
      return options.usercode === undefined
        ? Response.json({ device_auth_id: 'device-1', user_code: 'ABCD-1234', interval: '5' })
        : new Response(null, { status: options.usercode })
    if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
      polls += 1
      if (polls <= (options.pendingPolls ?? 0)) return new Response(null, { status: 403 })
      return Response.json({ authorization_code: 'auth-code', code_challenge: 'challenge', code_verifier: 'verifier' })
    }
    if (url === 'https://auth.openai.com/oauth/token')
      return options.token === undefined
        ? Response.json({ id_token: ID_TOKEN, access_token: 'access', refresh_token: 'refresh' })
        : new Response(null, { status: options.token })
    return new Response(null, { status: 404 })
  }
  return { calls, fetch }
}

describe('codex sign in code', () => {
  it('issues the code OpenAI gives the Codex CLI', async () => {
    const openai = openAi()
    const edge = createTestEdge({ setup: READY_SETUP, github: openai.fetch, now: 1_000 })

    const response = await handleRequest(post('/setup/api/codex/code'), edge.dependencies)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      deviceAuthId: 'device-1',
      userCode: 'ABCD-1234',
      verificationUrl: 'https://auth.openai.com/codex/device',
      interval: 5,
      expiresAt: 1_000 + 15 * 60 * 1000,
    })
    expect(JSON.parse(openai.calls[0]!.body)).toEqual({ client_id: CODEX_CLIENT_ID })
  })

  it('is closed to a request the controller does not know, or another site', async () => {
    const edge = createTestEdge({ setup: READY_SETUP, github: openAi().fetch })

    const stranger = await handleRequest(
      post('/setup/api/codex/code', {}, { authorization: 'Basic YWdlbnQ6d3Jvbmc=' }),
      edge.dependencies,
    )
    const elsewhere = await handleRequest(
      post('/setup/api/codex/code', {}, { origin: 'https://evil.example' }),
      edge.dependencies,
    )

    expect(stranger.status).toBe(401)
    expect(elsewhere.status).toBe(403)
  })

  it('says so when OpenAI does not offer code sign in', async () => {
    const edge = createTestEdge({ setup: READY_SETUP, github: openAi({ usercode: 404 }).fetch })

    const response = await handleRequest(post('/setup/api/codex/code'), edge.dependencies)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: expect.stringContaining('Paste auth.json instead') })
  })
})

describe('codex sign in token', () => {
  const code = { deviceAuthId: 'device-1', userCode: 'ABCD-1234' }

  it('waits until the person approves the code, and saves nothing meanwhile', async () => {
    const edge = createTestEdge({ setup: READY_SETUP, github: openAi({ pendingPolls: 1 }).fetch })

    const response = await handleRequest(post('/setup/api/codex/token', code), edge.dependencies)

    expect(response.status).toBe(202)
    expect(edge.setup().providers.codexAuth).toBeNull()
    expect(edge.restarts).toEqual([])
  })

  it('saves the same auth.json the CLI writes, and restarts on the new login', async () => {
    const openai = openAi()
    const edge = createTestEdge({ setup: READY_SETUP, github: openai.fetch, now: Date.UTC(2026, 9, 18) })

    const response = await handleRequest(post('/setup/api/codex/token', code), edge.dependencies)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ providers: { codex: { configured: true } }, restarting: true })
    expect(JSON.parse(edge.setup().providers.codexAuth!)).toEqual({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: { id_token: ID_TOKEN, access_token: 'access', refresh_token: 'refresh', account_id: ACCOUNT },
      last_refresh: '2026-10-18T00:00:00.000Z',
    })
    expect(edge.restarts).toEqual([{ forgetCodexLogin: true }])
    expect(JSON.parse(openai.calls[0]!.body)).toEqual({ device_auth_id: 'device-1', user_code: 'ABCD-1234' })
    expect(Object.fromEntries(new URLSearchParams(openai.calls[1]!.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      client_id: CODEX_CLIENT_ID,
      code_verifier: 'verifier',
    })
  })

  it('keeps the saved login when the exchange fails', async () => {
    const edge = createTestEdge({ setup: READY_SETUP, github: openAi({ token: 400 }).fetch })

    const response = await handleRequest(post('/setup/api/codex/token', code), edge.dependencies)

    expect(response.status).toBe(502)
    expect(edge.setup().providers.codexAuth).toBeNull()
    expect(edge.restarts).toEqual([])
  })

  it('refuses a poll without the issued code', async () => {
    const edge = createTestEdge({ setup: READY_SETUP, github: openAi().fetch })

    const response = await handleRequest(
      post('/setup/api/codex/token', { deviceAuthId: 'device-1' }),
      edge.dependencies,
    )

    expect(response.status).toBe(400)
  })
})
