import { describe, expect, test } from 'bun:test'

import { arrange, threadOf, threadsOf, type ThreadSource } from './thread.ts'
import type { Message } from './transcript.ts'

/**
 * Threads as relations, with nothing drawing them.
 *
 * These ran only through a mounted `ClaudeSession` before: asking whether a
 * Thread whose opening call is missing keeps its Messages meant replaying a
 * 37-Frame golden log and counting DOM nodes, and the case the rule was written
 * for could not be reached at all.
 */
function task(id: string, description: string, status: 'pending' | 'success' | 'error'): Message {
  return {
    kind: 'tool-call',
    id,
    name: 'Task',
    input: { description, subagent_type: 'Explore' },
    status,
    opens: { thread: id, description, subagentType: 'Explore' },
  }
}

function ran(id: string, thread: string): Message {
  return { kind: 'tool-call', id, name: 'Read', input: {}, status: 'success', thread }
}

function said(text: string, thread?: string): Message {
  return thread === undefined ? { kind: 'text', text } : { kind: 'text', text, thread }
}

const MESSAGES: Message[] = [
  said('Opening two.'),
  task('call-1', 'audit core', 'success'),
  task('call-2', 'audit ui', 'pending'),
  said('Reading.', 'call-1'),
  ran('read-1', 'call-1'),
  ran('grep-1', 'call-2'),
  said('Two are back.'),
]

describe('placing a Thread’s Messages', () => {
  test('inline leaves every Message where it is, with its index', () => {
    expect(arrange(MESSAGES, 'inline').map((one) => one.at)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(arrange(MESSAGES, 'inline').every((one) => one.nested === undefined)).toBe(true)
  })

  test('nested hangs a Thread’s Messages off the call that opened them', () => {
    const arranged = arrange(MESSAGES, 'nested')

    // The main agent's own work stays in the Transcript; the Threads' work is
    // under the two `Task` calls rather than beside them.
    expect(arranged.map((one) => one.at)).toEqual([0, 1, 2, 6])
    expect(arranged[1]?.nested?.map((one) => one.at)).toEqual([3, 4])
    expect(arranged[2]?.nested?.map((one) => one.at)).toEqual([5])
  })

  test('hidden drops the Threads’ work and keeps the calls that opened it', () => {
    // A chat view showing the main agent alone still has to say that work was
    // delegated, or three sub-agents' worth of effort is simply missing.
    const arranged = arrange(MESSAGES, 'hidden')

    expect(arranged.map((one) => one.at)).toEqual([0, 1, 2, 6])
    expect(arranged.every((one) => one.nested === undefined)).toBe(true)
  })

  test('keeps a Thread nobody on screen opened in Transcript order', () => {
    // A log truncated before the `Task` call, or resumed after it. The Thread
    // is real and its Messages are on the wire, but there is no parent here to
    // hang them off — so they stay where they are rather than being lost to a
    // call that is not there. Unreachable through a rendered container without
    // hand-authoring a Frame log, which is why it went untested.
    const orphaned: Message[] = [said('Reading.', 'call-9'), ran('read-9', 'call-9'), said('Done.')]

    for (const display of ['nested', 'hidden'] as const) {
      expect(arrange(orphaned, display).map((one) => one.at)).toEqual([0, 1, 2])
    }
  })
})

describe('reading a Thread', () => {
  const source: ThreadSource = {
    messages: MESSAGES,
    threadContext: { 'call-1': { totalTokens: 7400 } },
  }

  test('reports every Thread in the order it was opened', () => {
    expect(threadsOf(source).map((one) => [one.thread, one.ordinal, one.description])).toEqual([
      ['call-1', 1, 'audit core'],
      ['call-2', 2, 'audit ui'],
    ])
  })

  test('counts what each Thread did, and only what it did', () => {
    // The `Task` calls themselves are the main agent's work, so they are not
    // counted against the Threads they opened.
    expect(threadsOf(source).map((one) => one.toolCalls)).toEqual([1, 1])
  })

  test('takes each Thread’s state from its own call, never the Turn’s', () => {
    // A Turn runs many Threads and they do not all end together. Keyed to the
    // Turn, one Thread finishing would stop all three meters.
    expect(threadsOf(source).map((one) => one.state)).toEqual(['settled', 'running'])
    expect(
      threadsOf({ ...source, messages: [task('call-3', 'audit server', 'error')] })[0]?.state,
    ).toBe('failed')
  })

  test('shows a window only for the Thread that reported one', () => {
    // Not a zero for the others: a Thread that has said nothing about its
    // window has said nothing, and a 0 is a reading (#17).
    expect(threadsOf(source).map((one) => one.contextTokens)).toEqual([7400, undefined])
  })
})

describe('which Thread a Message belongs to', () => {
  test('names the Thread for a Message that can carry one', () => {
    expect(threadOf(said('Reading.', 'call-1'))).toBe('call-1')
  })

  test('says nothing for the agent’s own work, and for a kind with no Thread', () => {
    expect(threadOf(said('Opening two.'))).toBeUndefined()
    expect(threadOf({ kind: 'reset', transcriptId: 'conv-2' })).toBeUndefined()
  })
})
