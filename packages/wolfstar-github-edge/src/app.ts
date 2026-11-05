import type { AccessSettings } from './access.ts'
import type { WebhookDelivery } from './env.ts'
import { hasAccessToken } from './access.ts'
import { proxyDashboard } from './dashboard.ts'
import { acceptWebhook, consumeWebhooks } from './webhook.ts'

/** Everything the routes need, so tests run them without Cloudflare bindings. */
export interface EdgeDependencies {
  /** The controller's origin. */
  controllerUrl: string
  /** The GitHub App's webhook secret. */
  webhookSecret: string | undefined
  webhooks: Queue<WebhookDelivery>
  state: R2Bucket
  /** Cloudflare Access in front of everything but `/webhook`. Null when Access is not set up. */
  access: AccessSettings | null
  fetch: typeof fetch
  now: () => number
}

function webhookDependencies(dependencies: EdgeDependencies) {
  return {
    secret: dependencies.webhookSecret,
    controllerUrl: dependencies.controllerUrl,
    fetch: dependencies.fetch,
    webhooks: dependencies.webhooks,
    bodies: dependencies.state,
  }
}

export async function handleRequest(request: Request, dependencies: EdgeDependencies): Promise<Response> {
  const url = new URL(request.url)
  if (url.protocol === 'http:') {
    url.protocol = 'https:'
    return Response.redirect(url.toString(), 308)
  }

  // Only this exact path reaches the webhook relay. `/webhook/` stays a dashboard route.
  if (url.pathname === '/webhook') {
    if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405 })
    return acceptWebhook(request, webhookDependencies(dependencies))
  }

  // Everything past here is for a person, so it needs the Access sign-in when Access is set up.
  if (dependencies.access !== null && !(await hasAccessToken(request, dependencies.access, dependencies)))
    return new Response('Sign in through Cloudflare Access.', { status: 403 })

  return proxyDashboard(request, dependencies)
}

export async function handleQueue(batch: MessageBatch<WebhookDelivery>, dependencies: EdgeDependencies): Promise<void> {
  await consumeWebhooks(batch, webhookDependencies(dependencies))
}
