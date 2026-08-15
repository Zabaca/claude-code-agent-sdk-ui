import { expect, test } from 'bun:test'

import { reduce } from '../core/reduce.ts'
import { OPENING } from './script.ts'

/**
 * What the script says, with nothing playing it.
 *
 * These ran through the transport's test file before the two were split, which
 * meant asking "does the demo still show a failed tool call" loaded
 * `createEventSource`, a mount and a clock. The script is data; a question
 * about the data is answered by reducing it.
 */
const dir = new URL('.', import.meta.url).pathname

test('the script reaches for no transport', async () => {
  // The seam, asserted rather than assumed. It may name the transport's types —
  // a beat is defined by what plays it — but reaching for its code would put
  // the machinery back behind every ticket that adds a case.
  const text = await Bun.file(`${dir}script.ts`).text()
  const reaching = text.split('\n').filter((line) => line.includes("from './replay.ts'"))

  expect(reaching).toEqual(["import type { Beat, ReplayScript } from './replay.ts'"])
})

test('the opening log shows prose and a tool call in every state it has', async () => {
  // A guard for the tickets that add their own case here: trimming the script
  // to prose would quietly turn the demo into a demo of less.
  const transcript = reduce(OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : [])))
  const kinds = transcript.messages.map((message) => message.kind)
  const statuses = transcript.messages.flatMap((message) =>
    message.kind === 'tool-call' ? [message.status] : [],
  )

  expect(kinds).toContain('prompt')
  expect(kinds).toContain('text')
  expect(statuses).toContain('success')
  expect(statuses).toContain('error')
  expect(transcript.turn).toEqual({ status: 'idle' })
})

test('the opening log advertises commands, and changes them while it runs', async () => {
  // The same guard, for this ticket's case. A demo that showed bare names would
  // be a demo of exactly the thing the menu already had before #11 — the point
  // is the hint and the aliases — and one that advertised a list and never
  // touched it would leave `commands_changed` claimed but never shown.
  const frames = OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : []))
  const advertised = frames.filter((frame) => frame.kind === 'commands')
  expect(advertised.length).toBeGreaterThan(1)

  const last = reduce(frames).commands
  expect(last.some((command) => command.argumentHint !== undefined)).toBe(true)
  expect(last.some((command) => (command.aliases?.length ?? 0) > 0)).toBe(true)

  // REPLACE semantics, so the later list is the one that stands — and it is not
  // the one `init` gave, or nothing was demonstrated.
  expect(last.map((command) => command.name)).not.toEqual(
    advertised[0]?.kind === 'commands' ? advertised[0].commands.map((one) => one.name) : [],
  )
})

test('the opening log meters the context as it fills, and the week separately', async () => {
  // The same guard, for this ticket's case. The working line's count is the one
  // number on screen that moves on its own, so a script that never metered the
  // context would leave it permanently blank and the demo would look correct.
  const frames = OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : []))
  const readings = frames.flatMap((frame) => (frame.kind === 'context' ? [frame.totalTokens] : []))

  expect(readings.length).toBeGreaterThan(1)
  // Readings that never differ are a meter nobody can tell from a frozen one.
  expect(new Set(readings).size).toBeGreaterThan(1)

  // At least one lands before the Turn it belongs to has ended. A count that
  // only arrived with the result would sit blank for the whole of the one
  // stretch of time the working line is on screen.
  const ended = frames.findIndex((frame) => frame.kind === 'settled' || frame.kind === 'failed')
  const first = frames.findIndex((frame) => frame.kind === 'context')
  expect(first).toBeGreaterThan(-1)
  expect(first).toBeLessThan(ended)

  // The count falls across the compaction, which is the fact the meter exists
  // to show: the Transcript above the marker is unchanged while the window the
  // agent is working from has just been emptied.
  const at = frames.findIndex((frame) => frame.kind === 'compacted')
  const before = frames.slice(0, at).flatMap((f) => (f.kind === 'context' ? [f.totalTokens] : []))
  const after = frames.slice(at).flatMap((f) => (f.kind === 'context' ? [f.totalTokens] : []))
  expect(after[0]).toBeLessThan(before.at(-1) ?? 0)

  // The other meter, played and kept apart. Different clocks, different
  // questions — and no chrome for either in v0.1, so `reduce` is where a
  // reviewer can see they did not blend.
  const transcript = reduce(frames)
  expect(transcript.rateLimit?.utilization).toBeDefined()
  expect(transcript.context?.totalTokens).toBe(readings.at(-1))
  expect(transcript.context?.totalTokens).not.toBe(transcript.rateLimit?.utilization)
})
