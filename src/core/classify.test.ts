import { describe, expect, test } from 'bun:test'

import { classify } from './classify.ts'

function assistant(content: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    session_id: 'sess-1',
    uuid: 'u-1',
    parent_tool_use_id: null,
    message: { role: 'assistant', content },
    ...extra,
  }
}

describe('init', () => {
  test('emits the Session id at init, not deferred to the result', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      uuid: 'u-1',
    })

    expect(frames).toContainEqual({ kind: 'session', sessionId: 'sess-1' })
  })

  test('emits what the harness actually loaded', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      uuid: 'u-1',
      model: 'claude-opus-4',
      cwd: '/repo',
      permissionMode: 'bypassPermissions',
      apiKeySource: 'none',
      output_style: 'default',
      claude_code_version: '2.1.0',
      tools: ['Read', 'Bash'],
      agents: ['reviewer'],
      skills: ['tdd'],
      mcp_servers: [{ name: 'linear', status: 'connected' }],
      plugins: [{ name: 'claude-mem', path: '/p', version: '1.0.0' }],
    })

    expect(frames).toContainEqual({
      kind: 'harness',
      model: 'claude-opus-4',
      cwd: '/repo',
      permissionMode: 'bypassPermissions',
      apiKeySource: 'none',
      outputStyle: 'default',
      version: '2.1.0',
      tools: ['Read', 'Bash'],
      agents: ['reviewer'],
      skills: ['tdd'],
      mcpServers: [{ name: 'linear', status: 'connected' }],
      plugins: [{ name: 'claude-mem', path: '/p', version: '1.0.0' }],
    })
  })

  test('emits the slash commands advertised at init', () => {
    const frames = classify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      slash_commands: ['commit', 'review'],
    })

    expect(frames).toContainEqual({
      kind: 'commands',
      commands: [{ name: 'commit' }, { name: 'review' }],
    })
  })

  test('emits the pushed list when commands change mid-Session', () => {
    const frames = classify({
      type: 'system',
      subtype: 'commands_changed',
      session_id: 'sess-1',
      commands: [
        {
          name: 'ship',
          description: 'Ship the backlog',
          argumentHint: '<ticket>',
          aliases: ['deliver'],
        },
      ],
    })

    expect(frames).toEqual([
      {
        kind: 'commands',
        commands: [
          {
            name: 'ship',
            description: 'Ship the backlog',
            argumentHint: '<ticket>',
            aliases: ['deliver'],
          },
        ],
      },
    ])
  })
})

describe('the agent speaking', () => {
  test('emits the agent prose as text', () => {
    const frames = classify(assistant([{ type: 'text', text: 'Reading the file.' }]))

    expect(frames).toEqual([{ kind: 'text', text: 'Reading the file.' }])
  })

  test('emits reasoning separately from prose, so it can be kept out of the Transcript', () => {
    const frames = classify(
      assistant([
        { type: 'thinking', thinking: 'The user wants a diff.' },
        { type: 'text', text: 'Here it is.' },
      ]),
    )

    expect(frames).toEqual([
      { kind: 'reasoning', text: 'The user wants a diff.' },
      { kind: 'text', text: 'Here it is.' },
    ])
  })

  test('emits a tool call before any result exists', () => {
    const frames = classify(
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }]),
    )

    expect(frames).toEqual([
      { kind: 'tool-call', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } },
    ])
  })

  test('attributes work to the Thread named by parent_tool_use_id', () => {
    const frames = classify(
      assistant(
        [
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'Frame' } },
        ],
        { parent_tool_use_id: 'toolu_task' },
      ),
    )

    expect(frames).toEqual([
      { kind: 'text', text: 'Searching.', thread: 'toolu_task' },
      {
        kind: 'tool-call',
        id: 'toolu_2',
        name: 'Grep',
        input: { pattern: 'Frame' },
        thread: 'toolu_task',
      },
    ])
  })

  test('records what the Thread a Task call opens is called', () => {
    const frames = classify(
      assistant([
        {
          type: 'tool_use',
          id: 'toolu_task',
          name: 'Task',
          input: {
            description: 'Review the diff',
            subagent_type: 'code-reviewer',
            prompt: 'Review it',
          },
        },
      ]),
    )

    expect(frames).toEqual([
      {
        kind: 'tool-call',
        id: 'toolu_task',
        name: 'Task',
        input: {
          description: 'Review the diff',
          subagent_type: 'code-reviewer',
          prompt: 'Review it',
        },
        opens: {
          thread: 'toolu_task',
          description: 'Review the diff',
          subagentType: 'code-reviewer',
        },
      },
    ])
  })
})
