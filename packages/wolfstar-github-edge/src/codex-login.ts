import type { SetupDependencies } from './setup.ts'
import { USER_AGENT } from './settings.ts'

/**
 * Codex sign in with a one-time code, the flow `codex login --device-auth` runs.
 *
 * The Worker asks OpenAI for a code, the person enters it on OpenAI's page,
 * and the Worker trades the approval for tokens. The result is the same
 * `auth.json` the CLI writes, so the controller cannot tell the two apart and
 * nobody has to copy a file off their computer.
 *
 * Keep in step with `codex-rs/login/src/device_code_auth.rs` in openai/codex.
 */

export const CODEX_ISSUER = 'https://auth.openai.com'
/** The public OAuth client the Codex CLI signs in as. */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
/** OpenAI expires a code after fifteen minutes. */
export const CODEX_CODE_SECONDS = 15 * 60

export interface CodexDeviceCode {
  deviceAuthId: string
  userCode: string
  verificationUrl: string
  /** Seconds between polls, as OpenAI asks. */
  interval: number
  expiresAt: number
}

export type CodexCodeOutcome = { _tag: 'Issued'; code: CodexDeviceCode } | { _tag: 'Failed'; message: string }

export type CodexPollOutcome =
  | { _tag: 'Pending' }
  | { _tag: 'SignedIn'; auth: string }
  | { _tag: 'Failed'; message: string }

const API = `${CODEX_ISSUER}/api/accounts`

function post(dependencies: Pick<SetupDependencies, 'fetch'>, url: string, body: unknown): Promise<Response | null> {
  return dependencies
    .fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify(body),
    })
    .catch(() => null)
}

export async function requestCodexCode(
  dependencies: Pick<SetupDependencies, 'fetch' | 'now'>,
): Promise<CodexCodeOutcome> {
  const response = await post(dependencies, `${API}/deviceauth/usercode`, { client_id: CODEX_CLIENT_ID })
  if (response?.status === 404)
    return { _tag: 'Failed', message: 'OpenAI does not offer code sign in right now. Paste auth.json instead.' }
  if (!response?.ok) return { _tag: 'Failed', message: 'OpenAI did not issue a sign in code. Try again.' }
  const body = (await response.json().catch(() => null)) as {
    device_auth_id?: unknown
    user_code?: unknown
    usercode?: unknown
    interval?: unknown
  } | null
  const userCode = body?.user_code ?? body?.usercode
  if (typeof body?.device_auth_id !== 'string' || typeof userCode !== 'string')
    return { _tag: 'Failed', message: 'OpenAI answered with something other than a sign in code.' }
  const interval = Number.parseInt(String(body.interval ?? ''), 10)
  return {
    _tag: 'Issued',
    code: {
      deviceAuthId: body.device_auth_id,
      userCode,
      verificationUrl: `${CODEX_ISSUER}/codex/device`,
      interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
      expiresAt: dependencies.now() + CODEX_CODE_SECONDS * 1000,
    },
  }
}

/** The claims Codex reads from the ID token, as `jwt_auth_claims` does. */
function chatgptAccountId(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1] ?? ''
    const json = atob(
      payload
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '='),
    )
    const claims = JSON.parse(json) as { 'https://api.openai.com/auth'?: { chatgpt_account_id?: unknown } }
    const id = claims['https://api.openai.com/auth']?.chatgpt_account_id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/**
 * Asks once whether the person approved the code.
 *
 * OpenAI answers 403 or 404 until they do. The browser asks again on the
 * interval, so the Worker never holds a request open.
 */
export async function pollCodexCode(
  dependencies: Pick<SetupDependencies, 'fetch' | 'now'>,
  code: { deviceAuthId: string; userCode: string },
): Promise<CodexPollOutcome> {
  const response = await post(dependencies, `${API}/deviceauth/token`, {
    device_auth_id: code.deviceAuthId,
    user_code: code.userCode,
  })
  if (response === null) return { _tag: 'Failed', message: 'OpenAI could not be reached. Try again.' }
  if (response.status === 403 || response.status === 404) return { _tag: 'Pending' }
  if (!response.ok) return { _tag: 'Failed', message: 'OpenAI refused the sign in. Start again with a new code.' }
  const grant = (await response.json().catch(() => null)) as {
    authorization_code?: unknown
    code_verifier?: unknown
  } | null
  if (typeof grant?.authorization_code !== 'string' || typeof grant.code_verifier !== 'string')
    return { _tag: 'Failed', message: 'OpenAI answered without an authorization code.' }

  const exchange = await dependencies
    .fetch(`${CODEX_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: grant.authorization_code,
        redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
        client_id: CODEX_CLIENT_ID,
        code_verifier: grant.code_verifier,
      }),
    })
    .catch(() => null)
  // The code is single use, so a failed exchange is never retried with it.
  if (!exchange?.ok) return { _tag: 'Failed', message: 'OpenAI did not exchange the code for a login. Start again.' }
  const tokens = (await exchange.json().catch(() => null)) as {
    id_token?: unknown
    access_token?: unknown
    refresh_token?: unknown
  } | null
  if (
    typeof tokens?.id_token !== 'string' ||
    typeof tokens.access_token !== 'string' ||
    typeof tokens.refresh_token !== 'string'
  )
    return { _tag: 'Failed', message: 'OpenAI returned an incomplete login.' }

  const auth = {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: chatgptAccountId(tokens.id_token),
    },
    last_refresh: new Date(dependencies.now()).toISOString(),
  }
  return { _tag: 'SignedIn', auth: JSON.stringify(auth, null, 2) }
}

/** Reads the poll body the dashboard sends back. */
export function parseCodexPoll(body: unknown): { deviceAuthId: string; userCode: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const { deviceAuthId, userCode } = body as Record<string, unknown>
  if (typeof deviceAuthId !== 'string' || typeof userCode !== 'string') return null
  if (deviceAuthId.length === 0 || deviceAuthId.length > 512 || userCode.length === 0 || userCode.length > 64)
    return null
  return { deviceAuthId, userCode }
}
