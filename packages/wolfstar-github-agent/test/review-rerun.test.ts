import { describe, expect, it } from 'vitest'
import { isReviewRerunCommand } from '../src/review-rerun.ts'

describe('review rerun command', () => {
  it.each([
    '/wolfstar-agent rerun',
    ' /wolfstar-agent rerun ',
    '@wolfstar-agent rerun',
    '@wolfstar-github-agent rerun',
    '@wolfstar-github-agent[bot] rerun',
  ])('accepts %s', (body) => {
    expect(isReviewRerunCommand(body)).toBe(true)
  })

  it.each([
    '/wolfstar-agent',
    '/wolfstar-agent rerun this',
    '@wolfstar-agent',
    '@wolfstar-agent review',
    '@wolfstar-agents rerun',
    '@wolfstar-github-agent review',
    'Please /wolfstar-agent rerun',
  ])('rejects %s', (body) => {
    expect(isReviewRerunCommand(body)).toBe(false)
  })
})
