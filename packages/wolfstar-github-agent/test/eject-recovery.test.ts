import { describe, expect, it } from 'vitest'
import { ejectRecoveryFromError, ejectSessionCommand } from '../dashboard/app/utils/eject.ts'

describe('delayed Eject recovery', () => {
  it('resumes a Claude Code session with its saved UUID', () => {
    expect(ejectSessionCommand('claude', '12345678-1234-1234-1234-123456789abc', 'hogwild')).toBe(
      "ssh -t 'hogwild' ''\\''/home/wolfstar/.local/bin/claude'\\'' '\\''--resume'\\'' '\\''12345678-1234-1234-1234-123456789abc'\\'''",
    )
  })

  it('keeps the saved session and next action from a tagged 503 response', () => {
    const result = ejectRecoveryFromError(
      {
        data: {
          statusCode: 503,
          data: {
            _tag: 'EjectDelayed',
            provider: 'opencode',
            sessionId: 'ses_abc12345',
            nextAction: 'Stop Wolfstar GitHub Agent. Then resume this saved session.',
          },
        },
      },
      'hogwild',
    )

    expect(result).toEqual({
      _tag: 'EjectDelayed',
      command:
        "ssh -t 'hogwild' ''\\''/home/wolfstar/.local/bin/opencode'\\'' '\\''--session'\\'' '\\''ses_abc12345'\\'''",
      sessionId: 'ses_abc12345',
      nextAction: 'Stop Wolfstar GitHub Agent. Then resume this saved session.',
    })
  })
})

it('resumes a desktop session on the desktop', () => {
  expect(ejectSessionCommand('codex', 'desktop:abc', 'hogwild')).toBe(
    "# Run on Desktop\n'/home/wolfstar/.local/bin/codex' 'resume' 'abc' '-c' 'tui.resume_cwd=\"session\"'",
  )
})
