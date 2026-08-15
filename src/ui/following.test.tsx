import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { scrollerFor, useFollowing } from './following.ts'

/**
 * Following the tail, asked of the browser rather than worked out.
 *
 * The first three attempts at this measured `scrollHeight - scrollTop -
 * clientHeight` and inferred from scroll events whether the reader had moved.
 * Each one fixed a race and left the class of bug alone: the arithmetic is a
 * guess at something the browser already knows, and the events arrive in an
 * order that has nothing to do with when the content changed. What is wanted is
 * "is the end of the transcript on screen", which is exactly what an
 * `IntersectionObserver` answers, about a marker at the end of it.
 *
 * happy-dom has an `IntersectionObserver` that never fires — it computes no
 * layout, so it has nothing to report. This one is driven by hand.
 */
type Watcher = {
  root: Element | Document | null
  rootMargin: string
  observed: Element[]
  report(isIntersecting: boolean): void
}

const watchers: Watcher[] = []
/** Every `scrollIntoView` the hook asked for, since happy-dom scrolls nothing. */
const scrolls: ScrollIntoViewOptions[] = []
let original: typeof IntersectionObserver
let scrolledInto: Element['scrollIntoView']

beforeEach(() => {
  watchers.length = 0
  scrolls.length = 0
  scrolledInto = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
    scrolls.push(typeof options === 'object' ? options : {})
  }
  original = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    #watcher: Watcher
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.#watcher = {
        root: options?.root ?? null,
        rootMargin: options?.rootMargin ?? '',
        observed: [],
        report: (isIntersecting) => {
          callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          )
        },
      }
      watchers.push(this.#watcher)
    }
    observe(node: Element): void {
      this.#watcher.observed.push(node)
    }
    disconnect(): void {
      const at = watchers.indexOf(this.#watcher)
      if (at !== -1) watchers.splice(at, 1)
    }
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  } as unknown as typeof IntersectionObserver
})

afterEach(() => {
  globalThis.IntersectionObserver = original
  Element.prototype.scrollIntoView = scrolledInto
})

/** The hook, rendered as a container uses it: refs attached in the markup. */
function mount(): {
  current: ReturnType<typeof useFollowing>
  scrolled: ScrollIntoViewOptions[]
  rerender(watched: unknown): void
  unmount(): void
} {
  let api: ReturnType<typeof useFollowing> | undefined

  function Host({ watched }: { watched: unknown }) {
    const tail = useFollowing(watched)
    api = tail
    return (
      <div ref={tail.log}>
        <div ref={tail.sentinel} />
      </div>
    )
  }

  const view = render(<Host watched={0} />)
  // The mount follows, and the observer then reports what a browser would: the
  // end is on screen, because we just went there. Both are right and neither is
  // what these are about.
  act(() => watchers[0]?.report(true))
  scrolls.length = 0

  return {
    get current() {
      if (!api) throw new Error('the hook did not render')
      return api
    },
    scrolled: scrolls,
    rerender: (watched) => {
      view.rerender(<Host watched={watched} />)
    },
    unmount: view.unmount,
  }
}

describe('watching the end of the transcript', () => {
  test('watches a marker, with room to spare for a browser that rounds', () => {
    const view = mount()

    expect(watchers).toHaveLength(1)
    expect(watchers[0]?.observed).toHaveLength(1)
    // Sub-pixel layout and a bubble growing mid-frame put the arithmetic a
    // pixel or two out; a margin below the root means near enough still counts.
    expect(watchers[0]?.rootMargin).toContain('64px')
    view.unmount()
  })

  test('follows while the end is on screen', () => {
    const view = mount()

    view.rerender(1)
    view.rerender(2)

    // Instantly, not smoothly: this runs per token, and a smooth scroll
    // restarted sixty times a second never arrives.
    expect(view.scrolled).toEqual([{ block: 'end' }, { block: 'end' }])
    expect(view.current.following).toBe(true)
    view.unmount()
  })

  test('stops following once the end has left the screen', () => {
    const view = mount()

    act(() => watchers[0]?.report(false))

    expect(view.current.following).toBe(false)
    view.rerender(1)
    // Nothing moved under the reader.
    expect(view.scrolled).toEqual([])
    view.unmount()
  })

  test('follows again the moment the end comes back into view', () => {
    // However the reader got there: dragging the scrollbar back down is the
    // same answer as pressing the button, and neither needs to be told apart.
    const view = mount()

    act(() => watchers[0]?.report(false))
    expect(view.current.following).toBe(false)

    act(() => watchers[0]?.report(true))
    expect(view.current.following).toBe(true)

    view.rerender(1)
    expect(view.scrolled).toEqual([{ block: 'end' }])
    view.unmount()
  })

  test('does not read its own scroll as the reader leaving', () => {
    // The bug the arithmetic kept producing, in the shape it takes here: the
    // follow scrolls, the observer reports what it saw *before* that scroll,
    // and the transcript unpins itself with nobody having touched anything.
    // One boolean says the last scroll was ours — which cannot be wrong by a
    // viewport, the way a recorded coordinate could.
    const view = mount()

    view.rerender(1)
    act(() => watchers[0]?.report(false))

    expect(view.current.following).toBe(true)

    // And a second such report is the reader, because only one was ours.
    act(() => watchers[0]?.report(false))
    expect(view.current.following).toBe(false)
    view.unmount()
  })

  test('takes the reader back, and follows again, when asked', () => {
    const view = mount()

    act(() => watchers[0]?.report(false))
    act(() => view.current.jumpToBottom())

    expect(view.scrolled).toEqual([{ block: 'end', behavior: 'smooth' }])
    expect(view.current.following).toBe(true)
    view.unmount()
  })

  test('follows again on being sent something, without moving', () => {
    // Sending is a reason to follow: the answer to what was just asked is the
    // thing worth being taken to, even after reading back through the Turn.
    const view = mount()

    act(() => watchers[0]?.report(false))
    act(() => view.current.resume())

    expect(view.current.following).toBe(true)
    expect(view.scrolled).toEqual([])
    view.unmount()
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
    const roomy = box('auto', 400, 400)
    const log = document.createElement('div')
    roomy.append(log)
    document.body.append(roomy)
    made.push(roomy)

    expect(scrollerFor(log)).toBe(document.scrollingElement)
  })

  test('falls back to the page when no ancestor scrolls', () => {
    // What the README's own example produces: `<ClaudeSession />` in a page
    // that imposes no height, so the document is the scroller. The observer
    // then watches against the viewport, which is what a null root means.
    const log = document.createElement('div')
    document.body.append(log)
    made.push(log)

    expect(scrollerFor(log)).toBe(document.scrollingElement)
  })

  test('says the page for nothing at all, rather than throwing', () => {
    expect(scrollerFor(null)).toBe(document.scrollingElement)
  })
})
