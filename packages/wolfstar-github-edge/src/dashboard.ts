/** Checks that the controller address is a plain HTTPS origin, and returns it without a trailing path. */
export function controllerOrigin(value: string | undefined): string {
  let url: URL
  try {
    url = new URL(value ?? '')
  } catch {
    throw new Error('CONTROLLER_URL is not a URL.')
  }
  if (url.protocol !== 'https:') throw new Error('CONTROLLER_URL must be an https URL.')
  return url.origin
}

export interface DashboardDependencies {
  /** The controller's origin, as `controllerOrigin` returns it. */
  controllerUrl: string
  fetch: typeof fetch
}

/**
 * Proxies one dashboard request to the controller.
 *
 * The controller still checks its password on every route, and its own
 * reverse proxy checks Host and Origin. This proxy only translates the
 * Worker's public origin to the controller's. A state changing request must
 * carry the exact public Origin, and only that exact value is translated, so
 * a missing or foreign Origin never reaches the controller looking trusted.
 * A WebSocket upgrade goes through the same fetch, and the response carries
 * the socket back.
 */
export async function proxyDashboard(request: Request, dependencies: DashboardDependencies): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  if (request.method !== 'GET' && request.method !== 'HEAD' && origin !== url.origin)
    return new Response('Request origin is not allowed.', { status: 403 })

  const headers = new Headers(request.headers)
  if (origin === url.origin) headers.set('origin', dependencies.controllerUrl)

  return dependencies.fetch(
    new Request(new URL(url.pathname + url.search, dependencies.controllerUrl), {
      method: request.method,
      headers,
      // Dashboard writes are small JSON bodies. Buffering them keeps the request replayable.
      body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer(),
      redirect: 'manual',
    }),
  )
}
