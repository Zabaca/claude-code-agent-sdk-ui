import { describe, expect, test } from 'bun:test'

import { classify, type ClassifyInput } from './classify.ts'
import { reduce } from './reduce.ts'
import type { Transcript } from './transcript.ts'

/** The seam under test: fixture SDK messages in, Transcript out. */
function transcriptOf(stream: ClassifyInput[]): Transcript {
  return reduce(stream.flatMap((message) => classify(message)))
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
