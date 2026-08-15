'use client'

import * as React from 'react'

import {
  arrange,
  threadOf,
  threadsOf,
  type Arranged,
  type ThreadDisplay,
  type ThreadReading,
  type ThreadSource,
  type ThreadState,
} from '../core/thread.ts'
import { cn } from './lib/cn.ts'

/**
 * Re-exported so a host drawing its own Transcript still finds them here. They
 * live in `core` because they draw nothing — see the note there.
 */
export {
  arrange,
  threadOf,
  threadsOf,
  type Arranged,
  type ThreadDisplay,
  type ThreadReading,
  type ThreadSource,
  type ThreadState,
}

/**
 * Threads — sub-agent work made legible.
 *
 * A Thread is the line of work opened by a `Task` call, identified by that
 * call's `tool_use` id. The Transcript is flat and every Message carries the
 * Thread it belongs to, which is exactly what lets three background agents run
 * at once without their tool calls landing on screen as the main agent's.
 *
 * The drawing half. What a Thread *is* — which ones a Transcript opened, which
 * Messages belong to one, what each has done — is `core/thread.ts`; what is
 * here turns that into a screen: the hues that tell three Threads apart, the
 * meter, and the clock behind it.
 *
 * ## What the meter can honestly say
 *
 * **Elapsed** is measured by this renderer, because no Frame carries a
 * timestamp. It is therefore "how long this screen has been watching", and it
 * is only claimed for a Thread whose opening call this screen saw *pending*. A
 * Thread that was already finished when the log was replayed gets no duration
 * at all rather than a fabricated `0s`. A Thread this screen joined mid-flight
 * — a reload while a sub-agent is running — is timed from first sight, so its
 * duration is a lower bound. Closing that needs a timestamp on the wire, which
 * is a spec change rather than a fix here.
 *
 * The context figure a meter draws is the Thread's window, not its spend. The
 * note in `core/thread.ts` says why that distinction is load-bearing.
 */


/**
 * The clock the meter runs on.
 *
 * Injectable for the same reason the transport is: a duration driven by the
 * wall clock is a duration a test cannot pin. `core` is pure and carries no
 * timestamps, so this clock is the renderer's own and is the only thing in the
 * package that reads the time.
 */
export type ThreadClock = {
  now(): number
  /** Calls back while a Thread is running. Returns how to stop. */
  tick(onTick: () => void): () => void
}

export const REAL_CLOCK: ThreadClock = {
  now: () => Date.now(),
  tick: (onTick) => {
    const id = setInterval(onTick, 1000)
    return () => clearInterval(id)
  },
}

/** What this screen has watched of one Thread. */
type Watch = {
  /** When it was first seen running. Absent if it was over by then. */
  from?: number
  /** When it stopped running, once it has. */
  to?: number
}

/**
 * The Threads, with the elapsed time this screen can stand behind.
 *
 * A Thread first seen already finished gets no duration: the log replayed in
 * one burst, so the only honest answer is that this screen never watched it
 * run. A running Thread's duration ticks until its `Task` call answers, and is
 * then frozen — a finished Thread that kept counting would read as still
 * working.
 */
export function useThreads(
  transcript: ThreadSource,
  clock: ThreadClock = REAL_CLOCK,
): ThreadReading[] {
  const readings = threadsOf(transcript)
  const watched = React.useRef(new Map<string, Watch>())
  const [, redraw] = React.useState(0)
  const running = readings.some((reading) => reading.state === 'running')

  const now = clock.now()
  for (const reading of readings) {
    const seen = watched.current.get(reading.thread)
    if (seen === undefined) {
      // First sight. Only a Thread seen while it was still running has a start
      // this screen witnessed; one that arrived finished has none, and gets no
      // duration rather than a fabricated zero.
      watched.current.set(
        reading.thread,
        reading.state === 'running' ? { from: now } : { to: now },
      )
      continue
    }
    if (reading.state !== 'running' && seen.to === undefined) seen.to = now
  }

  React.useEffect(() => {
    if (!running) return
    return clock.tick(() => redraw((count) => count + 1))
  }, [running, clock])

  return readings.map((reading) => {
    // The runtime's reading wins wherever it exists: it is measured, and this
    // screen's is inferred from when it happened to start watching. That is
    // the whole of the mid-flight gap — a Thread ninety seconds in that this
    // screen only just met reads as ninety seconds, not as nothing.
    if (reading.reportedMs !== undefined) {
      return { ...reading, elapsedMs: reading.reportedMs }
    }
    const seen = watched.current.get(reading.thread)
    if (seen?.from === undefined) return reading
    return { ...reading, elapsedMs: (seen.to ?? now) - seen.from }
  })
}

