'use client'

import * as React from 'react'

/**
 * Following the tail of the Transcript while the agent writes — and only while
 * the reader is at it.
 *
 * Two facts, kept apart on purpose. **Whether to follow** is a ref, because it
 * changes on every scroll event and nothing renders from it: as state it would
 * repaint the whole Transcript while you drag the scrollbar. **Whether to offer
 * a way back** is state, because a control has to render, and it is set only
 * when the answer actually changes rather than on every event.
 *
 * Keyed on the whole Transcript rather than on how many Messages there are, so
 * a bubble growing token by token is followed as it is written. Anchoring to
 * the count is the version that exists when there is no way to tell whether
 * somebody is reading — it is the only defence against yanking them forward
 * mid-answer, and it costs following the answer at all. Knowing where the
 * reader is replaces that trade.
 *
 * ## Whose scroll
 *
 * The scroller is found rather than imposed. `ClaudeSession` sets no height and
 * no overflow — the package does not reset your page — so in the README's own
 * example the document is what moves, while a host that bounds the container
 * scrolls that instead. Both have to work, and neither is worth making the
 * consumer declare.
 *
 * Found on every read rather than once: at mount the Transcript is empty and
 * nothing overflows yet, so a container that will scroll later does not look
 * like a scroller now. The walk is a few `getComputedStyle` calls against an
 * ancestor chain that is a handful deep.
 *
 * The listener is on `window` in the capture phase, because a scroll event does
 * not bubble. Capture sees an element's scroll and the document's alike, so
 * there is nothing to re-attach when the answer to "who scrolls" changes.
 */

/**
 * How near the end still counts as being at it.
 *
 * Sub-pixel layout, a bubble growing mid-frame and a browser that rounds all
 * put the arithmetic a pixel or two out. Compared exactly, the transcript
 * unpins itself — the reader has not moved and the words stop following.
 */
export const FOLLOW_SLACK = 64

/** The three numbers that say where a reader is. */
export type Viewport = {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

/** Whether this viewport is at its end, give or take {@link FOLLOW_SLACK}. */
export function atBottom(view: Viewport, slack: number = FOLLOW_SLACK): boolean {
  return view.scrollHeight - view.scrollTop - view.clientHeight <= slack
}

/**
 * The element that actually scrolls around `node` — the nearest ancestor that
 * both overflows and is allowed to be scrolled, or the page when none does.
 *
 * Both halves are needed. An ancestor with `overflow: hidden` overflows and
 * cannot be moved, so following it would pin the Transcript to something the
 * reader can never reach the end of; an ancestor with `overflow: auto` and
 * nothing to scroll is not what is moving, so following it would ignore the
 * page that is.
 */
export function scrollerFor(node: Element | null): Element | null {
  const page = document.scrollingElement
  for (let at = node?.parentElement ?? null; at !== null; at = at.parentElement) {
    if (at === document.body || at === document.documentElement) break
    const overflow = getComputedStyle(at).overflowY
    const scrollable = overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
    if (scrollable && at.scrollHeight > at.clientHeight) return at
  }
  return page
}

/** What a container needs to follow the tail and to offer a way back to it. */
export type Following = {
  /** Put on the element holding the Messages. */
  log: React.RefObject<HTMLDivElement | null>
  /** Whether the reader is at the tail. Drives the way back, nothing else. */
  following: boolean
  /** Go to the newest Message and start following again. */
  jumpToBottom: () => void
  /** Start following again without moving — for sending, which is a reason to. */
  resume: () => void
}

/**
 * Follow `watched` as it changes, unless the reader has scrolled away.
 *
 * `watched` is the Transcript. It is compared by identity, which is what makes
 * this follow prose as it arrives: the hook builds a fresh Transcript for every
 * partial, so the effect runs per token rather than per Message.
 */
export function useFollowing(watched: unknown): Following {
  const log = React.useRef<HTMLDivElement | null>(null)
  /** Whether to follow. Read inside the effect, where a stale value is wrong. */
  const pinned = React.useRef(true)
  /** The same fact, for rendering. Set only when it changes. */
  const [following, setFollowing] = React.useState(true)

  React.useEffect(() => {
    const read = (): void => {
      const scroller = scrollerFor(log.current)
      if (!scroller) return
      const tail = atBottom(scroller)
      if (tail === pinned.current) return
      pinned.current = tail
      setFollowing(tail)
    }
    // Capture, because scroll does not bubble — and on `window`, so an element
    // scrolling and the document scrolling arrive at the same listener.
    window.addEventListener('scroll', read, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', read, { capture: true })
  }, [])

  React.useEffect(() => {
    if (!pinned.current) return
    const scroller = scrollerFor(log.current)
    // Instant, not smooth: this runs per token, and a smooth scroll restarted
    // sixty times a second never arrives.
    scroller?.scrollTo({ top: scroller.scrollHeight })
  }, [watched])

  const resume = React.useCallback((): void => {
    pinned.current = true
    setFollowing(true)
  }, [])

  const jumpToBottom = React.useCallback((): void => {
    resume()
    const scroller = scrollerFor(log.current)
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [resume])

  return { log, following, jumpToBottom, resume }
}
