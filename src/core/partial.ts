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
  kind: 'text' | 'reasoning'
  /** Everything the block holds so far. Replace what you had; do not append. */
  text: string
  /** The block closed: this is the whole of it, and its Frame follows. */
  done?: true
  /** The Thread this work belongs to; absent for the agent's own work. */
  thread?: string
}
