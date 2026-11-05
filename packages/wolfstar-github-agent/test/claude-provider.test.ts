import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, AgentTurnRequest } from '../src/agent-provider.ts'
import { describe, expect, it } from 'vitest'
import { claudeAgentEvents, claudeAgentUsage, createClaudeProvider } from '../src/claude-provider.ts'

function sdkMessage(message: unknown): SDKMessage {
  return message as SDKMessage
}

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    model: 'claude-sonnet-5-5',
    outputSchema: { type: 'object', properties: { outcome: { type: 'string' } } },
    prompt: 'Resolve the conflict.',
    reasoningEffort: 'medium',
    sessionId: null,
    signal: new AbortController().signal,
    workspace: '/tmp/worktree',
    ...overrides,
  }
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const items: AgentEvent[] = []
  for await (const event of events) items.push(event)
  return items
}

const result = sdkMessage({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"outcome":"fallback"}',
  structured_output: { outcome: 'resolved' },
  usage: {},
  modelUsage: {
    'claude-sonnet-5-5': {
      inputTokens: 10,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 3,
      outputTokens: 4,
    },
  },
})

describe('claudeAgentEvents', () => {
  it('maps the session, tool activity, structured result, and total usage', () => {
    const commands = new Map<string, string>()
    const messages = [
      sdkMessage({ type: 'system', subtype: 'init', session_id: '12345678-1234-1234-1234-123456789abc' }),
      sdkMessage({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pnpm test' } }] },
      }),
      sdkMessage({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'passed' }] },
      }),
      result,
    ]

    expect(messages.flatMap((message) => claudeAgentEvents(message, commands))).toEqual([
      { _tag: 'SessionStarted', sessionId: '12345678-1234-1234-1234-123456789abc' },
      { _tag: 'CommandStarted', command: 'Bash pnpm test' },
      { _tag: 'CommandCompleted', command: 'Bash pnpm test', output: 'passed', exitCode: 0 },
      { _tag: 'Message', text: '{"outcome":"resolved"}' },
      {
        _tag: 'Usage',
        usage: { _tag: 'Available', input: 10, cachedInput: 20, cacheWrite: 3, output: 4, reasoning: 0 },
      },
      { _tag: 'TurnCompleted' },
    ])
  })

  it('maps file edits, web searches, reasoning, and progress', () => {
    const message = sdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Inspect the failing path.' },
          { type: 'text', text: '▓▓▓░░ 40% reproduced the failure.' },
          { type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'src/index.ts' } },
          { type: 'tool_use', id: 'tool-2', name: 'WebSearch', input: { query: 'official docs' } },
        ],
      },
    })

    expect(claudeAgentEvents(message)).toEqual([
      { _tag: 'Reasoning', text: 'Inspect the failing path.' },
      { _tag: 'Progress', percent: 40, text: 'reproduced the failure.' },
      { _tag: 'FileChanged', changes: [{ path: 'src/index.ts', kind: 'update' }] },
      { _tag: 'WebSearch' },
    ])
  })

  it('reports an SDK result error with Claude as its owner', () => {
    expect(
      claudeAgentEvents(
        sdkMessage({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['Usage limit reached.'],
          usage: {},
          modelUsage: {},
        }),
      ),
    ).toEqual([{ _tag: 'Failed', reason: 'The claude session failed: Usage limit reached.' }])
  })

  it('sums usage from every Claude model call', () => {
    expect(claudeAgentUsage(result)).toEqual({
      _tag: 'Available',
      input: 10,
      cachedInput: 20,
      cacheWrite: 3,
      output: 4,
      reasoning: 0,
    })
  })
})

describe('createClaudeProvider', () => {
  it('pins the worktree, model, effort, schema, and saved session', async () => {
    let receivedOptions: Options | undefined
    const provider = createClaudeProvider({
      queryClaude: ({ options }) => {
        receivedOptions = options
        return (async function* () {
          yield sdkMessage({ type: 'system', subtype: 'init', session_id: '12345678-1234-1234-1234-123456789abc' })
          yield result
        })()
      },
    })

    const events = await collect(provider.runTurn(request({ sessionId: '12345678-1234-1234-1234-123456789abc' })))

    expect(events).toContainEqual({ _tag: 'Message', text: '{"outcome":"resolved"}' })
    expect(receivedOptions).toEqual(
      expect.objectContaining({
        allowDangerouslySkipPermissions: true,
        cwd: '/tmp/worktree',
        effort: 'medium',
        model: 'claude-sonnet-5-5',
        outputFormat: { type: 'json_schema', schema: request().outputSchema },
        permissionMode: 'bypassPermissions',
        resume: '12345678-1234-1234-1234-123456789abc',
      }),
    )
  })
})
