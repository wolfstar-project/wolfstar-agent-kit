import type { SettingsChanges, SettingsView } from '../../app/utils/settings.ts'

/**
 * A dev-only stand-in for the Cloudflare edge Worker's `/setup/api`, so the
 * Settings page shows its provider logins without a deployment. Every route
 * that uses it 404s outside dev.
 */
const view: SettingsView = {
  ready: true,
  app: {
    slug: 'wolfstar-project-agent-abcd',
    owner: 'wolfstar-project',
    htmlUrl: 'https://github.com/apps/wolfstar-project-agent-abcd',
    installUrl: 'https://github.com/apps/wolfstar-project-agent-abcd/installations/new',
  },
  providers: {
    claude: { configured: true },
    codex: { configured: false },
    opencode: { configured: false },
    workersAi: { configured: false, accountId: null },
  },
  githubUser: null,
  mutationsEnabled: true,
}

/** Polls answered "pending" before the mock code counts as approved. */
let pendingPolls = 0

export function settingsMockView(): SettingsView {
  return structuredClone(view)
}

export function applySettingsMock(changes: SettingsChanges): SettingsView & { restarting: boolean } {
  const set = (value: string | null | undefined, configured: boolean): boolean =>
    value === undefined ? configured : value !== null
  view.providers.claude.configured = set(changes.claudeToken, view.providers.claude.configured)
  view.providers.codex.configured = set(changes.codexAuth, view.providers.codex.configured)
  view.providers.opencode.configured = set(changes.zaiApiKey, view.providers.opencode.configured)
  view.providers.workersAi.configured = set(changes.workersAiToken, view.providers.workersAi.configured)
  if (changes.githubUserToken !== undefined)
    view.githubUser = changes.githubUserToken === null ? null : { login: 'RedStar071' }
  if (changes.mutationsEnabled !== undefined) view.mutationsEnabled = changes.mutationsEnabled
  return { ...settingsMockView(), restarting: true }
}

export function issueCodexMockCode() {
  pendingPolls = 2
  return {
    deviceAuthId: 'mock-device',
    userCode: 'MOCK-1234',
    verificationUrl: 'https://auth.openai.com/codex/device',
    interval: 1,
    expiresAt: Date.now() + 15 * 60 * 1000,
  }
}

/** Approves the mock code after two pending answers, as a person would. */
export function pollCodexMock(): 'Pending' | 'SignedIn' {
  if (pendingPolls > 0) {
    pendingPolls -= 1
    return 'Pending'
  }
  return 'SignedIn'
}
