import { defineEventHandler } from 'h3'
import { assertDevMock } from '../../../utils/mock.ts'
import { settingsMockView } from '../../../utils/settings-mock.ts'

export default defineEventHandler((event) => {
  assertDevMock(event)
  return settingsMockView()
})
