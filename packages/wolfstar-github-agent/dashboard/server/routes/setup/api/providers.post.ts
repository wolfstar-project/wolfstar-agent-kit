import type { SettingsChanges } from '../../../../app/utils/settings.ts'
import { defineEventHandler, readBody } from 'h3'
import { assertDevMock } from '../../../utils/mock.ts'
import { applySettingsMock } from '../../../utils/settings-mock.ts'

export default defineEventHandler(async (event) => {
  assertDevMock(event)
  return applySettingsMock((await readBody<SettingsChanges>(event)) ?? {})
})
