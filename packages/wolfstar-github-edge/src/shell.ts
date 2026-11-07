export interface ShellDependencies {
  /** The prerendered dashboard build, served by Workers Static Assets. */
  assets: { fetch: (request: Request) => Promise<Response> }
}

/** Paths the controller owns. The Worker never answers these from its own build. */
function isControllerPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/')
}

const securityHeaders = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

/** The controller's own policy, so the page behaves the same behind the Worker. */
function contentSecurityPolicy(nonce: string): string {
  return `default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; object-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'`
}

function nonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
}

/**
 * Serves the dashboard's pages and files from the Worker's own build, so the
 * interface loads while the controller is down. Returns null for anything the
 * build does not hold, and for every request the controller must answer.
 *
 * The prerendered pages carry inline scripts, so each page gets a fresh nonce
 * and the same Content-Security-Policy the controller sends.
 */
export async function serveShell(request: Request, dependencies: ShellDependencies): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const url = new URL(request.url)
  if (isControllerPath(url.pathname)) return null

  const asset = await dependencies.assets.fetch(new Request(url, { method: request.method }))
  if (!asset.ok) return null

  const headers = new Headers(asset.headers)
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value)

  const isHtml = (headers.get('content-type') ?? '').startsWith('text/html')
  if (isHtml) {
    const value = nonce()
    headers.set('cache-control', 'no-store')
    headers.set('content-security-policy', contentSecurityPolicy(value))
    // The page has been rewritten, so the asset's validators no longer describe it.
    headers.delete('etag')
    headers.delete('content-length')
    const html = request.method === 'HEAD' ? null : await asset.text()
    return new Response(
      html === null
        ? null
        : html.replaceAll('<script', `<script nonce="${value}"`).replaceAll('<style', `<style nonce="${value}"`),
      { status: asset.status, headers },
    )
  }

  // Build files are named by content hash, and Access keeps shared caches from holding them.
  headers.set(
    'cache-control',
    url.pathname.startsWith('/_nuxt/') || url.pathname.startsWith('/_fonts/')
      ? 'private, max-age=31536000, immutable'
      : 'no-store',
  )
  return new Response(asset.body, { status: asset.status, headers })
}
