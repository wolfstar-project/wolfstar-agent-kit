import { defineEventHandler, readBody } from 'h3'
import { configurationMock, configurationMockError } from '../utils/configuration-mock.ts'
import { assertDevMock } from '../utils/mock.ts'

export default defineEventHandler(async (event) => {
  assertDevMock(event)
  const result = await (await configurationMock()).save(await readBody<unknown>(event))
  return result._tag === 'Ok' ? result.value : configurationMockError(result.error)
})
