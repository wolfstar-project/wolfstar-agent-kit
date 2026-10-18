import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfigText } from '../src/config.ts'

const base = {
  github: { app_id: 123, private_key_path: join(homedir(), 'app.pem'), allowed_owners: ['alice'] },
  server: { host: '127.0.0.1', port: 3210, allowed_origin: 'https://wolfstar-github-agent.localhost' },
  storage: { path: join(homedir(), '.local/share/wolfstar-github-agent/state.sqlite') },
  mutations_enabled: false,
  poll_interval_seconds: 60,
  issue_cutoff: '2026-10-18',
  external_repositories: [],
  repositories: [],
}
const parse = (values: Record<string, unknown>) => parseConfigText(JSON.stringify({ ...base, ...values }))

describe('dashboard operational policy', () => {
  it('validates and translates explicit schedules, with no inherited schedule when disabled', () => {
    const entry = {
      name: 'pr-triage',
      enabled: false,
      timezone: 'Europe/Rome',
      mode: 'report',
      on: { schedule: [{ cron: '0 10 * * 1' }] },
    }
    expect(
      parse({ routines_from_repositories: false, routine_overrides: [{ github: 'Alice/Example', routines: [entry] }] }),
    ).toMatchObject({
      _tag: 'Ok',
      value: {
        routinesFromRepositories: false,
        routineOverrides: {
          'alice/example': {
            routines: [{ name: 'pr-triage', crons: ['0 10 * * 1'], timeZone: 'Europe/Rome', enabled: false }],
          },
        },
      },
    })
    expect(
      parse({
        routine_overrides: [
          { github: 'alice/example', routines: [{ ...entry, on: { schedule: [{ cron: 'invalid' }] } }] },
        ],
      })._tag,
    ).toBe('Err')
    expect(
      parse({ routine_overrides: [{ github: 'alice/example', routines: [{ ...entry, timezone: 'NoSuch/Zone' }] }] })
        ._tag,
    ).toBe('Err')
  })
  it('requires explicit reviewer identities and a supported approval mode', () => {
    const policy = { mode: 'reviewers', reviewers: ['reviewer[bot]'], require: 'all', allow_resolved_feedback: true }
    const merge = (review: unknown) => parse({ auto_merge: { enabled: true, review } })
    expect(merge(policy)).toMatchObject({
      _tag: 'Ok',
      value: {
        autoMerge: { reviewerPolicy: { reviewers: ['reviewer[bot]'], require: 'all', allowResolvedFeedback: true } },
      },
    })
    for (const invalid of [
      { ...policy, reviewers: [] },
      { ...policy, require: 'none' },
      { ...policy, reviewers: ['fake reviewer'] },
      { ...policy, mode: 'unknown' },
    ])
      expect(merge(invalid)._tag).toBe('Err')
    expect(merge({ mode: 'agent' })).toMatchObject({ _tag: 'Ok', value: { autoMerge: { _tag: 'Enabled' } } })
  })
  it('keeps repository defaults partial and validates widened merge authority', () => {
    const result = parse({ repository_defaults: { writable_pr_authors: ['alice'], issue_work: false } })
    expect(result).toMatchObject({
      _tag: 'Ok',
      value: { repositoryDefaults: { writablePullRequestAuthors: ['alice'], issueWork: false } },
    })
    if (result._tag === 'Ok') expect(result.value.repositoryDefaults).not.toHaveProperty('ownership')
    expect(
      parse({ repository_defaults: { auto_merge: { pull_requests: 'every', minimum_confidence: 90 } } })._tag,
    ).toBe('Err')
  })
  it('accepts explicit absolute checkout roots and rejects empty or relative roots', () => {
    expect(parse({ trusted_checkout_roots: [join(homedir(), 'projects')] })).toMatchObject({
      _tag: 'Ok',
      value: { trustedCheckoutRoots: [join(homedir(), 'projects')] },
    })
    for (const roots of [[], ['relative']]) expect(parse({ trusted_checkout_roots: roots })._tag).toBe('Err')
  })
  it('allows an IPv6 webhook loopback without exposing it to the network', () => {
    const webhook = { enabled: true, secret_path: join(homedir(), 'webhook-secret'), host: '::1' }
    expect(parse({ webhook })).toMatchObject({ _tag: 'Ok', value: { webhook: { host: '::1' } } })
    expect(parse({ webhook: { ...webhook, host: '0.0.0.0' } })._tag).toBe('Err')
  })
})
