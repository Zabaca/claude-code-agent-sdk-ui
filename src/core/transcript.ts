import type {
  ContextFrame,
  CostFrame,
  HarnessFrame,
  PromptOrigin,
  RateLimitFrame,
  RecalledMemory,
  SlashCommandInfo,
  ThreadOpened,
} from './frame.ts'

/**
 * The Transcript is the ordered list of Messages a viewer sees. It carries a
 * few Session-wide facts alongside that list — the harness, the commands, the
 * meters — because they are what the runtime last said rather than an entry
 * anywhere in the order.
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
  /** The Session's id, known the instant the runtime reports it. */
  sessionId?: string
  /** What the runtime actually loaded, as opposed to what was configured. */
  harness?: Harness
  /** The slash commands the runtime advertises, as last advertised. */
  commands: SlashCommandInfo[]
  /** How full the context window is. A different meter from the rate limit. */
  context?: ContextUsage
  /** How much of the subscription is left. A different meter from the context. */
  rateLimit?: RateLimit
  /** What the Session has spent, as the runtime last restated it. */
  cost?: Cost
}

/**
 * These four are the latest word on a Session-wide fact rather than an entry in
 * the Transcript, so they are state, not Messages. Each is its Frame minus the
 * discriminator, so a field added to the Frame vocabulary reaches the Transcript
 * without anyone having to remember to copy it across.
 *
 * The price is deliberate, and is not a precedent for the Messages: these four
 * take the wire's field names with them, so `apiKeySource` and `outputStyle`
 * reach a render type verbatim. The spec's "emit everything, losslessly" rule
 * governs the Frame vocabulary alone. It is paid here because these four are
 * pass-through readings a renderer displays rather than reads — and it is not
 * paid by any Message, each of which is named for what a viewer sees.
 */
export type Harness = Omit<HarnessFrame, 'kind'>
export type ContextUsage = Omit<ContextFrame, 'kind'>
export type RateLimit = Omit<RateLimitFrame, 'kind'>
export type Cost = Omit<CostFrame, 'kind'>

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

export type Message =
  | PromptMessage
  | TextMessage
  | ReasoningMessage
  | ToolCallMessage
  | ImageMessage
  | CompactedMessage
  | ResetMessage
  | RecallMessage
  | HookMessage
  | OutcomeMessage

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
 * The agent's deliberation. Kept out of the Transcript unless `reduce` is asked
 * for it: thinking is not an answer.
 */
export type ReasoningMessage = {
  kind: 'reasoning'
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

/** An image in the Transcript — pasted by a person, or shown by the agent. */
export type ImageMessage = {
  kind: 'image'
  mediaType?: string
  /** Base64 payload, when the image arrived inline. */
  data?: string
  /** Location, when the image arrived by reference. */
  url?: string
  /** The tool call that produced it, when the agent showed it. */
  toolCallId?: string
  thread?: string
}

/**
 * Where context was compacted. Without this the Transcript looks identical
 * before and after, while what the agent can see has become a summary.
 */
export type CompactedMessage = {
  kind: 'compacted'
  trigger?: 'manual' | 'auto' | string
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

/** Where the Session was reset — memory gone, rather than memory summarised. */
export type ResetMessage = {
  kind: 'reset'
  /** The id the fresh Transcript is mounted under. Not the Session id. */
  transcriptId: string
}

/** Where memory surfaced from outside this conversation. */
export type RecallMessage = {
  kind: 'recall'
  mode?: 'select' | 'synthesize' | string
  memories: RecalledMemory[]
}

/**
 * A hook firing, and what it said. Frames sharing a `hook_id` are one Message,
 * patched from started through running to what it finished with.
 */
export type HookMessage = {
  kind: 'hook'
  id?: string
  name: string
  /** The lifecycle point it ran at. */
  hookEvent?: string
  status: 'started' | 'running' | 'success' | 'error' | 'cancelled' | string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number
}

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
  /** The runtime's result subtype, when it did not settle. */
  subtype?: string
  /**
   * Why it stopped, in the runtime's own words. Present on an interrupt too —
   * the runtime's account of the abort is worth reading; it is `Turn` that
   * stays clean, because an idle Turn has no problem to report.
   */
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
