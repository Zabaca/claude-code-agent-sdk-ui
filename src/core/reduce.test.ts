import { describe, expect, test } from 'bun:test'

import { classify, type ClassifyInput } from './classify.ts'
import type { Frame } from './frame.ts'
import { reduce, type Pending } from './reduce.ts'
import type { Message, Transcript } from './transcript.ts'

/** The seam under test: fixture SDK messages in, Transcript out. */
function transcriptOf(stream: ClassifyInput[]): Transcript {
  return reduce(stream.flatMap((message) => classify(message)))
}

function threadOf(message: Message): string | undefined {
  return 'thread' in message ? message.thread : undefined
}

function assistant(content: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    session_id: 'sess-1',
    parent_tool_use_id: null,
    message: { role: 'assistant', content },
    ...extra,
  }
}

function person(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    type: 'user',
    session_id: 'sess-1',
    parent_tool_use_id: null,
    message: { role: 'user', content },
    ...extra,
  }
}

describe('the agent speaking', () => {
  test('accumulates a stretch of prose into one Message rather than one per delta', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'text', text: 'Reading ' }]),
      assistant([{ type: 'text', text: 'the file.' }]),
    ])

    expect(transcript.messages).toEqual([{ kind: 'text', text: 'Reading the file.' }])
  })

  test('starts a new Message when anything else happened between two stretches', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'text', text: 'Reading.' }]),
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.ts' } }]),
      assistant([{ type: 'text', text: 'Read it.' }]),
    ])

    expect(transcript.messages.filter((message) => message.kind === 'text')).toEqual([
      { kind: 'text', text: 'Reading.' },
      { kind: 'text', text: 'Read it.' },
    ])
  })

  test('keeps a Thread s prose apart from the agent s own', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'text', text: 'Delegating.' }]),
      assistant([{ type: 'text', text: 'Searching.' }], { parent_tool_use_id: 'toolu_task' }),
    ])

    expect(transcript.messages).toEqual([
      { kind: 'text', text: 'Delegating.' },
      { kind: 'text', text: 'Searching.', thread: 'toolu_task' },
    ])
  })
})

describe('the person speaking', () => {
  test('makes the person s words their own Message', () => {
    const transcript = transcriptOf([person('review the diff')])

    expect(transcript.messages).toEqual([{ kind: 'prompt', text: 'review the diff' }])
  })

  test('marks a prompt the runtime wrote, and who asked for a Turn nobody typed', () => {
    const transcript = transcriptOf([
      person('<system-reminder/>', { isSynthetic: true }),
      person('run the nightly checks', {
        origin: { kind: 'peer', from: 'agent-7', name: 'Scout' },
      }),
    ])

    expect(transcript.messages).toEqual([
      { kind: 'prompt', text: '<system-reminder/>', synthetic: true },
      {
        kind: 'prompt',
        text: 'run the nightly checks',
        origin: { kind: 'peer', from: 'agent-7', name: 'Scout' },
      },
    ])
  })
})

describe('a tool answering the call that opened it', () => {
  test('leaves a call pending until it answers', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }]),
    ])

    expect(transcript.messages).toEqual([
      {
        kind: 'tool-call',
        id: 'toolu_1',
        name: 'Bash',
        input: { command: 'bun test' },
        status: 'pending',
      },
    ])
  })

  test('attaches an answer to the call it answers rather than appending a Message', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }]),
      assistant([{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/a.ts' } }]),
      person([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passed' }]),
    ])

    expect(transcript.messages).toHaveLength(2)
    expect(transcript.messages[0]).toEqual({
      kind: 'tool-call',
      id: 'toolu_1',
      name: 'Bash',
      input: { command: 'bun test' },
      status: 'success',
      output: '12 passed',
    })
    expect(transcript.messages[1]).toMatchObject({ id: 'toolu_2', status: 'pending' })
  })

  test('shows a failure as a status, without expanding anything', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'nope' } }]),
      person([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          is_error: true,
          content: 'command not found',
        },
      ]),
    ])

    expect(transcript.messages[0]).toMatchObject({
      status: 'error',
      output: 'command not found',
    })
  })

  test('carries the structured output through, which is where diffs come from', () => {
    const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }]
    const transcript = transcriptOf([
      assistant([{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: '/a.ts' } }]),
      person([{ type: 'tool_result', tool_use_id: 'toolu_e', content: 'ok' }], {
        tool_use_result: { structuredPatch: patch },
      }),
    ])

    expect(transcript.messages[0]).toMatchObject({ structured: { structuredPatch: patch } })
  })
})

