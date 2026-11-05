import { defineEventHandler } from 'h3'
import { assertDevMock } from '../../utils/mock.ts'
export default defineEventHandler((event) => {
  assertDevMock(event)
  return []
})
