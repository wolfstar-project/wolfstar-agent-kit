import type { InjectionKey, Ref } from 'vue'
import { DEFAULT_CRON } from './cron-builder.ts'

/** Provided by Settings so a repository field anywhere in the form can offer the App's repositories. */
export const installedRepositoriesKey: InjectionKey<Ref<string[]>> = Symbol('installedRepositories')

export interface ConfigurationView {
  path: string
  revision: string
  values: Record<string, unknown>
}

interface FieldBase {
  key: string
  label: string
  hint?: string
  optional?: boolean
  advanced?: boolean
  placeholder?: string
  visibleWhen?: string
}
export type ConfigurationField = FieldBase &
  (
    | {
        kind: 'text' | 'multiline' | 'date' | 'boolean' | 'list' | 'issues' | 'checks' | 'repository' | 'cron'
        fallback?: string | boolean | string[]
      }
    | { kind: 'number'; fallback?: number; min?: number; max?: number; step?: number }
    | { kind: 'order' | 'multi-choice'; choices: string[]; fallback: string[] }
    | { kind: 'choice'; choices: string[]; fallback: string }
    | { kind: 'object'; fields: ConfigurationField[]; layout?: 'columns' }
    | {
        kind: 'entries'
        fields: ConfigurationField[]
        initial: Record<string, unknown>
        singular?: string
        empty?: string
      }
  )

const text = (key: string, label: string): FieldBase & { kind: 'text' } => ({ key, label, kind: 'text' })
/** A `owner/repository` name, picked from the repositories the GitHub App sees or typed by hand. */
const repository = (key: string, label: string): FieldBase & { kind: 'repository' } => ({
  key,
  label,
  kind: 'repository',
  placeholder: 'owner/repository',
})
/** One schedule, built from choices. It still stores a five-field cron expression. */
const cron = (key: string, label: string): FieldBase & { kind: 'cron' } => ({ key, label, kind: 'cron' })
const number = (key: string, label: string, fallback?: number): Extract<ConfigurationField, { kind: 'number' }> => ({
  key,
  label,
  kind: 'number',
  ...(fallback === undefined ? {} : { fallback }),
})
const flag = (key: string, label: string, fallback = false): FieldBase & { kind: 'boolean'; fallback: boolean } => ({
  key,
  label,
  kind: 'boolean',
  fallback,
})
const list = (key: string, label: string): FieldBase & { kind: 'list' } => ({
  key,
  label,
  kind: 'list',
  hint: 'Press Enter to add a value.',
})
const choice = (
  key: string,
  label: string,
  choices: string[],
  fallback: string,
): Extract<ConfigurationField, { kind: 'choice' }> => ({
  key,
  label,
  kind: 'choice',
  choices,
  fallback,
})
const group = (
  key: string,
  label: string,
  fields: ConfigurationField[],
): Extract<ConfigurationField, { kind: 'object' }> => ({
  key,
  label,
  kind: 'object',
  fields,
})

const reasoningEffort = (): ConfigurationField => ({
  ...group(
    'reasoning_effort',
    'Reasoning effort by provider and role',
    ['codex', 'claude', 'opencode'].map((provider) =>
      group(
        provider,
        provider,
        [
          'adversarial_review',
          'baseline_repair',
          'conflict_resolution',
          'issue_triage',
          'issue_work',
          'review_fix',
          'routine_scan',
          'routine_fix',
        ].map((role) => ({
          ...choice(role, role.replaceAll('_', ' '), ['none', 'low', 'medium', 'high', 'xhigh', 'max'], ''),
          optional: true,
        })),
      ),
    ),
  ),
  optional: true,
  advanced: true,
})
const releaseFields: ConfigurationField[] = [
  text('manifest', 'Package manifest'),
  list('version_files', 'Version files'),
  text('tag_prefix', 'Tag prefix'),
  text('workflow', 'Release workflow'),
  { key: 'checks', label: 'Required checks', kind: 'checks', hint: 'All GitHub Actions checks, or exact check names.' },
  { ...text('changelog', 'Changelog file'), optional: true },
  { ...choice('credential', 'Release credential', ['user'], ''), optional: true },
]
const routineFields: ConfigurationField[] = [
  choice(
    'name',
    'Routine',
    [
      'sentry-checkin',
      'pr-triage',
      'agent-feedback',
      'agent-retro',
      'daily-checkin',
      'd1-query-review',
      'dependency-updates',
      'ci-review',
      'perf-review',
      'seo-review',
      'vitals-review',
    ],
    '',
  ),
  flag('enabled', 'Enable routine', false),
  text('timezone', 'Time zone'),
  choice('mode', 'Mode', ['report', 'propose'], 'report'),
  group('on', 'Schedule', [
    {
      key: 'schedule',
      label: 'Run times',
      kind: 'entries',
      singular: 'schedule',
      empty: 'No schedules. Add one to choose when this routine runs.',
      fields: [cron('cron', 'Schedule')],
      initial: { cron: DEFAULT_CRON },
    },
  ]),
]

