import type { PromptOrigin, ThreadOpened } from './frame.ts'

/**
 * The Transcript is the ordered list of Messages a viewer sees, plus what is
 * true of the Session rather than of any one Message.
 *
 * It is **flat**: nesting is a rendering decision. A Message carries the Thread
 * it belongs to, and the `Task` Message names the Thread it opens; a renderer
 * can filter Threads out, attribute them, or nest them. Flatness is what keeps
 * `reduce` to append-and-patch-the-tail and keeps the Transcript
 * index-addressable, which replay depends on.
 */
export type Transcript = {
  /** The ordered list of Messages a viewer sees. */
  messages: Message[]
  /** Where the Turn now running — or the one that just ended — stands. */
  turn: Turn
}

/**
 * The state of the latest Turn. An interrupt is idle, never a failure: aborting
 * a Turn is what the person asked for, and reporting it as an error overwrites
 * an idle Turn with a problem nobody had.
 */
export type Turn = {
  status: TurnStatus
  /** The runtime's result subtype, when the Turn failed. */
  subtype?: string
  /** Why it stopped, in the runtime's own words. Absent unless it failed. */
  reason?: string
}

/**
 * `working` from the person's words until the Turn ends; `idle` when it
 * finished or was interrupted; `failed` when it stopped short.
 */
export type TurnStatus = 'idle' | 'working' | 'failed'

export type Message = PromptMessage | TextMessage | ToolCallMessage | OutcomeMessage

/** A person's words. */
export type PromptMessage = {
  kind: 'prompt'
  text: string
  /** The Thread this work belongs to; absent for the agent's own work. */
  thread?: string
  /** The runtime wrote this, not the person. */
  synthetic?: true
  /** Who asked — the account of a Turn the person at the keyboard did not start. */
  origin?: PromptOrigin
}

/** A stretch of the agent's prose. */
export type TextMessage = {
  kind: 'text'
  text: string
  thread?: string
}

/**
 * A tool call and, once it answers, what it answered. The call is a Message the
 * instant it starts, so an in-flight call is renderable before any result
 * exists.
 */
export type ToolCallMessage = {
  kind: 'tool-call'
  /** The call's `tool_use` id — what its result is matched back to. */
  id: string
  name: string
  input: Record<string, unknown>
  status: ToolStatus
  /** What the tool answered, once it has. */
  output?: string
  /** The tool's full Output object — where diffs come from. */
  structured?: unknown
  thread?: string
  /** Present on a `Task` call: the Thread this call opens. */
  opens?: ThreadOpened
}

/** `pending` until the tool answers; then whether it answered or failed. */
export type ToolStatus = 'pending' | 'success' | 'error'

/**
 * How one Turn ended, at the point in the Transcript where it ended. A Session
 * runs many Turns, so this is a Message rather than only Session state: the way
 * the third Turn ended must not erase how the first one did.
 */
export type OutcomeMessage = {
  kind: 'outcome'
  outcome: TurnOutcome
  /** What the Turn answered, when it settled. */
  result?: string
  /** The runtime's result subtype, when it failed. */
  subtype?: string
  /** Why it stopped, when it failed. */
  reason?: string
  turns?: number
  durationMs?: number
  stopReason?: string
  terminalReason?: string
}

/**
 * `interrupted` is kept apart from `failed` deliberately — a stop the person
 * asked for is not a problem they have.
 */
export type TurnOutcome = 'settled' | 'interrupted' | 'failed'
