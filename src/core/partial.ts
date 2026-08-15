/**
 * Partial text on the wire — the one thing crossing it that is neither a Frame
 * nor an Event. Deliberately not a Frame: a Frame is what the log retains and
 * what `reduce` consumes, and the log holds whole Messages. A block's deltas
 * fold into one Frame when it closes, so what is here is only ever prose that
 * has not become a Frame yet.
 *
 * It carries no `id:` on the wire, so it never moves the browser's
 * `Last-Event-ID` and a reconnect loses nothing by skipping it. That is also
 * why a consumer must not wait for `done` before letting a Frame take a live
 * block's place: the `partial` saying the block closed is never replayed.
 *
 * Here rather than in the server because both halves speak it — the handler
 * writes it and the browser reads it — and neither should have to depend on
 * the other to name it.
 */
export type PartialText = {
  /** The content block, as the SDK indexes it within the Message. */
  block: number
  /** Which Frame the block becomes once it closes. */
  kind: PartialKind
  /** Everything the block holds so far. Replace what you had; do not append. */
  text: string
  /** The block closed: this is the whole of it, and its Frame follows. */
  done?: true
  /** The Thread this work belongs to; absent for the agent's own work. */
  thread?: string
}

/** What a block closes into. The two Frame kinds prose can become. */
export type PartialKind = 'text' | 'reasoning'

/**
 * Which block this is. A block is identified by its Thread *and* its index,
 * never by the index alone: `forwardSubagentText` puts three Threads' prose on
 * the same path as the agent's own, and they all start at block 0. Keyed by
 * index alone, a sub-agent's words grow whichever bubble was opened last and
 * land inside the answer to the person.
 *
 * Here, and not once in the handler and again in the browser, because the two
 * halves agreeing is the whole point — and two string literals that happen to
 * match is not agreement, it is a coincidence nothing would report the end of.
 */
export function blockAt(of: { block: number; thread?: string | undefined }): string {
  return `${of.thread ?? ''}#${of.block}`
}

/** Whether what arrived off the wire says one of the two kinds. */
export function isPartialKind(kind: unknown): kind is PartialKind {
  return kind === 'text' || kind === 'reasoning'
}
