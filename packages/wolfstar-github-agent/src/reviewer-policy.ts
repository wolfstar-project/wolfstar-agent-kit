/** Exact GitHub logins, with evidence belonging to the head being merged. */
export interface ReviewerPolicy {
  reviewers: string[]
  require: 'all' | 'any'
  allowResolvedFeedback: boolean
}

export interface ReviewerEvidence {
  reviews: { login: string; state: string; headSha: string }[]
  threads: { login: string; resolved: boolean; headSha: string }[]
}

export function reviewerPolicyRefusal(
  policy: ReviewerPolicy,
  headSha: string,
  evidence: ReviewerEvidence,
): string | null {
  if (!policy.reviewers.length) return 'Choose at least one reviewer before enabling the reviewer policy.'
  const selected = new Set(policy.reviewers.map((login) => login.toLowerCase()))
  if (evidence.threads.some((thread) => selected.has(thread.login.toLowerCase()) && !thread.resolved))
    return 'A selected reviewer still has unresolved feedback.'
  for (const login of selected) {
    const latest = evidence.reviews
      .filter((review) => review.login.toLowerCase() === login && !['PENDING', 'COMMENTED'].includes(review.state))
      .at(-1)
    if (latest?.state === 'CHANGES_REQUESTED') return `${login} still requests changes.`
  }
  const accepted = policy.reviewers.map((login) => {
    const matches = (actor: string) => actor.toLowerCase() === login.toLowerCase()
    const threads = evidence.threads.filter((thread) => matches(thread.login))
    if (threads.some((thread) => !thread.resolved)) return false
    const reviews = evidence.reviews.filter(
      (review) => matches(review.login) && review.headSha === headSha && review.state !== 'PENDING',
    )
    // COMMENTED does not revoke an approval; DISMISSED and CHANGES_REQUESTED do.
    const decision = reviews.filter((review) => review.state !== 'COMMENTED').at(-1)
    if (decision?.state === 'APPROVED') return true
    // Resolution never substitutes for a native request for changes.
    if (decision?.state === 'CHANGES_REQUESTED' || decision?.state === 'DISMISSED') return false
    return policy.allowResolvedFeedback && threads.some((thread) => thread.headSha === headSha)
  })
  return (policy.require === 'all' ? accepted.every(Boolean) : accepted.some(Boolean))
    ? null
    : `Waiting for ${policy.require === 'all' ? 'all' : 'one of'}: ${policy.reviewers.join(', ')}. Approval or resolved feedback must cover the current head commit.`
}
