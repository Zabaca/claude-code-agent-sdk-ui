import type { Message, ToolCallMessage, Transcript } from './transcript.ts'

/**
 * Threads, as relations over a Transcript.
 *
 * A Thread is the line of work opened by a `Task` call, identified by that
 * call's `tool_use` id. The Transcript is flat and every Message carries the
 * Thread it belongs to, which is exactly what lets three background agents run
 * at once without their tool calls landing on screen as the main agent's.
 *
 * Here rather than in `ui` because none of it draws anything: which Threads a
 * Transcript opened, which Messages belong to one, and what each has done are
 * facts about the Transcript, answerable without a DOM and without React. The
 * clock, the hues and the meter are the renderer's, and stay there.
 *
 * ## What can honestly be said
 *
 * A Thread's identity, description, subagent type, context window and — by
 * counting — its tool calls. One number needs saying precisely, because the
 * near miss is a screen that looks measured and is not: **tokens** here are the
 * Thread's **context window**, how much it is currently holding, from the
 * `context_usage` the SDK hangs off an assistant message that names its Thread.
 * That is not cumulative spend. Spend per Thread does not exist on the wire —
 * `CostFrame.usage` is the main loop and `byModel` is per-model, Session-wide
 * and only at Turn end — so the figure is labelled "context" rather than
 * "tokens", and a Thread that has reported no reading shows no figure at all
 * rather than a zero.
 *
 * Elapsed time is not here at all: no Frame carries a timestamp, so a duration
 * can only be what a renderer watched. That reading belongs to the thing doing
 * the watching.
 */

/** How a Thread's Messages are placed in the Transcript. */
export type ThreadDisplay =
  /** In Transcript order, each marked with the Thread it belongs to. */
  | 'inline'
  /** Grouped under the `Task` call that opened them. */
  | 'nested'
  /** Left out, so a chat view can show the main agent's work alone. */
  | 'hidden'

/** One Message, placed — and, when nesting, what hangs off it. */
export type Arranged = {
  /** Index in the Transcript, which is a stable key for as long as it is drawn. */
  at: number
  message: Message
  /** The Thread's Messages, on the `Task` call that opened them. */
  nested?: Arranged[]
}

/**
 * The Transcript's Messages in the order and grouping a display asks for.
 *
 * Nothing is dropped except where a display says to drop it: a Thread whose
 * opening `Task` call is not in the Transcript — a log truncated before it, or
 * resumed after it — keeps its Messages in Transcript order rather than losing
 * them to a parent that is not there.
 */
export function arrange(messages: readonly Message[], display: ThreadDisplay): Arranged[] {
  if (display === 'inline') return messages.map((message, at) => ({ at, message }))

  const opened = new Set(
    messages.flatMap((message) =>
      message.kind === 'tool-call' && message.opens ? [message.opens.thread] : [],
    ),
  )
  const out: Arranged[] = []
  const under = new Map<string, Arranged[]>()

  for (const [at, message] of messages.entries()) {
    const thread = threadOf(message)
    // A Thread nobody on screen opened is not a Thread this can group, so its
    // Messages stay where they are rather than vanishing.
    if (thread !== undefined && opened.has(thread)) {
      if (display === 'hidden') continue
      const nested = under.get(thread) ?? []
      nested.push({ at, message })
      under.set(thread, nested)
      continue
    }
    const opens = message.kind === 'tool-call' ? message.opens?.thread : undefined
    if (display === 'nested' && opens !== undefined) {
      const nested: Arranged[] = under.get(opens) ?? []
      under.set(opens, nested)
      out.push({ at, message, nested })
      continue
    }
    out.push({ at, message })
  }

  return out
}

/** The Thread a Message belongs to, for the kinds that can belong to one. */
export function threadOf(message: Message): string | undefined {
  return 'thread' in message ? message.thread : undefined
}

/** Where a Thread stands, read off the `Task` call that opened it. */
export type ThreadState = 'running' | 'settled' | 'failed'

/** What the screen can say about one Thread. */
export type ThreadReading = {
  /** The `Task` call's `tool_use` id — what the Thread is identified by. */
  thread: string
  /** The order it was opened in, 1-based. What the short marker shows. */
  ordinal: number
  /** What it was asked to do. */
  description?: string
  subagentType?: string
  state: ThreadState
  /** Tool calls made inside the Thread. */
  toolCalls: number
  /**
   * How much its own context window the Thread is holding, when it has said.
   * Not spend: see the note at the top of this file.
   */
  contextTokens?: number
  /**
   * How long it has been going, in milliseconds. The runtime's own reading
   * where it sent one; otherwise how long this screen has watched. Absent for
   * a Thread the runtime has not reported on whose work was already over the
   * first time it was seen — see the note at the top of this file.
   */
  elapsedMs?: number
  /** The runtime's reading, kept apart so it can be preferred over the watch. */
  reportedMs?: number
}

/**
 * What the meter reads from. The two parts of a Transcript a Thread is
 * described by: the Messages that name it, and the windows `reduce` files
 * against it.
 */
export type ThreadSource = Pick<Transcript, 'messages' | 'threadContext'>

/**
 * Every Thread the Transcript opened, in the order it opened them.
 *
 * A Thread's state is its opening `Task` call's status, not the Turn's: a Turn
 * runs many Threads and they do not all end together, so a meter keyed to the
 * Turn would stop three Threads because one of them finished.
 */
export function threadsOf(transcript: ThreadSource): ThreadReading[] {
  const { messages, threadContext } = transcript
  const readings: ThreadReading[] = []
  const at = new Map<string, number>()

  for (const message of messages) {
    if (message.kind !== 'tool-call' || !message.opens) continue
    const { thread, description, subagentType } = message.opens
    if (at.has(thread)) continue
    at.set(thread, readings.length)
    readings.push(
      compact<ThreadReading>({
        thread,
        ordinal: readings.length + 1,
        description,
        subagentType,
        state: stateOf(message),
        toolCalls: 0,
        // The runtime's own reading, when it has sent one. A `Task` call is
        // the Thread, so `tool_progress` on it is how long the Thread has
        // really been going — the only duration on the wire that a clock
        // measured rather than this renderer inferred.
        reportedMs:
          message.elapsedSeconds === undefined ? undefined : message.elapsedSeconds * 1000,
        // Absent until the Thread reports a reading of its own. `reduce` keeps
        // these apart from the Session's window on purpose (#17), and reaching
        // for the Session's number here would undo that in the drawing.
        contextTokens: threadContext[thread]?.totalTokens,
      }),
    )
  }

  for (const message of messages) {
    if (message.kind !== 'tool-call') continue
    const index = message.thread === undefined ? undefined : at.get(message.thread)
    if (index === undefined) continue
    const reading = readings[index]
    if (reading) reading.toolCalls += 1
  }

  return readings
}

function stateOf(task: ToolCallMessage): ThreadState {
  if (task.status === 'pending') return 'running'
  return task.status === 'error' ? 'failed' : 'settled'
}

/** Drops keys whose value is missing, which `exactOptionalPropertyTypes` wants. */
function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}
