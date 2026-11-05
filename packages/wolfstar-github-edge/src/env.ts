/** One signed GitHub delivery waiting for the controller. */
export interface WebhookDelivery {
  delivery: string
  event: string
  signature: string
  /** The body itself, or the R2 key that holds it when the body is too large for a Queue message. */
  body: { _tag: 'Inline'; text: string } | { _tag: 'Stored'; key: string }
}

export interface Env {
  /** The origin of the controller, such as `https://agent.example.com`. Webhooks and the dashboard go there. */
  CONTROLLER_URL: string
  /** The GitHub App's webhook secret, set with `wrangler secret put`. Without it every delivery gets a 503. */
  GITHUB_WEBHOOK_SECRET?: string
  /** `https://<team>.cloudflareaccess.com`. With ACCESS_AUD, every route but `/webhook` needs an Access sign-in. */
  ACCESS_TEAM_DOMAIN?: string
  /** The Application Audience (AUD) tag of the Access application. */
  ACCESS_AUD?: string
  WEBHOOKS: Queue<WebhookDelivery>
  /** Webhook bodies too large for a Queue message, under `deliveries/`. */
  STATE: R2Bucket
}
