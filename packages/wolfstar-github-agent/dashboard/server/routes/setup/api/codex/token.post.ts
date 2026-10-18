import { defineEventHandler, setResponseStatus } from 'h3'
import { assertDevMock } from '../../../../utils/mock.ts'
import { applySettingsMock, pollCodexMock } from '../../../../utils/settings-mock.ts'

export default defineEventHandler((event) => {
  assertDevMock(event)
  if (pollCodexMock() === 'Pending') {
    setResponseStatus(event, 202)
    return { pending: true }
  }
  return applySettingsMock({ codexAuth: '{}' })
})
