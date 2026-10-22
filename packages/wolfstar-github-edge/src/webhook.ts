import type { WebhookDelivery } from './env.ts'
import { verifyWebhookSignature } from './signature.ts'

/** GitHub caps a delivery at 25 MB. The Caddy route used the same limit. */
export const MAXIMUM_BODY_BYTES = 25 * 1024 * 1024

/** A Queue message holds 128 KB. Leave room for the envelope and move larger bodies to R2. */
export const MAXIMUM_INLINE_BYTES = 100 * 1024

const MAXIMUM_RETRY_DELAY_SECONDS = 15 * 60

/**
 * Accepts one GitHub delivery and queues it for the controller.
 *
 * The Worker checks the signature so an unsigned request never costs a Queue
 * write, and answers GitHub before the controller sees anything. A controller
 * that is restarting or offline no longer loses the delivery, because the
 * Queue retries it. GitHub itself never redelivers a failed one.
 *
 * Duplicate suppression stays in the controller, which already keeps an hour
 * of delivery identities. The Queue delivers at least once, so it relies on that.
 */
export interface WebhookDependencies {
  /** The GitHub App's webhook secret. Undefined until it is set, and every delivery is refused then. */
  secret: string | undefined
  /** The controller's origin. */
  controllerUrl: string
  fetch: typeof fetch
  webhooks: Queue<WebhookDelivery>
  bodies: R2Bucket
}

export async function acceptWebhook(request: Request, dependencies: WebhookDependencies): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > MAXIMUM_BODY_BYTES) return new Response('Body is too large.', { status: 413 })

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAXIMUM_BODY_BYTES) return new Response('Body is too large.', { status: 413 })

  // Without the secret there is nothing to verify against.
  const secret = dependencies.secret
  if (secret === undefined || secret === '') return new Response('The webhook secret is not set.', { status: 503 })

  const signature = request.headers.get('x-hub-signature-256')
  if (signature === null || !(await verifyWebhookSignature(secret, bytes, signature))) {
    // Never say which part failed. A precise answer is a probing oracle.
    return new Response('Signature mismatch.', { status: 401 })
  }

  // GitHub sends a GUID. The narrow shape also makes it safe as an R2 key.
  const delivery = request.headers.get('x-github-delivery')
  if (delivery === null || !/^[\w-]{1,128}$/.test(delivery))
    return new Response('Delivery identity is missing or invalid.', { status: 400 })

  const event = request.headers.get('x-github-event') ?? ''
  const text = new TextDecoder().decode(bytes)
  let body: WebhookDelivery['body']
  if (bytes.byteLength <= MAXIMUM_INLINE_BYTES) {
    body = { _tag: 'Inline', text }
  } else {
    const key = `deliveries/${delivery}`
    await dependencies.bodies.put(key, text)
    body = { _tag: 'Stored', key }
  }

  await dependencies.webhooks.send({ delivery, event, signature, body })
  return new Response(null, { status: 204 })
}

export type RelayOutcome = { _tag: 'Delivered' } | { _tag: 'Rejected'; status: number } | { _tag: 'Retry' }

/**
 * Forwards one queued delivery to the controller's webhook listener.
 *
 * The controller verifies the original signature again, so the Worker adds no
 * trust of its own. A 4xx answer will not change on retry, apart from 408 and
 * 429, so it is dropped and logged. Polling still reads that repository.
 */
export async function relayDelivery(
  message: WebhookDelivery,
  dependencies: WebhookDependencies,
): Promise<RelayOutcome> {
  let text: string
  if (message.body._tag === 'Inline') {
    text = message.body.text
  } else {
    const object = await dependencies.bodies.get(message.body.key)
    if (object === null) return { _tag: 'Rejected', status: 410 }
    text = await object.text()
  }

  let status: number
  try {
    const response = await dependencies.fetch(`${dependencies.controllerUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-delivery': message.delivery,
        'x-github-event': message.event,
        'x-hub-signature-256': message.signature,
      },
      body: text,
    })
    await response.body?.cancel()
    status = response.status
  } catch {
    // The controller is restarting or unreachable.
    return { _tag: 'Retry' }
  }

  if (status >= 200 && status < 300) return { _tag: 'Delivered' }
  if (status >= 500 || status === 408 || status === 429) return { _tag: 'Retry' }
  return { _tag: 'Rejected', status }
}

/** Exponential backoff from 10 seconds, capped at 15 minutes. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(MAXIMUM_RETRY_DELAY_SECONDS, 5 * 2 ** Math.max(1, attempts))
}

export async function consumeWebhooks(
  batch: MessageBatch<WebhookDelivery>,
  dependencies: WebhookDependencies,
): Promise<void> {
  for (const message of batch.messages) {
    const outcome = await relayDelivery(message.body, dependencies)
    if (outcome._tag === 'Retry') {
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
      continue
    }
    if (outcome._tag === 'Rejected')
      console.error(`Webhook ${message.body.delivery} (${message.body.event}) was rejected with ${outcome.status}.`)
    if (message.body.body._tag === 'Stored') await dependencies.bodies.delete(message.body.body.key)
    message.ack()
  }
}