const repositoryFields: ConfigurationField[] = [
  repository('github', 'GitHub repository'),
  text('checkout', 'Local checkout'),
  { ...flag('enabled', 'Enable this repository'), hint: 'Include this checkout in repository monitoring.' },
  choice('ownership', 'Ownership', ['owned', 'maintained', 'external'], 'maintained'),
  text('default_branch', 'Default branch'),
  list('writable_pr_authors', 'Trusted pull request authors'),
  list('writable_pr_head_prefixes', 'Writable branch prefixes'),
  flag('issue_work', 'Issue work'),
  flag('pr_review', 'Pull request review'),
  flag('conflict_resolution', 'Conflict resolution'),
  {
    ...number('max_open_pull_requests', 'Maximum open pull requests'),
    min: 1,
    max: 100,
    advanced: true,
    hint: 'Leave blank to use the service limit.',
  },
  { ...number('priority', 'Priority', 0), min: 0, max: 100, advanced: true },
  { ...number('poll_interval_seconds', 'Polling interval (seconds)'), min: 10, max: 3600, advanced: true },
  reasoningEffort(),
  {
    ...group('github_account', 'Dedicated GitHub account', [
      text('login', 'Login'),
      text('token_path', 'Token file'),
      text('name', 'Display name'),
      text('url', 'Profile URL'),
      { key: 'instructions', label: 'Account instructions', kind: 'multiline' },
    ]),
    optional: true,
    advanced: true,
  },
  { ...group('release', 'Package releases', releaseFields), optional: true, advanced: true },
  {
    ...group('auto_merge', 'Repository merge policy', [
      choice('pull_requests', 'Eligible pull requests', ['labelled', 'contained', 'every'], 'labelled'),
      { ...number('minimum_confidence', 'Minimum confidence (%)'), min: 0, max: 100, optional: true },
      {
        ...group('merge_risk', 'Merge risk', [
          number('max_changed_files', 'Maximum changed files', 12),
          number('max_changed_lines', 'Maximum changed lines', 300),
          list('sensitive_paths', 'Sensitive paths'),
          list('contained_paths', 'Contained paths'),
          flag('require_test_change', 'Require a test change'),
          flag('label_overrides_risk', 'Allow an explicit label to override sensitive risk', true),
        ]),
        optional: true,
      },
    ]),
    optional: true,
  },
  group('take_ownership', 'Take Ownership', [
    flag('enabled', 'Enabled'),
    { ...text('production_url', 'Production URL'), visibleWhen: 'enabled' },
    { ...list('required_workflows', 'Required workflows'), visibleWhen: 'enabled' },
    { ...list('smoke_paths', 'Smoke paths'), visibleWhen: 'enabled' },
  ]),
]

