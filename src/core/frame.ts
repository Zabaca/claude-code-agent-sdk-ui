/**
 * A Frame is something that happened agent-side — observed, never proposed.
 * Its willed counterpart is an Event, which does not live here.
 *
 * `classify` emits this vocabulary losslessly: a missing Frame forces a
 * consumer to fork the package, whereas a missing component only makes them
 * write a component.
 *
 * ## Which Frames carry a Thread, and why the rest cannot
 *
 * "Is every kind emitted?" and "is every field carried?" are not the same
 * question as "does attribution reach every Frame that should have it." The
 * third one is what #17 was: `context` came off a message that names its
 * Thread, and `classify` dropped the name.
 *
 * The SDK puts `parent_tool_use_id` on exactly four of the messages in the
 * `SDKMessage` union — `SDKAssistantMessage`, `SDKUserMessage`,
 * `SDKUserMessageReplay` and `SDKPartialAssistantMessage` — plus
 * `SDKToolProgressMessage`. Every Frame born of those carries the Thread:
 * `text`, `reasoning`, `tool-call`, `tool-result`, `image`, `prompt`, and now
 * `context`, which rides on `SDKAssistantMessage` alongside the others.
 *
 * The rest have no Thread to carry, because the message they come from does
 * not have one to give:
 *
 * - `harness` (`system`/`init`), `commands` (`system`/`commands_changed`)
 * - `compacted` (`system`/`compact_boundary`)
 * - `hook` (`system`/`hook_started`|`hook_progress`|`hook_response`)
 * - `recall` (`system`/`memory_recall`)
 * - `settled`, `failed`, `cost` (`result`)
 * - `reset` (`conversation_reset`), `rate-limit` (`rate_limit_event`)
 *
 * Three of those are cases a Thread really can cause — a long-running
 * sub-agent compacts, a hook fires on a sub-agent's tool call, a sub-agent
 * recalls memory — and the screen will show them as the Session's. That is a
 * limit of the wire, not a decision made here: attributing them would mean
 * inventing an owner. It needs a field on the SDK message, not a change below.
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
  | HookFrame

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
  /** Who asked — the account of a Turn the person at the keyboard did not start. */
  origin?: PromptOrigin
}

export type PromptOrigin = {
  kind: string
  /** The peer that sent it, when it came from one. */
  from?: string
  /** The peer's display name, as reported by the sender. */
  name?: string
  /** The channel's server, when it came from a channel. */
  server?: string
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
  stopReason?: string
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

/** The Session was reset — memory gone, rather than memory summarised. */
export type ResetFrame = {
  kind: 'reset'
  /**
   * The id the fresh Transcript is mounted under, from the SDK's
   * `new_conversation_id`. Not the Session id: the Session outlives the reset.
   */
  transcriptId: string
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

/**
 * How full the context window is. A different meter from the rate limit.
 *
 * A Thread has its own window, so this carries the Thread whose window it
 * reports. Without it the last reading to arrive won whatever it belonged to,
 * and a background agent 7000 tokens in silently replaced the main agent's
 * 190000 — the Session meter reporting a window that was nearly full as nearly
 * empty (#17).
 */
export type ContextFrame = {
  kind: 'context'
  /** The Thread whose window this is; absent for the main agent's own. */
  thread?: string
  model?: string
  totalTokens: number
  maxTokens?: number
  percentage?: number
  overLimit?: { tokensOver?: number; kind?: string }
  /** Usage by category — the rows of the runtime's own context report. */
  categories?: ContextCategory[]
  /** What each MCP tool's schema costs to keep in the window. */
  mcpTools?: ContextMcpTool[]
  /** What each memory file costs to keep in the window. */
  memoryFiles?: ContextMemoryFile[]
  /** What each agent definition costs to keep in the window. */
  agents?: ContextAgent[]
  /** What each skill costs to keep in the window. */
  skills?: ContextSkill[]
}

export type ContextCategory = {
  name: string
  tokens?: number
  kind?: 'used' | 'free' | 'buffer' | 'deferred' | string
}

export type ContextMcpTool = {
  /** Wire name, e.g. `mcp__linear__create_issue`. */
  name: string
  serverName?: string
  tokens?: number
}

export type ContextMemoryFile = {
  path: string
  /** Display label of the source, e.g. `Project` or `User`. */
  type?: string
  tokens?: number
}

export type ContextAgent = {
  agentType: string
  /** Raw source identifier, e.g. `projectSettings`, `userSettings`, `plugin`. */
  source?: string
  tokens?: number
}

export type ContextSkill = {
  name: string
  source?: string
  pluginName?: string
  tokens?: number
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

/** A hook firing, and what it said. */
export type HookFrame = {
  kind: 'hook'
  id?: string
  name: string
  /** The lifecycle point it ran at, from the SDK's `hook_event`. */
  hookEvent?: string
  status: 'started' | 'running' | 'success' | 'error' | 'cancelled' | string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number
}

export type SlashCommandInfo = {
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
}