describe('a Thread', () => {
  test('names the Thread on the Task Message, and attributes the work to it', () => {
    const transcript = transcriptOf([
      person('review the diff'),
      assistant([
        {
          type: 'tool_use',
          id: 'toolu_task',
          name: 'Task',
          input: { description: 'Review the diff', subagent_type: 'code-reviewer' },
        },
      ]),
      assistant([{ type: 'text', text: 'Reading.' }], { parent_tool_use_id: 'toolu_task' }),
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.ts' } }], {
        parent_tool_use_id: 'toolu_task',
      }),
      person([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export const a = 1' }], {
        parent_tool_use_id: 'toolu_task',
      }),
      person([{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'Looks good.' }]),
    ])

    expect(transcript.messages[1]).toMatchObject({
      kind: 'tool-call',
      id: 'toolu_task',
      opens: {
        thread: 'toolu_task',
        description: 'Review the diff',
        subagentType: 'code-reviewer',
      },
    })
    expect(transcript.messages.map(threadOf)).toEqual([
      undefined,
      undefined,
      'toolu_task',
      'toolu_task',
    ])
  })

  test('keeps the Transcript flat, so nesting stays a rendering decision', () => {
    const transcript = transcriptOf([
      assistant([
        { type: 'tool_use', id: 'toolu_a', name: 'Task', input: { description: 'A' } },
        { type: 'tool_use', id: 'toolu_b', name: 'Task', input: { description: 'B' } },
      ]),
      assistant([{ type: 'text', text: 'From A.' }], { parent_tool_use_id: 'toolu_a' }),
      assistant([{ type: 'text', text: 'From B.' }], { parent_tool_use_id: 'toolu_b' }),
    ])

    expect(transcript.messages.map((message) => message.kind)).toEqual([
      'tool-call',
      'tool-call',
      'text',
      'text',
    ])
    expect(transcript.messages.every((message) => !('messages' in message))).toBe(true)
  })

  test('does not fold two Threads prose together just because they are adjacent', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'text', text: 'From A.' }], { parent_tool_use_id: 'toolu_a' }),
      assistant([{ type: 'text', text: 'From B.' }], { parent_tool_use_id: 'toolu_b' }),
    ])

    expect(transcript.messages).toEqual([
      { kind: 'text', text: 'From A.', thread: 'toolu_a' },
      { kind: 'text', text: 'From B.', thread: 'toolu_b' },
    ])
  })
})

