'use client'

import * as React from 'react'

/**
 * Following the tail of the Transcript while the agent writes — and only while
 * the reader is at it.
 *
 * ## Asked, not worked out
 *
 * The question is "is the end of the Transcript on screen". Three earlier
 * attempts computed it, from `scrollHeight - scrollTop - clientHeight` and from
 * the direction of scroll events, and each fixed one race and left the class of
 * bug alone — because the arithmetic is a guess at something the browser
 * already knows, and scroll events arrive in an order that has nothing to do
 * with when the content changed. Watching a marker at the end of the Transcript
 * with an `IntersectionObserver` asks the browser the actual question. It
 * recomputes on layout rather than on scrolling, so content growing under a
 * still reader is reported the same way as a reader moving — which is the
 * distinction the arithmetic could never draw without guessing.
 *
 * Scrolling is the browser's too: `scrollIntoView` on the marker moves whatever
 * ancestors need moving, so nothing here works out how far, or in what.
 *
 * ## Two copies of one fact
 *
 * Whether to follow is a ref, because it is read inside an effect where a
 * render-cycle-old value would be wrong. Whether to offer the way back is
 * state, because a control has to render. Set only when the answer changes, so
 * dragging the scrollbar does not repaint the Transcript.
 *
 * ## Whose scroll
 *
 * The scroller is found rather than imposed. `ClaudeSession` sets no height and
 * no overflow — the package does not reset your page — so in the README's own
 * example the document is what moves, while a host that bounds the container
 * scrolls that instead. The observer needs the difference: a null root watches
 * the viewport, which is right for the page and wrong for a marker inside a
 * bounded box that is itself off screen.
 *
 * Recomputed as the Transcript grows rather than fixed at mount: at mount
 * nothing overflows, so a container that will scroll later does not look like a
 * scroller yet.
 */

/**
 * How near the end still counts as being at it, as room below the root.
 *
 * Sub-pixel layout, a bubble growing mid-frame and a browser that rounds all
 * put the edge a pixel or two out. Watched exactly, the marker leaves and
 * re-enters on arithmetic rather than on the reader.
 */
export const FOLLOW_SLACK = 64

/**
 * The element that actually scrolls around `node` — the nearest ancestor that
 * both overflows and is allowed to be scrolled, or the page when none does.
 *
 * Both halves are needed. An ancestor with `overflow: hidden` overflows and
 * cannot be moved, so watching against it would ask about a box the reader can
 * never reach the end of; an ancestor with `overflow: auto` and nothing to
 * scroll is not what is moving, so watching against it would ignore the page
 * that is.
 */
export function scrollerFor(node: Element | null): Element | null {
  for (let at = node?.parentElement ?? null; at !== null; at = at.parentElement) {
    if (at === document.body || at === document.documentElement) break
    const overflow = getComputedStyle(at).overflowY
    const scrollable = overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
    if (scrollable && at.scrollHeight > at.clientHeight) return at
  }
  return document.scrollingElement
}

/** What a container needs to follow the tail and to offer a way back to it. */
export type Following = {
  /** Put on the element holding the Messages. */
  log: React.RefObject<HTMLDivElement | null>
  /** Put on an empty element at the very end of it. */
  sentinel: React.RefObject<HTMLDivElement | null>
  /** Whether the end is on screen. Drives the way back, nothing else. */
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
  const sentinel = React.useRef<HTMLDivElement | null>(null)
  /** Whether to follow. Read inside the effect, where a stale value is wrong. */
  const pinned = React.useRef(true)
  /** The same fact, for rendering. Set only when it changes. */
  const [following, setFollowing] = React.useState(true)
  /**
   * That the last scroll was ours.
   *
   * The observer reports what it saw, and what it saw may be from before the
   * follow effect moved anything — so one report of "gone" after our own scroll
   * is not the reader leaving. A boolean rather than a remembered position: a
   * coordinate can be wrong by a viewport, and was.
   */
  const ours = React.useRef(false)
  /** What the observer watches against. `null` is the viewport. */
  const [root, setRoot] = React.useState<Element | null>(null)

  React.useEffect(() => {
    const marker = sentinel.current
    if (!marker) return
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries[entries.length - 1]
        if (!seen) return
        if (seen.isIntersecting) {
          ours.current = false
          if (pinned.current) return
          pinned.current = true
          setFollowing(true)
          return
        }
        if (ours.current) {
          ours.current = false
          return
        }
        if (!pinned.current) return
        pinned.current = false
        setFollowing(false)
      },
      { root, rootMargin: `0px 0px ${FOLLOW_SLACK}px 0px`, threshold: 0 },
    )
    observer.observe(marker)
    return () => observer.disconnect()
  }, [root])

  React.useLayoutEffect(() => {
    if (pinned.current) {
      ours.current = true
      // The browser works out how far and in what: the marker is at the end of
      // the Transcript, so bringing it into view is the whole of following.
      sentinel.current?.scrollIntoView({ block: 'end' })
    }
    const scroller = scrollerFor(log.current)
    const next = scroller === document.scrollingElement ? null : scroller
    setRoot((current) => (current === next ? current : next))
  }, [watched])

  const resume = React.useCallback((): void => {
    pinned.current = true
    setFollowing(true)
  }, [])

  const jumpToBottom = React.useCallback((): void => {
    resume()
    ours.current = true
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [resume])

  return { log, sentinel, following, jumpToBottom, resume }
}
