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
  | TextFrame
  | ReasoningFrame
  | ToolCallFrame

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

export type SlashCommandInfo = {
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
}