describe('the Turn', () => {
  test('is idle before anything is asked of it', () => {
    expect(transcriptOf([]).turn).toEqual({ status: 'idle' })
  })

  test('is working from the moment the person asks until the Turn ends', () => {
    const working = transcriptOf([person('ship it')])
    const ended = transcriptOf([
      person('ship it'),
      { type: 'result', subtype: 'success', result: 'Shipped.', num_turns: 3, duration_ms: 4200 },
    ])

    expect(working.turn.status).toBe('working')
    expect(ended.turn.status).toBe('idle')
  })

  test('records what the Turn answered where a later Turn cannot overwrite it', () => {
    const transcript = transcriptOf([
      person('ship it'),
      {
        type: 'result',
        subtype: 'success',
        result: 'Shipped.',
        num_turns: 3,
        duration_ms: 4200,
        stop_reason: 'end_turn',
        terminal_reason: 'completed',
      },
    ])

    expect(transcript.messages.at(-1)).toEqual({
      kind: 'outcome',
      outcome: 'settled',
      result: 'Shipped.',
      turns: 3,
      durationMs: 4200,
      stopReason: 'end_turn',
      terminalReason: 'completed',
    })
  })

  test('renders a Turn that stopped short as a failure carrying its reason', () => {
    const transcript = transcriptOf([
      person('ship it'),
      {
        type: 'result',
        subtype: 'error_max_turns',
        num_turns: 40,
        duration_ms: 90000,
        errors: ['Reached the maximum number of turns'],
        stop_reason: 'max_turns',
        terminal_reason: 'max_turns',
      },
    ])

    expect(transcript.turn).toEqual({
      status: 'failed',
      subtype: 'error_max_turns',
      reason: 'Reached the maximum number of turns',
    })
    expect(transcript.messages.at(-1)).toEqual({
      kind: 'outcome',
      outcome: 'failed',
      subtype: 'error_max_turns',
      reason: 'Reached the maximum number of turns',
      turns: 40,
      durationMs: 90000,
      stopReason: 'max_turns',
      terminalReason: 'max_turns',
    })
  })

  test.each(['aborted_streaming', 'aborted_tools'])(
    'reduces a Turn interrupted mid-%s to idle rather than to a failure',
    (terminalReason) => {
      const transcript = transcriptOf([
        person('ship it'),
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 2,
          duration_ms: 1200,
          terminal_reason: terminalReason,
        },
      ])

      expect(transcript.turn.status).toBe('idle')
      expect(transcript.turn).not.toHaveProperty('reason')
      expect(transcript.messages.at(-1)).toMatchObject({
        kind: 'outcome',
        outcome: 'interrupted',
      })
      expect(transcript.messages.map((message) => message.kind)).not.toContain('failed')
    },
  )

  test('still says what the runtime said about an interrupt, without calling it a problem', () => {
    const transcript = transcriptOf([
      person('ship it'),
      {
        type: 'result',
        subtype: 'error_during_execution',
        terminal_reason: 'aborted_tools',
        errors: ['Aborted by user while a tool was running'],
      },
    ])

    expect(transcript.messages.at(-1)).toEqual({
      kind: 'outcome',
      outcome: 'interrupted',
      subtype: 'error_during_execution',
      reason: 'Aborted by user while a tool was running',
      terminalReason: 'aborted_tools',
    })
    expect(transcript.turn).toEqual({ status: 'idle' })
  })

  test('leaves an earlier Turn s outcome standing when the next Turn starts', () => {
    const transcript = transcriptOf([
      person('ship it'),
      { type: 'result', subtype: 'error_max_turns', errors: ['Reached the maximum'] },
      person('try again'),
    ])

    expect(transcript.turn.status).toBe('working')
    expect(transcript.messages.map((message) => message.kind)).toEqual([
      'prompt',
      'outcome',
      'prompt',
    ])
    expect(transcript.messages[1]).toMatchObject({ outcome: 'failed', reason: 'Reached the maximum' })
  })
})

describe('markers, so the screen never quietly lies', () => {
  test('marks where context was compacted', () => {
    const transcript = transcriptOf([
      assistant([{ type: 'text', text: 'Before.' }]),
      {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: {
          trigger: 'auto',
          pre_tokens: 180000,
          post_tokens: 42000,
          duration_ms: 3100,
        },
      },
      assistant([{ type: 'text', text: 'After.' }]),
    ])

    expect(transcript.messages).toEqual([
      { kind: 'text', text: 'Before.' },
      {
        kind: 'compacted',
        trigger: 'auto',
        preTokens: 180000,
        postTokens: 42000,
        durationMs: 3100,
      },
      { kind: 'text', text: 'After.' },
    ])
  })

  test('marks a reset, which is memory gone rather than memory summarised', () => {
    const transcript = transcriptOf([
      { type: 'conversation_reset', new_conversation_id: 'conv-2' },
    ])

    expect(transcript.messages).toEqual([{ kind: 'reset', transcriptId: 'conv-2' }])
  })

  test('marks memory recalled from outside this conversation', () => {
    const transcript = transcriptOf([
      {
        type: 'system',
        subtype: 'memory_recall',
        mode: 'select',
        memories: [{ path: '/memories/ports.md', scope: 'personal', content: 'Prefers Bun.' }],
      },
    ])

    expect(transcript.messages).toEqual([
      {
        kind: 'recall',
        mode: 'select',
        memories: [{ path: '/memories/ports.md', scope: 'personal', content: 'Prefers Bun.' }],
      },
    ])
  })

  test('records a pasted image, and one the agent put there, against its call', () => {
    const transcript = transcriptOf([
      person([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
        { type: 'text', text: 'what is this' },
      ]),
      assistant([{ type: 'tool_use', id: 'toolu_s', name: 'Screenshot', input: {} }]),
      person([
        {
          type: 'tool_result',
          tool_use_id: 'toolu_s',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PNG' } },
          ],
        },
      ]),
    ])

    expect(transcript.messages.filter((message) => message.kind === 'image')).toEqual([
      { kind: 'image', mediaType: 'image/png', data: 'iVBOR' },
      { kind: 'image', mediaType: 'image/png', data: 'PNG', toolCallId: 'toolu_s' },
    ])
  })
})

