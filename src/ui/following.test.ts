import { afterEach, describe, expect, test } from 'bun:test'

import { atBottom, FOLLOW_SLACK, scrollerFor } from './following.ts'

/**
 * Following the tail, as arithmetic and a tree walk — the two parts that decide
 * it, with nothing rendered.
 *
 * Both are the kind of thing that is invisible in a short transcript and wrong
 * in a long one, which is the reason they are reachable from here at all rather
 * than living inside a component.
 */
describe('whether the reader is at the tail', () => {
  test('a viewport scrolled to the end is at it', () => {
    expect(atBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true)
  })

  test('a viewport that does not overflow is always at it', () => {
    // Nothing to scroll means nothing to follow, and a transcript of two
    // Messages must not be reported as scrolled away from.
    expect(atBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 300 })).toBe(true)
  })

  test('a little short of the end still counts', () => {
    // Sub-pixel layout, a growing bubble, and a browser that rounds — an exact
    // comparison unpins itself on the arithmetic rather than on the reader.
    expect(atBottom({ scrollHeight: 1000, scrollTop: 800 - FOLLOW_SLACK, clientHeight: 200 })).toBe(
      true,
    )
  })

  test('a screen further back is not', () => {
    expect(atBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 200 })).toBe(false)
  })

  test('takes a different slack when asked', () => {
    const view = { scrollHeight: 1000, scrollTop: 700, clientHeight: 200 }

    expect(atBottom(view, 200)).toBe(true)
    expect(atBottom(view, 10)).toBe(false)
  })
})

describe('which element actually scrolls', () => {
  const made: Element[] = []

  afterEach(() => {
    for (const node of made) node.remove()
    made.length = 0
  })

  /** An element with the metrics a browser would compute, since none are here. */
  function box(overflowY: string, scrollHeight: number, clientHeight: number): HTMLDivElement {
    const node = document.createElement('div')
    node.style.overflowY = overflowY
    Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true })
    return node
  }

  test('finds the nearest ancestor that both overflows and may scroll', () => {
    const outer = box('auto', 5000, 500)
    const inner = box('auto', 2000, 400)
    const log = document.createElement('div')
    outer.append(inner)
    inner.append(log)
    document.body.append(outer)
    made.push(outer)

    expect(scrollerFor(log)).toBe(inner)
  })

  test('walks past an ancestor that overflows but clips rather than scrolls', () => {
    // `overflow: hidden` overflows and cannot be scrolled to, so following it
    // would pin the transcript to an element the reader can never move.
    const outer = box('auto', 5000, 500)
    const clipped = box('hidden', 2000, 400)
    const log = document.createElement('div')
    outer.append(clipped)
    clipped.append(log)
    document.body.append(outer)
    made.push(outer)

    expect(scrollerFor(log)).toBe(outer)
  })

  test('walks past an ancestor that may scroll but has nothing to', () => {
    // The common shape while a Session is young: the container is bounded but
    // the transcript is two Messages long, so the page is what moves.
    const roomy = box('auto', 400, 400)
    const log = document.createElement('div')
    roomy.append(log)
    document.body.append(roomy)
    made.push(roomy)

    expect(scrollerFor(log)).toBe(document.scrollingElement)
  })

  test('falls back to the page when no ancestor scrolls', () => {
    // What the README's own example produces: `<ClaudeSession />` in a page
    // that imposes no height, so the document is the scroller.
    const log = document.createElement('div')
    document.body.append(log)
    made.push(log)

    expect(scrollerFor(log)).toBe(document.scrollingElement)
  })

  test('says the page for nothing at all, rather than throwing', () => {
    // The ref is null for the render before the log is on screen.
    expect(scrollerFor(null)).toBe(document.scrollingElement)
  })
})