/** Missing values stay absent until edited. Existing advanced keys also get form controls. */
export const CONFIGURATION_FIELDS: ConfigurationField[] = [
  group('agent', 'Agent providers', [
    {
      ...choice('provider', 'Default provider', ['codex', 'claude', 'opencode'], 'codex'),
      hint: 'Used when Agent selection follows the configuration.',
    },
    {
      key: 'order',
      label: 'Automatic provider order',
      kind: 'order',
      choices: ['opencode', 'claude', 'codex'],
      fallback: ['opencode', 'claude', 'codex'],
      hint: 'Automatic selection tries providers in this order, using the first with capacity above its reserve.',
    },
    {
      ...group('reserve_percent', 'Capacity reserve (%)', [
        { ...number('claude', 'Claude', 20), min: 0, max: 99 },
        { ...number('codex', 'Codex', 20), min: 0, max: 99 },
        { ...number('opencode', 'opencode', 50), min: 0, max: 99 },
      ]),
      layout: 'columns',
    },
    {
      ...number('maximum_active_agents', 'Maximum active agents'),
      min: 1,
      max: 16,
      hint: 'Leave blank to use the provider default.',
    },
    reasoningEffort(),
    { ...number('memory_per_agent_gib', 'Memory per agent (GiB)', 8), advanced: true, min: 1 },
    { ...number('host_reserve_gib', 'Host memory reserve (GiB)', 8), advanced: true, min: 0 },
  ]),
  group('github', 'GitHub App', [
    number('app_id', 'App ID'),
    { ...text('app_slug', 'App slug'), optional: true },
    {
      ...text('private_key_path', 'Private key file'),
      hint: 'Absolute path to the existing PEM file on this machine.',
    },
    {
      ...list('allowed_owners', 'Allowed owners or repositories'),
      hint: 'Use an owner, or owner/repository to limit access. Press Enter to add.',
    },
  ]),
  group('server', 'Dashboard', [
    text('host', 'Listen host'),
    number('port', 'Port'),
    text('allowed_origin', 'Dashboard origin'),
    { ...list('frame_ancestors', 'Allowed embedding origins'), advanced: true },
    { ...list('browser_origins', 'Public browser origin'), advanced: true, optional: true },
    { ...flag('public_browser_password_login', 'Allow public password login', true), advanced: true },
    { ...flag('public_terminal_sessions', 'Allow public terminal sessions'), advanced: true },
    flag('agent_sessions', 'Agent sessions'),
    {
      ...choice('agent_sessions_codex_mode', 'Codex session access', ['restricted', 'full_access'], 'restricted'),
      visibleWhen: 'agent_sessions',
    },
  ]),
  group('webhook', 'GitHub webhooks', [
    { ...flag('enabled', 'Receive GitHub webhooks'), hint: 'Refresh repository state when GitHub sends an update.' },
    { ...text('host', 'Webhook listen host'), optional: true, advanced: true, visibleWhen: 'enabled' },
    { ...number('port', 'Webhook port', 3211), min: 1, max: 65535, visibleWhen: 'enabled' },
    {
      ...text('secret_path', 'Webhook secret file'),
      visibleWhen: 'enabled',
      hint: 'Absolute path to the existing webhook secret.',
    },
  ]),
  {
    ...group('classification', 'Cloudflare classification', [
      text('account_id', 'Account ID'),
      {
        ...text('token_path', 'Token file'),
        hint: 'Absolute path of a file that holds the Cloudflare API token, not the token itself.',
        placeholder: '/home/wolfstar/.config/wolfstar-github-agent/classification-token',
      },
      { ...text('gateway_id', 'AI Gateway ID'), optional: true },
      {
        ...text('model', 'Classification model'),
        hint: 'typesafe/jev, @cf/cloudflare/clef, @cf/cloudflare/clef-flash or @cf/cloudflare/clef-omni.',
        placeholder: '@cf/cloudflare/clef-flash',
      },
      { ...number('issue_triage_band', 'Issue triage confidence'), min: 0.5, max: 0.99, step: 0.01, optional: true },
    ]),
    optional: true,
  },
  {
    ...group('release_defaults', 'Default package release policy', [
      text('owner', 'Package owner'),
      text('checkout_root', 'Checkout root'),
      ...releaseFields,
    ]),
    optional: true,
  },
  { ...list('trusted_checkout_roots', 'Trusted checkout roots'), optional: true },
  {
    ...flag('routines_from_repositories', 'Use schedules declared by repositories', true),
    hint: 'Turn off to ignore inherited .github/routines.yml schedules. Explicit dashboard overrides still apply.',
  },
  {
    key: 'routine_overrides',
    label: 'Routine schedules by repository',
    kind: 'entries',
    singular: 'routine override',
    empty:
      'No dashboard schedules. Add a repository and choose its routines, time zone and cron expressions. An empty routine list disables every routine for that repository.',
    fields: [
      repository('github', 'GitHub repository'),
      {
        key: 'routines',
        label: 'Routines',
        kind: 'entries',
        singular: 'routine',
        fields: routineFields,
        initial: {
          name: '',
          enabled: false,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          mode: 'report',
          on: { schedule: [] },
        },
      },
    ],
    initial: { github: '', routines: [] },
  },
  group('storage', 'Storage', [
    { ...text('path', 'Database file'), hint: 'Changing this path starts the service with a different database.' },
  ]),
  {
    ...flag('mutations_enabled', 'Allow writes to GitHub'),
    hint: 'Permit approved agents to publish comments, commits and pull requests.',
  },
  group('auto_merge', 'Auto merge', [
    {
      ...flag('enabled', 'Automatically merge eligible pull requests'),
      hint: 'Apply the configured review and repository policies before merging.',
    },
    { ...number('minimum_confidence', 'Minimum confidence (%)', 100), min: 0, max: 100, visibleWhen: 'enabled' },
    { ...choice('method', 'Merge method', ['squash', 'merge', 'rebase'], 'squash'), visibleWhen: 'enabled' },
    {
      ...group('review', 'Who must approve', [
        {
          ...choice('mode', 'Approval policy', ['agent', 'reviewers'], 'agent'),
          hint: 'Agent: merge after the agent’s published READY review. Reviewers: also wait for the selected external reviewers.',
        },
        {
          ...list('reviewers', 'Required reviewer logins'),
          hint: 'Exact GitHub logins for Kodiak, Pullfrog, Greptile, PR Lens or other installed reviewers, including [bot]. No accounts are selected automatically.',
        },
        choice('require', 'Wait for', ['all', 'any'], 'all'),
        {
          ...flag('allow_resolved_feedback', 'Accept resolved feedback instead of approval'),
          hint: 'Requires resolved review threads on the current commit. An open thread or native request for changes still blocks the merge. A comment or diagram alone is not approval.',
        },
      ]),
      visibleWhen: 'enabled',
    },
  ]),
  {
    ...number('max_open_pull_requests', 'Maximum open pull requests', 8),
    min: 1,
    max: 100,
    hint: 'Pause new issue work when the repository reaches this limit. Reviews and repairs continue.',
  },
  {
    ...flag('issue_batches', 'Group related issues into batches', true),
    hint: 'Plan related routine issues together before starting implementation.',
  },
  {
    ...number('poll_interval_seconds', 'Polling interval (seconds)', 60),
    min: 15,
    max: 3600,
    hint: 'Check GitHub every 15–3600 seconds. Webhooks can refresh it sooner.',
  },
  { key: 'issue_cutoff', label: 'Issue cutoff', kind: 'date', hint: 'The fixed date used to exclude older issues.' },
  {
    key: 'triggers',
    label: 'Triggers',
    kind: 'multi-choice',
    choices: ['github', 'routine'],
    fallback: ['github', 'routine'],
    hint: 'Choose which work may start on this machine.',
  },
  {
    key: 'external_repositories',
    label: 'Public issue watches',
    kind: 'entries',
    singular: 'issue watch',
    empty: 'No public issue watches. Add a repository to follow its issues without enabling writes.',
    fields: [
      repository('github', 'GitHub repository'),
      { key: 'issues', label: 'Issues', kind: 'issues', hint: 'all, or comma-separated issue numbers.' },
    ],
    initial: { github: '', issues: 'all' },
  },
  {
    ...group(
      'repository_defaults',
      'Default repository policies',
      repositoryFields
        .filter((field) => !['github', 'checkout', 'default_branch'].includes(field.key))
        .map((field) => ({ ...field, optional: true })),
    ),
    optional: true,
  },
  {
    key: 'repositories',
    label: 'Repository mappings',
    kind: 'entries',
    singular: 'repository',
    empty: 'No repository overrides. Add a local checkout to configure its work and publication policies.',
    fields: repositoryFields,
    initial: {
      github: '',
      checkout: '',
      enabled: false,
      ownership: 'maintained',
      default_branch: 'main',
      writable_pr_authors: [],
      writable_pr_head_prefixes: ['fix/', 'feat/', 'chore/'],
      issue_work: false,
      pr_review: false,
      conflict_resolution: false,
      take_ownership: { enabled: false },
    },
  },
]