describe('a hook firing', () => {
  test('follows one hook through to what it said, rather than stacking Messages', () => {
    const hook = { hook_id: 'hook-1', hook_name: 'format-on-edit', hook_event: 'PostToolUse' }
    const transcript = transcriptOf([
      { type: 'system', subtype: 'hook_started', ...hook },
      { type: 'system', subtype: 'hook_progress', ...hook, output: 'formatting…' },
      {
        type: 'system',
        subtype: 'hook_response',
        ...hook,
        outcome: 'error',
        output: 'formatted 2 files',
        stdout: 'formatted 2 files',
        stderr: 'prettier: warning',
        exit_code: 1,
      },
    ])

    expect(transcript.messages).toEqual([
      {
        kind: 'hook',
        id: 'hook-1',
        name: 'format-on-edit',
        hookEvent: 'PostToolUse',
        status: 'error',
        output: 'formatted 2 files',
        stdout: 'formatted 2 files',
        stderr: 'prettier: warning',
        exitCode: 1,
      },
    ])
  })

  test('keeps two hooks apart, and keeps an unidentified one rather than folding it', () => {
    const transcript = transcriptOf([
      { type: 'system', subtype: 'hook_started', hook_id: 'a', hook_name: 'one' },
      { type: 'system', subtype: 'hook_started', hook_id: 'b', hook_name: 'two' },
      { type: 'system', subtype: 'hook_started', hook_name: 'anonymous' },
      { type: 'system', subtype: 'hook_started', hook_name: 'anonymous' },
    ])

    expect(transcript.messages).toHaveLength(4)
  })
})

describe('what is true of the Session rather than of any one Message', () => {
  test('carries the Session id, and what the runtime actually loaded', () => {
    const transcript = transcriptOf([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
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
        slash_commands: ['commit'],
      },
    ])

    expect(transcript.sessionId).toBe('sess-1')
    expect(transcript.harness).toEqual({
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

  test('lets a later init say more about the harness without erasing what it said', () => {
    const transcript = transcriptOf([
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'opus', tools: ['Read'] },
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'sonnet' },
    ])

    expect(transcript.harness).toEqual({ model: 'sonnet', tools: ['Read'] })
  })

  test('replaces the slash commands when the runtime pushes a new list mid-Session', () => {
    const transcript = transcriptOf([
      { type: 'system', subtype: 'init', session_id: 'sess-1', slash_commands: ['commit'] },
      {
        type: 'system',
        subtype: 'commands_changed',
        commands: [{ name: 'ship', description: 'Ship it', argumentHint: '<n>', aliases: ['go'] }],
      },
    ])

    expect(transcript.commands).toEqual([
      { name: 'ship', description: 'Ship it', argumentHint: '<n>', aliases: ['go'] },
    ])
  })

  test('keeps the context meter and the subscription meter apart', () => {
    const transcript = transcriptOf([
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [] },
        context_usage: { model: 'opus', total_tokens: 120000, raw_max_tokens: 200000 },
      },
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 82 },
      },
    ])

    expect(transcript.context).toEqual({
      model: 'opus',
      totalTokens: 120000,
      maxTokens: 200000,
    })
    expect(transcript.rateLimit).toEqual({
      status: 'allowed_warning',
      limitType: 'five_hour',
      utilization: 82,
    })
  })

  test('keeps the running cost, which the runtime restates in full each Turn', () => {
    const transcript = transcriptOf([
      { type: 'result', subtype: 'success', result: 'a', total_cost_usd: 0.01 },
      { type: 'result', subtype: 'success', result: 'b', total_cost_usd: 0.05 },
    ])

    expect(transcript.cost).toEqual({ usd: 0.05 })
  })
})

