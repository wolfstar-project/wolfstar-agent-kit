import { defineEventHandler } from 'h3'
import { assertDevMock } from '../../../../utils/mock.ts'
import { issueCodexMockCode } from '../../../../utils/settings-mock.ts'

export default defineEventHandler((event) => {
  assertDevMock(event)
  return issueCodexMockCode()
})
