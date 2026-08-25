import { describe, expect, test } from 'bun:test'

import { blockAt, isPartialKind, type PartialText } from './partial.ts'

/**
 * The rule both halves of the wire have to agree on. The handler writes a
 * block's deltas and the browser reads them, and each has to arrive at the same
 * answer to "which block is this" from the same `PartialText` — or a sub-agent's
 * prose grows whichever bubble was last opened.
 *
 * It lives here because it is the one rule neither half can own: `forwardSubagentText`
 * puts three Threads' prose on the same path as the agent's own, and a block
 * identified by its index alone then lands a background agent's words inside the
 * answer to the person.
 *
 * The Message is the other half of the same problem, one axis along instead of
 * across: the SDK numbers blocks from 0 within each Message, so an identity
 * that is only Thread and index is reused several times in one Turn — and the
 * browser has to be able to tell a block it has never seen from one whose Frame
 * it already holds.
 */
describe('block identity', () => {
  test('tells the same block index in two Threads apart', () => {
    // The whole reason the rule exists. Both are block 0.
    expect(blockAt({ block: 0, thread: 'call-1' })).not.toBe(blockAt({ block: 0 }))
    expect(blockAt({ block: 0, thread: 'call-1' })).not.toBe(blockAt({ block: 0, thread: 'call-2' }))
  })

  test('gives one block one identity, however it is spelled', () => {
    expect(blockAt({ block: 2, thread: 'call-1' })).toBe(blockAt({ block: 2, thread: 'call-1' }))
    // The agent's own work carries no Thread, and an absent one is not a Thread
    // named for the absence.
    expect(blockAt({ block: 2 })).toBe(blockAt({ block: 2, thread: undefined }))
  })

  test('tells blocks of one Thread apart', () => {
    expect(blockAt({ block: 0, thread: 'call-1' })).not.toBe(blockAt({ block: 1, thread: 'call-1' }))
  })

  test('tells one Message from the next, which numbers its blocks from 0 again', () => {
    // The other whole reason the rule exists. Both are block 0, one Thread, one
    // Turn — and the first has settled into a Frame by the time the second
    // opens, so a consumer that could not tell them apart would either bring
    // the first back or refuse the second.
    expect(blockAt({ block: 0, message: 1 })).not.toBe(blockAt({ block: 0, message: 2 }))
    expect(blockAt({ block: 0, message: 4, thread: 'call-1' })).not.toBe(
      blockAt({ block: 0, message: 5, thread: 'call-1' }),
    )
  })

  test('reads a wire that names no Message as one long Message', () => {
    // What comes off the wire is unknown until asked, and a handler older than
    // the field says nothing about Messages. That is exactly the identity a
    // block used to have, so it is what an absent Message reads as.
    expect(blockAt({ block: 2, thread: 'call-1' })).toBe(
      blockAt({ block: 2, message: 0, thread: 'call-1' }),
    )
  })

  test('reads a PartialText off the wire without being handed its parts', () => {
    // What the browser has is the whole record; what the handler has is the
    // index and the Thread. One rule has to serve both.
    const partial: PartialText = { block: 3, message: 2, kind: 'text', text: 'hi', thread: 'call-9' }

    expect(blockAt(partial)).toBe(blockAt({ block: 3, message: 2, thread: 'call-9' }))
  })
})

describe('what a block becomes', () => {
  test('admits the two kinds a block can close into', () => {
    expect(isPartialKind('text')).toBe(true)
    expect(isPartialKind('reasoning')).toBe(true)
  })

  test('refuses anything else off the wire', () => {
    // The browser parses this out of JSON, so it is unknown until asked.
    expect(isPartialKind('thinking')).toBe(false)
    expect(isPartialKind('tool-call')).toBe(false)
    expect(isPartialKind(undefined)).toBe(false)
    expect(isPartialKind(0)).toBe(false)
  })
})