describe('the agent s deliberation', () => {
  const stream = [
    assistant([
      { type: 'thinking', thinking: 'They want ' },
      { type: 'text', text: 'Here it is.' },
    ]),
    assistant([{ type: 'thinking', thinking: 'a diff.' }]),
  ]

  test('stays out of the Transcript by default, because thinking is not an answer', () => {
    expect(transcriptOf(stream).messages).toEqual([{ kind: 'text', text: 'Here it is.' }])
  })

  test('comes back in, accumulated, when it is asked for', () => {
    const transcript = reduce(
      stream.flatMap((message) => classify(message)),
      { reasoning: true },
    )

    expect(transcript.messages).toEqual([
      { kind: 'reasoning', text: 'They want ' },
      { kind: 'text', text: 'Here it is.' },
      { kind: 'reasoning', text: 'a diff.' },
    ])
  })
})

describe('what is not retained yet', () => {
  const said = (text: string, thread?: string): Frame =>
    thread === undefined ? { kind: 'text', text } : { kind: 'text', text, thread }

  test('places a live block where it opened, not after everything retained', () => {
    // The agent opened its block before the Thread's Frame was retained, so it
    // stays ahead of it. Appended after the log instead — which is what the
    // hook used to do — the two swap the moment the Thread finishes first.
    const transcript = reduce([{ kind: 'prompt', text: 'audit both' }, said('Reading.', 'call-1')], {
      pending: [{ kind: 'text', text: 'Opening two', after: 1 }],
    })

    expect(transcript.messages).toEqual([
      { kind: 'prompt', text: 'audit both' },
      { kind: 'text', text: 'Opening two' },
      { kind: 'text', text: 'Reading.', thread: 'call-1' },
    ])
  })

  test('keeps a person\'s unretained words above the answer to them', () => {
    // The bug this was found by: send "hi", and the agent's reply arrived
    // *above* it. Words the person sent are not the newest thing on screen the
    // moment the agent starts answering — they were sent before the answer, and
    // they belong where they were sent.
    const transcript = reduce([said('Hello there.')], {
      pending: [{ kind: 'prompt', text: 'hi', after: 0 }],
    })

    expect(transcript.messages).toEqual([
      { kind: 'prompt', text: 'hi' },
      { kind: 'text', text: 'Hello there.' },
    ])
  })

  test('keeps unretained things in the order they happened', () => {
    // A person typing while the agent writes. Both are waiting on the log, and
    // neither is automatically the newer — so the order they are given in is
    // the order they happened in, and nothing here second-guesses it.
    const pending: Pending[] = [
      { kind: 'text', text: 'Working on it', after: 0 },
      { kind: 'prompt', text: 'actually, stop', after: 0 },
    ]
    const transcript = reduce([], { pending })

    expect(transcript.messages.map((message) => message.kind)).toEqual(['text', 'prompt'])
  })

  test('never grows a live block with a Frame that is not its own', () => {
    // Prose coalesces into the Message before it. A block still being written
    // is not one a Frame may grow: the Frame is the whole of its own block and
    // the live copy is about to be dropped, so merging puts one block's words
    // on the front of another's.
    const transcript = reduce([said('First.')], {
      pending: [{ kind: 'text', text: 'Sec', after: 0 }],
    })

    expect(transcript.messages).toEqual([
      { kind: 'text', text: 'Sec' },
      { kind: 'text', text: 'First.' },
    ])
  })

  test('holds a live deliberation back unless it is asked for', () => {
    const pending = [{ kind: 'reasoning', text: 'Hmm', after: 0 } as const]

    expect(reduce([], { pending }).messages).toEqual([])
    expect(reduce([], { pending, reasoning: true }).messages).toEqual([
      { kind: 'reasoning', text: 'Hmm' },
    ])
  })

  test('says the Turn is working while the person\'s words are still in flight', () => {
    const transcript = reduce([said('Done.')], { pending: [{ kind: 'prompt', text: 'and again', after: 1 }] })

    expect(transcript.turn).toEqual({ status: 'working' })
  })

  test('leaves a Transcript with nothing pending exactly as it was', () => {
    const frames: Frame[] = [{ kind: 'prompt', text: 'hello' }, said('Hi.')]

    expect(reduce(frames, { pending: [] })).toEqual(reduce(frames))
  })
})
