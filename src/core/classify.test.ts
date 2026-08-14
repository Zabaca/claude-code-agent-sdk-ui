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

function person(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    type: 'user',
    session_id: 'sess-1',
    uuid: 'u-2',
    parent_tool_use_id: null,
    message: { role: 'user', content },
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

describe('the person speaking, and tools answering', () => {
  test('emits a plain string prompt as the person s words', () => {
    expect(classify(person('ship it'))).toEqual([{ kind: 'prompt', text: 'ship it' }])
  })

  test('emits a block prompt as the person s words', () => {
    expect(classify(person([{ type: 'text', text: 'ship it' }]))).toEqual([
      { kind: 'prompt', text: 'ship it' },
    ])
  })

  test('marks a prompt the runtime wrote rather than the person', () => {
    expect(classify(person('<system-reminder/>', { isSynthetic: true }))).toEqual([
      { kind: 'prompt', text: '<system-reminder/>', synthetic: true },
    ])
  })

  test('emits a pasted image as its own Frame', () => {
    const frames = classify(
      person([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
        { type: 'text', text: 'what is this' },
      ]),
    )

    expect(frames).toEqual([
      { kind: 'image', mediaType: 'image/png', data: 'iVBOR' },
      { kind: 'prompt', text: 'what is this' },
    ])
  })

  test('emits a tool result against the call it answers', () => {
    const frames = classify(
      person([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passed' }]),
    )

    expect(frames).toEqual([
      { kind: 'tool-result', id: 'toolu_1', output: '12 passed', isError: false },
    ])
  })

  test('emits a failed tool result as failed', () => {
    const frames = classify(
      person([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          is_error: true,
          content: [{ type: 'text', text: 'command not found' }],
        },
      ]),
    )

    expect(frames).toEqual([
      { kind: 'tool-result', id: 'toolu_1', output: 'command not found', isError: true },
    ])
  })

  test('carries the structured tool output, which is where diffs come from', () => {
    const frames = classify(
      person([{ type: 'tool_result', tool_use_id: 'toolu_edit', content: 'ok' }], {
        tool_use_result: { structuredPatch: [{ oldStart: 1, lines: ['-a', '+b'] }] },
      }),
    )

    expect(frames).toEqual([
      {
        kind: 'tool-result',
        id: 'toolu_edit',
        output: 'ok',
        isError: false,
        structured: { structuredPatch: [{ oldStart: 1, lines: ['-a', '+b'] }] },
      },
    ])
  })

  test('leaves structured output off when a message answers more than one call', () => {
    const frames = classify(
      person(
        [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'b' },
        ],
        { tool_use_result: { structuredPatch: [] } },
      ),
    )

    expect(frames).toEqual([
      { kind: 'tool-result', id: 'toolu_1', output: 'a', isError: false },
      { kind: 'tool-result', id: 'toolu_2', output: 'b', isError: false },
    ])
  })

  test('emits an image the agent put in the Transcript, attributed to its call', () => {
    const frames = classify(
      person([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_shot',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PNG' } },
          ],
        },
      ]),
    )

    expect(frames).toEqual([
      { kind: 'tool-result', id: 'toolu_shot', output: '', isError: false },
      { kind: 'image', mediaType: 'image/png', data: 'PNG', toolCallId: 'toolu_shot' },
    ])
  })

  test('attributes a tool result to the Thread that made the call', () => {
    const frames = classify(
      person([{ type: 'tool_result', tool_use_id: 'toolu_3', content: 'done' }], {
        parent_tool_use_id: 'toolu_task',
      }),
    )

    expect(frames).toEqual([
      {
        kind: 'tool-result',
        id: 'toolu_3',
        output: 'done',
        isError: false,
        thread: 'toolu_task',
      },
    ])
  })
})
