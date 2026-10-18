/** Container transport and credentials are deployment-owned; operational policy is editable. */
export const MANAGED_CONFIGURATION_PATHS = [
  'github.app_id',
  'github.app_slug',
  'github.private_key_path',
  'github.allowed_owners',
  'server.host',
  'server.port',
  'server.allowed_origin',
  'webhook.enabled',
  'webhook.host',
  'webhook.port',
  'webhook.secret_path',
  'storage.path',
]

export async function proxyConfiguration(
  request: Request,
  dependencies: {
    proxy: (request: Request) => Promise<Response>
    persist: (values: Record<string, unknown>) => Promise<void>
  },
): Promise<Response> {
  const read = await dependencies.proxy(new Request(request.url, { headers: request.headers }))
  if (!read.ok) return read
  const current = (await read.json()) as { values: Record<string, unknown> }
  if (request.method === 'POST') {
    const input = (await request
      .clone()
      .json()
      .catch(() => null)) as { values?: Record<string, unknown> } | null
    const at = (value: unknown, path: string): unknown =>
      path
        .split('.')
        .reduce<unknown>(
          (node, key) =>
            typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined,
          value,
        )
    const changed = MANAGED_CONFIGURATION_PATHS.filter(
      (path) => JSON.stringify(at(input?.values, path)) !== JSON.stringify(at(current.values, path)),
    )
    if (changed.length)
      return Response.json(
        {
          message: 'These values are managed by the Cloudflare deployment.',
          data: {
            issues: changed.map((path) => ({ path: `$.${path}`, message: 'Managed by Cloudflare deployment.' })),
          },
        },
        { status: 422 },
      )
  }
  const response = request.method === 'GET' ? Response.json(current) : await dependencies.proxy(request)
  if (!response.ok) return response
  const view = (await response.json()) as { values: Record<string, unknown> }
  // No success is acknowledged until the durable write completes.
  if (request.method === 'POST') await dependencies.persist(view.values)
  return Response.json({ ...view, managedPaths: MANAGED_CONFIGURATION_PATHS.map((path) => `$.${path}`) })
}
