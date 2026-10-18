import type { H3 } from 'h3'
import type { ConfigurationEditor, ConfigurationError } from './config-editor.ts'
import { createError } from 'h3'

function rejected(error: ConfigurationError): never {
  if (error._tag === 'Invalid')
    throw createError({ status: 422, message: 'Configuration is invalid.', data: { issues: error.issues } })
  throw createError({
    status: 409,
    message:
      error._tag === 'Conflict'
        ? 'The configuration changed. Reload it before saving.'
        : 'Another configuration save is in progress. Try again after it finishes.',
  })
}

export function registerConfigurationRoutes(app: H3, editor: ConfigurationEditor): void {
  app.get('/api/configuration', async () => {
    const result = await editor.read()
    return result._tag === 'Ok' ? result.value : rejected(result.error)
  })
  app.post('/api/configuration', async (event) => {
    const input: unknown = await event.req.json().catch(() => {
      throw createError({ status: 400, message: 'A JSON configuration is required.' })
    })
    const result = await editor.save(input)
    return result._tag === 'Ok' ? result.value : rejected(result.error)
  })
}
