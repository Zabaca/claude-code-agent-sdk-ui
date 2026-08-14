/**
 * A Frame is something that happened agent-side — observed, never proposed.
 * Its willed counterpart is an Event, which does not live here.
 *
 * `classify` emits this vocabulary losslessly: a missing Frame forces a
 * consumer to fork the package, whereas a missing component only makes them
 * write a component.
 */
export type Frame =
  | SessionFrame
  | HarnessFrame
  | CommandsFrame
  | PromptFrame
  | TextFrame
  | ReasoningFrame
  | ToolCallFrame
  | ToolResultFrame
  | ImageFrame
  | SettledFrame
  | FailedFrame
  | CostFrame
  | CompactedFrame
  | ResetFrame
  | RecallFrame
  | ContextFrame
  | RateLimitFrame

/** The Session's id, emitted the instant `init` arrives (ADR-0002). */
export type SessionFrame = {
  kind: 'session'
  sessionId: string
}

/** What the runtime actually loaded — as opposed to what was configured. */
export type HarnessFrame = {
  kind: 'harness'
  model?: string
  cwd?: string
  permissionMode?: string
  apiKeySource?: string
  outputStyle?: string
  version?: string
  tools?: string[]
  agents?: string[]
  skills?: string[]
  mcpServers?: { name: string; status?: string }[]
  plugins?: { name: string; path?: string; version?: string }[]
}

/** The slash commands the runtime advertises. REPLACE semantics. */
export type CommandsFrame = {
  kind: 'commands'
  commands: SlashCommandInfo[]
}

/** A person's words. */
export type PromptFrame = {
  kind: 'prompt'
  text: string
  thread?: string
  /** The runtime wrote this, not the person. */
  synthetic?: true
}

/** A stretch of the agent's prose. */
export type TextFrame = {
  kind: 'text'
  text: string
  /** The Thread this work belongs to; absent for the agent's own work. */
  thread?: string
}

/** The agent's deliberation. Kept out of the Transcript by default. */
export type ReasoningFrame = {
  kind: 'reasoning'
  text: string
  thread?: string
}

/** A tool call, emitted when it starts — before any result exists. */
export type ToolCallFrame = {
  kind: 'tool-call'
  id: string
  name: string
  input: Record<string, unknown>
  thread?: string
  /** Present on a `Task` call: the Thread this call opens. */
  opens?: ThreadOpened
}

export type ThreadOpened = {
  /** The `Task` call's own `tool_use` id — what its Thread is identified by. */
  thread: string
  /** What the Thread is called. */
  description?: string
  subagentType?: string
}

/** What a tool answered, against the call it answers. */
export type ToolResultFrame = {
  kind: 'tool-result'
  /** The `tool_use` id of the call this answers. */
  id: string
  output: string
  isError: boolean
  /**
   * The tool's full Output object, keyed by tool. `FileEditOutput` and
   * `FileWriteOutput` carry `structuredPatch` here, which is where diffs come
   * from — no file read and no diff algorithm.
   */
  structured?: unknown
  thread?: string
}

/** An image in the Transcript — pasted by a person, or shown by the agent. */
export type ImageFrame = {
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

/** The Turn finished as asked. */
export type SettledFrame = {
  kind: 'settled'
  result?: string
  turns?: number
  durationMs?: number
  stopReason?: string
  terminalReason?: string
}

/** The Turn stopped short. An answer that stops is not an answer that finished. */
export type FailedFrame = {
  kind: 'failed'
  /** The result subtype the runtime reported, e.g. `error_max_turns`. */
  subtype: string
  /** Why it stopped, in the runtime's own words where it gave any. */
  reason: string
  turns?: number
  durationMs?: number
  terminalReason?: string
}

/** What the Turn spent. Emitted whether the Turn settled or failed. */
export type CostFrame = {
  kind: 'cost'
  usd: number
  turns?: number
  durationMs?: number
  /** Main agent loop only. */
  usage?: TokenUsage
  /** Every model called through the query pipeline, sub-agents included. */
  byModel?: Record<string, ModelCost>
}

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export type ModelCost = TokenUsage & { costUsd?: number }

/** Context was compacted: what the agent can see is now a summary. */
export type CompactedFrame = {
  kind: 'compacted'
  trigger?: 'manual' | 'auto' | string
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

/** The conversation was reset — memory gone, rather than memory summarised. */
export type ResetFrame = {
  kind: 'reset'
  conversationId: string
}

/** Memory surfaced from outside this conversation. */
export type RecallFrame = {
  kind: 'recall'
  mode?: 'select' | 'synthesize' | string
  memories: RecalledMemory[]
}

export type RecalledMemory = {
  path: string
  scope?: 'personal' | 'team' | 'organization' | string
  content?: string
}

/** How full the context window is. A different meter from the rate limit. */
export type ContextFrame = {
  kind: 'context'
  model?: string
  totalTokens: number
  maxTokens?: number
  percentage?: number
  overLimit?: { tokensOver?: number; kind?: string }
  categories?: ContextCategory[]
}

export type ContextCategory = {
  name: string
  tokens?: number
  kind?: 'used' | 'free' | 'buffer' | 'deferred' | string
}

/** How much of the subscription is left. A different meter from the context. */
export type RateLimitFrame = {
  kind: 'rate-limit'
  status?: 'allowed' | 'allowed_warning' | 'rejected' | string
  limitType?: string
  utilization?: number
  resetsAt?: number
  overageStatus?: string
  usingOverage?: boolean
}

export type SlashCommandInfo = {
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
}
