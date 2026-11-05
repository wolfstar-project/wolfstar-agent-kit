import type { Env, WebhookDelivery } from './env.ts'
import { accessSettings } from './access.ts'
import { handleQueue, handleRequest } from './app.ts'
import { controllerOrigin } from './dashboard.ts'

export type { Env, WebhookDelivery } from './env.ts'

function dependencies(env: Env) {
  return {
    controllerUrl: controllerOrigin(env.CONTROLLER_URL),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    webhooks: env.WEBHOOKS,
    state: env.STATE,
    // Half a configuration throws, so a mistake fails closed instead of leaving the dashboard open.
    access: accessSettings(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
    now: Date.now,
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, dependencies(env))
  },

  async queue(batch, env): Promise<void> {
    await handleQueue(batch, dependencies(env))
  },
} satisfies ExportedHandler<Env, WebhookDelivery>
