import type { EdgeDependencies } from '../src/app.ts'
import type { WebhookDelivery } from '../src/env.ts'

export const ORIGIN = 'https://agent.example.com'
export const CONTROLLER_URL = 'https://controller.example.com'
export const WEBHOOK_SECRET = 'a-webhook-secret-of-at-least-32-characters'

export async function sign(body: string, secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `sha256=${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** One request that reached the controller. */
export interface ControllerCall {
  url: string
  method: string
  headers: Headers
  body: string
}

export interface TestEdge {
  dependencies: EdgeDependencies
  sent: WebhookDelivery[]
  objects: Map<string, string>
  /** Everything the Worker sent to the controller, webhooks and dashboard requests alike. */
  controller: ControllerCall[]
}

export function createTestEdge(
  options: {
    secret?: string | undefined
    /** Answers a webhook relay. A throw stands for an unreachable controller. */
    relay?: (call: ControllerCall) => Promise<number>
    /** Answers any other URL, such as the Access key set. */
    external?: (url: string) => Promise<Response>
    now?: number
  } = {},
): TestEdge {
  const sent: WebhookDelivery[] = []
  const objects = new Map<string, string>()
  const controller: ControllerCall[] = []

  const dependencies = {
    controllerUrl: CONTROLLER_URL,
    webhookSecret: 'secret' in options ? options.secret : WEBHOOK_SECRET,
    webhooks: {
      send: async (message: WebhookDelivery) => {
        sent.push(message)
      },
    },
    state: {
      put: async (key: string, value: string) => {
        objects.set(key, value)
      },
      get: async (key: string) => {
        const value = objects.get(key)
        return value === undefined ? null : { text: async () => value }
      },
      delete: async (key: string) => {
        objects.delete(key)
      },
    },
    access: null,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (!request.url.startsWith(CONTROLLER_URL)) {
        if (options.external === undefined) throw new Error(`Unexpected fetch: ${request.url}`)
        return options.external(request.url)
      }
      const call = {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: await request.text(),
      }
      controller.push(call)
      if (new URL(request.url).pathname !== '/webhook') return new Response('dashboard')
      return new Response(null, { status: options.relay === undefined ? 204 : await options.relay(call) })
    },
    now: () => options.now ?? Date.parse('2026-10-14T12:00:00.000Z'),
  } as unknown as EdgeDependencies

  return { dependencies, sent, objects, controller }
}
