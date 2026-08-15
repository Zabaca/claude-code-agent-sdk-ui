/**
 * The Frame log as an SSE stream: how a Frame becomes an event, and how a
 * browser's `Last-Event-ID` becomes the place to carry on from.
 *
 * Here rather than in the server for the reason {@link ./partial.ts} gives: the
 * handler writes this and the browser's stand-ins read it, and neither should
 * have to depend on the other to agree about it. The rule that matters is that
 * an event's `id:` *is* the Frame's index in the log — the wire format, the
 * reconnect payload and the resume cursor are three readings of one number, and
 * a copy of that rule per reader is a copy that can drift silently.
 *
 * No socket and no clock: this is string work, and a test can hold both halves
 * to it without opening anything.
 */

import type { Frame } from './frame.ts'
import type { PartialText } from './partial.ts'

/** One event as it arrived, before anything has been made of its `data`. */
export type WireEvent = {
  /** Absent on an event that carries no `id:` — a partial, or a comment. */
  id?: string
  /** The `event:` field; `message` when the wire did not name one. */
  name: string
  data: string
}

/** A retained Frame, named by its index — which is the resume cursor. */
export function frameEvent(frame: Frame, index: number): string {
  return `id: ${index}\nevent: frame\ndata: ${JSON.stringify(frame)}\n\n`
}

/**
 * No `id:`, so a partial never moves the browser's resume cursor. It is not
 * retained, so resuming past one would skip a Frame that was.
 */
export function partialEvent(partial: PartialText): string {
  return `event: partial\ndata: ${JSON.stringify(partial)}\n\n`
}

/**
 * `Last-Event-ID` names the last Frame that landed; resume with the next one.
 *
 * Anything unreadable starts over rather than being trusted: replaying from 0
 * costs a duplicate the hook already discards, while carrying on from a number
 * nobody wrote loses Frames outright.
 */
export function resumeFrom(lastEventId: string | null | undefined): number {
  if (lastEventId === null || lastEventId === undefined || lastEventId === '') return 0
  const last = Number.parseInt(lastEventId, 10)
  return Number.isInteger(last) && last >= 0 && String(last) === lastEventId.trim() ? last + 1 : 0
}

/**
 * Whole events off a buffer, and whatever is left of the one still arriving.
 * A chunk boundary falls wherever the network puts it, so the caller keeps
 * `rest` and hands it back with the next chunk.
 */
export function decodeEvents(buffered: string): { events: WireEvent[]; rest: string } {
  const events: WireEvent[] = []
  let rest = buffered

  for (;;) {
    const at = rest.indexOf('\n\n')
    if (at === -1) return { events, rest }
    const event = decodeEvent(rest.slice(0, at))
    rest = rest.slice(at + 2)
    if (event) events.push(event)
  }
}

/** One event's fields. `undefined` for a comment, or anything with no data. */
function decodeEvent(raw: string): WireEvent | undefined {
  let id: string | undefined
  let name = 'message'
  const data: string[] = []

  for (const line of raw.split('\n')) {
    const at = line.indexOf(':')
    // A line starting with a colon is a comment; one with no colon is a field
    // with an empty value, and none of the three fields read here has a use
    // for that.
    if (at <= 0) continue
    const field = line.slice(0, at)
    // The single space after the colon is optional, and is part of the framing
    // rather than of the value.
    const value = line.slice(at + 1).replace(/^ /, '')
    if (field === 'id') id = value
    if (field === 'event') name = value
    if (field === 'data') data.push(value)
  }

  if (data.length === 0) return undefined
  // Several `data:` lines are one value with the newlines put back.
  return id === undefined ? { name, data: data.join('\n') } : { id, name, data: data.join('\n') }
}