export function configurationRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Keep advanced keys editable without dropping fields introduced by another service revision. */
export function configurationFields(
  values: Record<string, unknown>,
  fields: ConfigurationField[],
): ConfigurationField[] {
  return [
    ...fields,
    ...Object.entries(values)
      .filter(([key]) => !fields.some((field) => field.key === key))
      .map(([key, value]): ConfigurationField => {
        const label = key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
        if (Array.isArray(value)) {
          if (value.some((entry) => typeof entry === 'object' && entry !== null))
            return { key, label, kind: 'entries', fields: [], initial: configurationRecord(value[0]), advanced: true }
          return { key, label, kind: 'list', advanced: true }
        }
        if (value !== null && typeof value === 'object')
          return { key, label, kind: 'object', fields: [], advanced: true }
        return {
          key,
          label,
          kind:
            typeof value === 'boolean'
              ? 'boolean'
              : typeof value === 'number'
                ? 'number'
                : typeof value === 'string' && value.includes('\n')
                  ? 'multiline'
                  : 'text',
          advanced: true,
        }
      }),
  ]
}

export const CONFIGURATION_SECTIONS = [
  {
    id: 'automation',
    label: 'Automation',
    icon: 'i-octicon-workflow-16',
    description: 'Choose what starts work and how pull requests are published.',
    keys: [
      'mutations_enabled',
      'triggers',
      'poll_interval_seconds',
      'max_open_pull_requests',
      'issue_batches',
      'issue_cutoff',
      'auto_merge',
    ],
  },
  {
    id: 'routines',
    label: 'Routines',
    icon: 'i-octicon-calendar-16',
    description: 'Choose schedules explicitly, or follow each repository’s routine file.',
    keys: ['routines_from_repositories', 'routine_overrides'],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'i-octicon-hubot-16',
    description: 'Set the default provider and reserve capacity for your own work.',
    keys: ['agent', 'classification'],
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: 'i-octicon-mark-github-16',
    description: 'Connect the GitHub App and choose the owners and issues to follow.',
    keys: ['github', 'external_repositories'],
  },
  {
    id: 'repositories',
    label: 'Repositories',
    icon: 'i-octicon-repo-16',
    description: 'Override work and publication policies for individual local checkouts.',
    keys: ['repository_defaults', 'repositories', 'release_defaults', 'trusted_checkout_roots'],
  },
  {
    id: 'connection',
    label: 'Connection',
    icon: 'i-octicon-plug-16',
    description: 'Configure the dashboard address and incoming GitHub webhooks.',
    keys: ['server', 'webhook'],
  },
  {
    id: 'account',
    label: 'Account',
    icon: 'i-octicon-person-16',
    description: 'Sign-in and security for this dashboard.',
    keys: [],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: 'i-octicon-sliders-16',
    description: 'Storage and additional settings from your configuration file.',
    keys: ['storage'],
  },
] as const
export type ConfigurationSectionId = (typeof CONFIGURATION_SECTIONS)[number]['id']