/**
 * The meters, one per Thread — what each background agent was asked to do and
 * how it is getting on.
 *
 * Every Thread is listed, running or not, because a Thread that has finished is
 * still part of what happened: dropping it the moment it ends would make the
 * one thing a viewer wants to check — what the sub-agent actually did — leave
 * the screen at exactly the moment they went looking for it.
 */
export function ThreadMeters({
  threads,
  className,
}: {
  threads: readonly ThreadReading[]
  className?: string
}) {
  if (threads.length === 0) return null
  return (
    <div
      role="group"
      aria-label="Threads"
      className={cn('cc:flex cc:min-w-0 cc:flex-col cc:gap-1', className)}
    >
      {threads.map((thread) => (
        <ThreadMeter key={thread.thread} thread={thread} />
      ))}
    </div>
  )
}

const GLYPH: Record<ThreadState, string> = { running: '⏺', settled: '✓', failed: '✗' }
const SAID: Record<ThreadState, string> = {
  running: 'running',
  settled: 'complete',
  failed: 'failed',
}

function ThreadMeter({ thread }: { thread: ThreadReading }) {
  const hue = thread.state === 'failed' ? 'var(--cc-error)' : hueOf(thread.ordinal)
  return (
    <div
      data-thread-meter={thread.thread}
      data-thread-state={thread.state}
      data-thread-tools={thread.toolCalls}
      className="cc:flex cc:min-w-0 cc:flex-wrap cc:items-baseline cc:gap-2"
      style={{ color: 'var(--cc-fg-muted)' }}
    >
      <span aria-hidden className="cc:shrink-0" style={{ color: hue }}>
        {GLYPH[thread.state]}
      </span>
      <span className="cc:min-w-0 cc:break-words" style={{ color: 'var(--cc-fg)' }}>
        {thread.description ?? thread.thread}
      </span>
      {thread.subagentType === undefined ? null : (
        <span style={{ color: hue }}>({thread.subagentType})</span>
      )}
      <span className="cc:sr-only">{SAID[thread.state]}</span>
      <span aria-hidden>·</span>
      <span data-thread-tool-calls={thread.toolCalls}>
        {thread.toolCalls} {thread.toolCalls === 1 ? 'tool call' : 'tool calls'}
      </span>
      {thread.elapsedMs === undefined ? null : (
        <>
          <span aria-hidden>·</span>
          <span data-thread-elapsed={thread.elapsedMs}>{lasting(thread.elapsedMs)}</span>
        </>
      )}
      {/* Called "context", not "tokens", because that is what it is: how much
          of its own window the Thread is holding. Cumulative spend per Thread
          is not on the wire, and labelling one as the other would be the
          screen naming a number after something it did not measure. A Thread
          that has reported no window shows nothing here rather than a zero. */}
      {thread.contextTokens === undefined ? null : (
        <>
          <span aria-hidden>·</span>
          <span data-thread-context={thread.contextTokens} title="context window in use">
            {thousands(thread.contextTokens)} context
          </span>
        </>
      )}
    </div>
  )
}

/**
 * The marker on a Message that belongs to a Thread.
 *
 * The ordinal and the colour are what keep three concurrent Threads apart at a
 * glance; the meter above is the legend that says which is which. The full
 * description is on the marker for a screen reader, which has no colour to read.
 */
export function ThreadTag({ thread }: { thread: ThreadReading }) {
  return (
    <div
      className="cc:flex cc:min-w-0 cc:items-baseline cc:gap-1 cc:text-[11px]"
      style={{ color: hueOf(thread.ordinal) }}
      title={thread.description ?? thread.thread}
    >
      <span aria-hidden>↳{thread.ordinal}</span>
      <span className="cc:min-w-0 cc:truncate">{thread.description ?? thread.thread}</span>
    </div>
  )
}

/**
 * A Thread's colour, from the tokens the theme already ships. Four, cycled: a
 * fifth concurrent Thread repeats a colour, which the ordinal beside it and the
 * meter above it both disambiguate.
 */
const HUES = [
  'var(--cc-info)',
  'var(--cc-accent-bright)',
  'var(--cc-todo-done)',
  'var(--cc-mode-plan)',
]

export function hueOf(ordinal: number): string {
  return HUES[(ordinal - 1) % HUES.length] as string
}

/** A token count, the way a terminal says it: `840`, `7.4k`, `190k`. */
export function thousands(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  const thousand = tokens / 1000
  return `${thousand < 100 ? trimmed(thousand.toFixed(1)) : String(Math.round(thousand))}k`
}

function trimmed(fixed: string): string {
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

/** How long, the way a terminal says it. */
export function lasting(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
