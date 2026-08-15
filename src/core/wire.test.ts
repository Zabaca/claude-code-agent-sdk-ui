import { describe, expect, test } from 'bun:test'

import type { Frame } from './frame.ts'
import type { PartialText } from './partial.ts'
import { decodeEvents, frameEvent, partialEvent, resumeFrom } from './wire.ts'

const said: Frame = { kind: 'text', text: 'hello' }
const streaming: PartialText = { block: 0, kind: 'text', text: 'hel' }

describe('what an event carries', () => {
  test('names a Frame by its index in the log', () => {
    // The `id:` is the index and nothing else: it is what a browser sends back
    // as `Last-Event-ID`, so anything else there resumes somewhere nobody was.
    expect(frameEvent(said, 7)).toBe(`id: 7\nevent: frame\ndata: {"kind":"text","text":"hello"}\n\n`)
  })

  test('gives a partial no id at all', () => {
    // A partial must never move the browser's cursor: it is not retained, so a
    // reconnect that resumed past one would skip a Frame that was.
    expect(partialEvent(streaming)).not.toContain('id:')
    expect(partialEvent(streaming)).toBe(
      `event: partial\ndata: {"block":0,"kind":"text","text":"hel"}\n\n`,
    )
  })
})

describe('resuming', () => {
  test('starts from the beginning when the browser names nothing', () => {
    // Three spellings of "no cursor": a header absent, a header empty, and a
    // fake with no header to read.
    expect(resumeFrom(null)).toBe(0)
    expect(resumeFrom('')).toBe(0)
    expect(resumeFrom(undefined)).toBe(0)
  })

  test('resumes with the Frame after the last one that landed', () => {
    expect(resumeFrom('0')).toBe(1)
    expect(resumeFrom('7')).toBe(8)
  })

  test('starts over rather than trusting a cursor it cannot read', () => {
    // Replaying from 0 costs a duplicate the hook already discards. Trusting a
    // number nobody wrote loses Frames outright.
    expect(resumeFrom('abc')).toBe(0)
    expect(resumeFrom('-1')).toBe(0)
    expect(resumeFrom('1.5')).toBe(0)
  })
})

describe('reading events back off the wire', () => {
  test('reads back exactly what was written', () => {
    const { events, rest } = decodeEvents(frameEvent(said, 7))

    expect(rest).toBe('')
    expect(events).toEqual([{ id: '7', name: 'frame', data: '{"kind":"text","text":"hello"}' }])
  })

  test('the encoder and the cursor agree', () => {
    // The property the two halves have to share: what the encoder wrote as an
    // id is what the cursor reads back, so the next Frame is the one after it.
    const [event] = decodeEvents(frameEvent(said, 7)).events

    expect(resumeFrom(event?.id ?? null)).toBe(8)
  })

  test('holds back a block that has not finished arriving', () => {
    // A chunk boundary falls wherever the network puts it, never on an event.
    const whole = frameEvent(said, 0) + frameEvent(said, 1)
    const { events, rest } = decodeEvents(whole.slice(0, whole.length - 4))

    expect(events).toHaveLength(1)
    expect(events[0]?.id).toBe('0')
    expect(decodeEvents(rest + whole.slice(whole.length - 4)).events[0]?.id).toBe('1')
  })

  test('reads a field written without the optional space', () => {
    // `data:x` and `data: x` are the same field. Splitting on a literal
    // `'data: '` reads the first as nothing at all.
    expect(decodeEvents('event:frame\ndata:{"kind":"reset"}\n\n').events).toEqual([
      { name: 'frame', data: '{"kind":"reset"}' },
    ])
  })

  test('joins a data field written across several lines', () => {
    expect(decodeEvents('event: frame\ndata: {"kind":\ndata: "reset"}\n\n').events).toEqual([
      { name: 'frame', data: '{"kind":\n"reset"}' },
    ])
  })

  test('ignores a comment and an event with no data', () => {
    expect(decodeEvents(': keep-alive\n\nevent: frame\n\n').events).toEqual([])
  })
})