export function configurationSectionFields(
  id: ConfigurationSectionId,
  values: Record<string, unknown>,
): ConfigurationField[] {
  const section = CONFIGURATION_SECTIONS.find((entry) => entry.id === id)!
  const known = section.keys.flatMap((key) => CONFIGURATION_FIELDS.filter((field) => field.key === key))
  return id === 'advanced'
    ? [
        ...known,
        ...configurationFields(values, CONFIGURATION_FIELDS)
          .filter((field) => !CONFIGURATION_FIELDS.some((known) => known.key === field.key))
          .map((field) => ({ ...field, advanced: false })),
      ]
    : known
}

export interface ConfigurationIssue {
  path: string
  message: string
}

export function configurationIssueSection(path: string): ConfigurationSectionId {
  const root = /^\$\.([^.[\]]+)/.exec(path)?.[1]
  return CONFIGURATION_SECTIONS.find((section) => section.keys.some((key) => key === root))?.id ?? 'advanced'
}

export function configurationFailure(error: unknown): { message: string; issues: ConfigurationIssue[] } {
  const failure = error as { data?: { message?: string; data?: { issues?: ConfigurationIssue[] } }; message?: string }
  return {
    message: failure.data?.message ?? failure.message ?? 'The request failed. Try again.',
    issues: failure.data?.data?.issues ?? [],
  }
}
