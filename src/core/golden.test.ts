import { describe, expect, test } from 'bun:test'

import { classify, type ClassifyInput } from './classify.ts'
import type { Frame } from './frame.ts'
import { reduce } from './reduce.ts'

/**
 * The primary seam, end to end: a recorded SDK stream through `classify` into a
 * coalesced Frame log, and that log through `reduce` into a Transcript.
 *
 * The Frame log is a committed golden file rather than an inline literal
 * because the same artifact is the wire format, the reconnect payload and the
 * playground's driver. A regression localises to "classify changed" if the
 * golden file disagrees, and to "reduce changed" if it does not but the
 * Transcript does.
 *
 * Rewrite the golden file after a deliberate change with
 * `UPDATE_GOLDEN=1 bun test src`, and read the diff before committing it.
 */
const HERE = new URL('.', import.meta.url).pathname
const MESSAGES = `${HERE}fixtures/session.messages.json`
const FRAMES = `${HERE}fixtures/session.frames.json`

const stream: ClassifyInput[] = await Bun.file(MESSAGES).json()

if (Bun.env['UPDATE_GOLDEN'] === '1') {
  const regenerated = stream.flatMap((message) => classify(message))
  await Bun.write(FRAMES, `${JSON.stringify(regenerated, null, 2)}\n`)
}

const golden: Frame[] = await Bun.file(FRAMES).json()

describe('the golden Frame log', () => {
  test('is what classify makes of the recorded stream', () => {
    expect(stream.flatMap((message) => classify(message))).toEqual(golden)
  })

  test('exercises every Frame kind, so a new one cannot arrive untested', () => {
    // Adding a Frame kind breaks this literal at typecheck, before the run.
    const vocabulary: Record<Frame['kind'], true> = {
      session: true,
      harness: true,
      commands: true,
      prompt: true,
      text: true,
      reasoning: true,
      'tool-call': true,
      'tool-result': true,
      image: true,
      settled: true,
      failed: true,
      cost: true,
      compacted: true,
      reset: true,
      recall: true,
      context: true,
      'rate-limit': true,
      hook: true,
    }

    const kinds = Object.keys(vocabulary) as Frame['kind'][]

    expect([...new Set(golden.map((frame) => frame.kind))].sort()).toEqual(kinds.sort())
  })

  test('reduces to the Transcript a viewer sees', () => {
    const transcript = reduce(golden)

    expect(transcript.messages.map((message) => message.kind)).toEqual([
      'prompt',
      'text',
      'tool-call',
      'text',
      'tool-call',
      'hook',
      'tool-call',
      'tool-call',
      'image',
      'recall',
      'compacted',
      'text',
      'outcome',
      'image',
      'prompt',
      'text',
      'outcome',
      'prompt',
      'outcome',
      'reset',
    ])
  })

  test('names the Session, the harness and the commands last advertised', () => {
    const transcript = reduce(golden)

    expect(transcript.sessionId).toBe('sess-golden')
    expect(transcript.harness).toMatchObject({
      model: 'claude-opus-4',
      permissionMode: 'bypassPermissions',
      plugins: [{ name: 'claude-mem', path: '/plugins/claude-mem', version: '1.4.0' }],
    })
    expect(transcript.commands.map((command) => command.name)).toEqual(['commit', 'ship'])
  })

  test('stands on the last Turn s state, and on the latest word from each meter', () => {
    const transcript = reduce(golden)

    expect(transcript.turn).toEqual({
      status: 'failed',
      subtype: 'error_max_turns',
      reason: 'Reached the maximum number of turns',
    })
    expect(transcript.cost).toMatchObject({ usd: 1.51 })
    expect(transcript.context).toMatchObject({ totalTokens: 44000, maxTokens: 200000 })
    expect(transcript.rateLimit).toMatchObject({ status: 'allowed_warning', utilization: 82 })
  })

  test('answers every call it opened, and shows the interrupt as idle', () => {
    const transcript = reduce(golden)
    const calls = transcript.messages.filter((message) => message.kind === 'tool-call')
    const outcomes = transcript.messages.filter((message) => message.kind === 'outcome')

    expect(calls.map((call) => [call.id, call.status])).toEqual([
      ['toolu_task', 'success'],
      ['toolu_read', 'success'],
      ['toolu_edit', 'success'],
      ['toolu_shot', 'success'],
    ])
    expect(outcomes.map((outcome) => outcome.outcome)).toEqual([
      'settled',
      'interrupted',
      'failed',
    ])
  })
})

describe('replay', () => {
  test('produces an identical Transcript however many times the log is replayed', () => {
    expect(reduce(golden)).toEqual(reduce(golden))
    expect(JSON.stringify(reduce(golden))).toBe(JSON.stringify(reduce(golden)))
  })

  test('leaves the Frame log it replayed exactly as it found it', () => {
    const before = JSON.stringify(golden)

    reduce(golden)
    reduce(golden)

    expect(JSON.stringify(golden)).toBe(before)
  })

  test('reaches the same Transcript whether the log arrives whole or in two halves', () => {
    const half = Math.floor(golden.length / 2)
    const resumed = reduce([...golden.slice(0, half), ...golden.slice(half)])

    expect(resumed).toEqual(reduce(golden))
  })
})
