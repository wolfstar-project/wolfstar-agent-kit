import { describe, expect, it } from 'vitest'
import { reviewerPolicyRefusal } from '../src/reviewer-policy.ts'

const policy = { reviewers: ['review-bot[bot]'], require: 'all' as const, allowResolvedFeedback: true }
describe('external reviewer policy', () => {
  it('waits for evidence instead of treating a missing review as approval', () => {
    expect(reviewerPolicyRefusal(policy, 'head', { reviews: [], threads: [] })).not.toBeNull()
  })
  it('accepts an exact current-head approval and rejects stale approval', () => {
    const evidence = { reviews: [{ login: 'REVIEW-BOT[bot]', headSha: 'head', state: 'APPROVED' }], threads: [] }
    expect(reviewerPolicyRefusal(policy, 'head', evidence)).toBeNull()
    expect(reviewerPolicyRefusal(policy, 'next', evidence)).not.toBeNull()
  })
  it('requires resolved current-head feedback and blocks unresolved earlier feedback', () => {
    const thread = { login: 'review-bot[bot]', headSha: 'head', resolved: true }
    expect(reviewerPolicyRefusal(policy, 'head', { reviews: [], threads: [thread] })).toBeNull()
    expect(reviewerPolicyRefusal(policy, 'next', { reviews: [], threads: [thread] })).not.toBeNull()
    expect(
      reviewerPolicyRefusal(policy, 'head', {
        reviews: [],
        threads: [thread, { ...thread, headSha: 'old', resolved: false }],
      }),
    ).not.toBeNull()
  })
  it('does not bypass a request for changes through thread resolution', () => {
    expect(
      reviewerPolicyRefusal(policy, 'head', {
        reviews: [{ login: 'review-bot[bot]', headSha: 'head', state: 'CHANGES_REQUESTED' }],
        threads: [{ login: 'review-bot[bot]', headSha: 'head', resolved: true }],
      }),
    ).not.toBeNull()
  })
  it('supports all and any without accepting another reviewer identity', () => {
    const evidence = { reviews: [{ login: 'review-bot[bot]', headSha: 'head', state: 'APPROVED' }], threads: [] }
    expect(
      reviewerPolicyRefusal({ ...policy, reviewers: [...policy.reviewers, 'other'] }, 'head', evidence),
    ).not.toBeNull()
    expect(
      reviewerPolicyRefusal({ ...policy, require: 'any', reviewers: [...policy.reviewers, 'other'] }, 'head', evidence),
    ).toBeNull()
    expect(reviewerPolicyRefusal({ ...policy, reviewers: ['impersonator'] }, 'head', evidence)).not.toBeNull()
    expect(
      reviewerPolicyRefusal({ ...policy, allowResolvedFeedback: false }, 'head', {
        reviews: [],
        threads: [{ login: 'review-bot[bot]', headSha: 'head', resolved: true }],
      }),
    ).not.toBeNull()
  })
})
