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

export type SlashCommandInfo = {
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
}
