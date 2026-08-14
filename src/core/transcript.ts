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
}

export type Message = PromptMessage | TextMessage | ToolCallMessage

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
