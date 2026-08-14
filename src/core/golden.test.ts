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

  /**
   * What a Message is, as against what it currently says. A Frame arriving can
   * change what a Message says — prose grows, a call stops being pending — but
   * it must never change which Message sits at an index.
   */
  function placements(frames: Frame[]): string[] {
    return reduce(frames).messages.map((message) =>
      'id' in message && message.id !== undefined ? `${message.kind}:${message.id}` : message.kind,
    )
  }

  /** What a client holds after each Frame of the log has arrived. */
  const growth = golden.map((_frame, at) => placements(golden.slice(0, at + 1)))

  test('never moves a Message it has already placed, however much of the log has arrived', () => {
    // A client re-reduces as each Frame arrives. Every one of those Transcripts
    // must extend the last rather than rearrange it: if an index meant one
    // Message now and a different one after the next Frame, resuming an SSE
    // stream at a Frame index would land a viewer somewhere nobody was.
    const shifted = growth.filter((later, at) =>
      (growth[at - 1] ?? []).some((placement, index) => later[index] !== placement),
    )

    expect(shifted).toEqual([])
    // Non-vacuity: the log really does build the whole Transcript this way.
    expect(growth.at(-1)).toEqual(placements(golden))
    expect(growth.at(-1)).toHaveLength(20)
  })

  test('patches a Message in place rather than appending a second one', () => {
    // The half of append-and-patch-the-tail the test above cannot see: without
    // it, "never moves a Message" would hold trivially by appending forever. A
    // patch is a Frame that leaves the placements alone and still changes what
    // a Message says — which is what tells it apart from a Frame that only
    // moves the Session's own state along.
    const said = golden.map((_frame, at) => JSON.stringify(reduce(golden.slice(0, at + 1)).messages))
    const patches = golden.filter((_frame, at) => {
      const before = growth[at - 1] ?? []
      return at > 0 && before.length === growth[at]?.length && said[at] !== said[at - 1]
    })

    expect(patches.map((frame) => frame.kind).sort()).toEqual([
      'hook',
      'hook',
      'text',
      'tool-result',
      'tool-result',
      'tool-result',
      'tool-result',
    ])
  })

  test('takes a log that starts mid-Session without inventing what it missed', () => {
    // What a client gets when the log is truncated before the calls: results
    // answering Messages that are not there. They attach to nothing rather than
    // conjuring a call nobody saw start.
    const from = golden.findIndex((frame) => frame.kind === 'tool-result')
    const tail = golden.slice(from)
    const opened = tail.flatMap((frame) => (frame.kind === 'tool-call' ? [frame.id] : []))
    const orphaned = tail.filter(
      (frame) => frame.kind === 'tool-result' && !opened.includes(frame.id),
    )

    // Non-vacuity: this slice really does answer calls it never saw open.
    expect(orphaned.length).toBeGreaterThan(0)
    expect(
      reduce(tail)
        .messages.filter((message) => message.kind === 'tool-call')
        .map((call) => call.id),
    ).toEqual(opened)
  })
})
