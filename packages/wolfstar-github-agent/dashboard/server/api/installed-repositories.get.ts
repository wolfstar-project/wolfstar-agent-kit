import { defineEventHandler } from 'h3'
import { assertDevMock } from '../utils/mock.ts'

export default defineEventHandler((event) => {
  assertDevMock(event)
  return {
    repositories: ['wolfstar-project/stars-components', 'wolfstar-project/plugins', 'wolfstar-project/wolfstar'],
  }
})
