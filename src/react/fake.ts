import type { Frame } from '../core/frame.ts'
import type { PartialText } from '../server/handler.ts'
import type { AgentEventSource, AgentEventSourceFactory, AgentServerEvent } from './session.ts'

/**
 * A stand-in for the browser's own SSE transport, so the hook's public surface
 * can be driven with no network. It is the seam `useAgentSession` takes a
 * `createEventSource` for, the way the handler takes a `createQuery`.
 *
 * It models what the browser actually does, because the reconnect behaviour
 * under test is the browser's and not ours:
 *
 *   - one `EventSource` object survives a reconnect, so the listeners the hook
 *     registered once keep receiving after a drop;
 *   - `Last-Event-ID` is whatever the last event carrying an `id:` said, so a
 *     `partial` — which carries none — never moves it;
 *   - a source the hook opens itself sends no `Last-Event-ID` at all, so it
 *     replays the log from 0, which is what a cold reload gets.
 *
 * It keeps the same append-only Frame log the handler keeps, so a Frame pushed
 * while nothing is connected is not lost — it is replayed on reconnect.
 */
export type FakeSse = {
  /** Hands the factory to `useAgentSession({ createEventSource })`. */
  createEventSource: AgentEventSourceFactory
  /** The retained Frame log, as the handler keeps it. Index is the `id:`. */
  log: Frame[]
  /** Every source the hook opened, in order. */
  sources: FakeSource[]
  /** Retains the Frame and delivers it with its index as `id:`. */
  frame(frame: Frame): void
  /** Delivers live text. No `id:`, so `Last-Event-ID` does not move. */
  partial(partial: PartialText): void
  /**
   * The connection goes away. Frames pushed from here on reach the log and
   * nothing else, which is the gap a reconnect has to close.
   */
  drop(): void
  /**
   * The browser reopens the dropped connection with `Last-Event-ID` and the
   * handler resumes from the next Frame. The same source object, so the
   * listeners the hook registered once are still the ones that receive, and
   * nothing about it reaches the hook.
   */
  reconnect(): void
  /**
   * The whole log again down the open source, as a server that lost the cursor
   * sends — a proxy that stripped `Last-Event-ID`, or React mounting the effect
   * twice. Every Frame the hook already holds arrives a second time.
   */
  replay(): void
  /** Where each resume started, so a test can say the cursor did not slip. */
  resumes: number[]
}

export type FakeSource = {
  endpoint: string
  /** What the browser would send as `Last-Event-ID` if it reconnected now. */
  lastEventId: string
  /** The hook let go of it — a page leaving, or an effect cleaning up. */
  closed: boolean
  /** The connection is down; the source is still the hook's. */
  down: boolean
}

type Listener = (event: AgentServerEvent) => void

type Source = FakeSource & { listeners: Map<string, Listener[]> }

export function fakeSse(): FakeSse {
  const sources: Source[] = []
  const log: Frame[] = []
  const resumes: number[] = []

  const open = (): Source | undefined => sources.find((source) => !source.closed)

  /** Delivered on a microtask, as a network does — never inside the caller. */
  const deliver = (source: Source, name: string, data: string, id?: string): void => {
    queueMicrotask(() => {
      if (source.closed || source.down) return
      if (id !== undefined) source.lastEventId = id
      for (const listener of source.listeners.get(name) ?? []) {
        listener({ data, lastEventId: source.lastEventId })
      }
    })
  }

  const send = (source: Source, from: number): void => {
    for (let index = from; index < log.length; index++) {
      const frame = log[index]
      if (frame) deliver(source, 'frame', JSON.stringify(frame), String(index))
    }
  }

  const createEventSource: AgentEventSourceFactory = (endpoint) => {
    const source: Source = {
      endpoint,
      lastEventId: '',
      closed: false,
      down: false,
      listeners: new Map(),
    }
    sources.push(source)
    // A source the hook opens sends no `Last-Event-ID`: it replays from 0.
    resumes.push(0)
    send(source, 0)

    const handle: AgentEventSource = {
      addEventListener: (name, listener) => {
        const registered = source.listeners.get(name) ?? []
        registered.push(listener)
        source.listeners.set(name, registered)
      },
      close: () => {
        source.closed = true
      },
    }
    return handle
  }

  return {
    createEventSource,
    log,
    sources,
    resumes,
    frame: (frame) => {
      log.push(frame)
      const source = open()
      if (source) deliver(source, 'frame', JSON.stringify(frame), String(log.length - 1))
    },
    partial: (partial) => {
      const source = open()
      if (source) deliver(source, 'partial', JSON.stringify(partial))
    },
    drop: () => {
      const source = open()
      if (source) source.down = true
    },
    reconnect: () => {
      const source = sources.find((one) => !one.closed && one.down)
      if (!source) return
      source.down = false
      const from = resumeFrom(source.lastEventId)
      resumes.push(from)
      send(source, from)
    },
    replay: () => {
      const source = open()
      if (!source) return
      resumes.push(0)
      send(source, 0)
    },
  }
}

/** `Last-Event-ID` names the last Frame that landed; resume with the next one. */
function resumeFrom(lastEventId: string): number {
  if (lastEventId === '') return 0
  const last = Number.parseInt(lastEventId, 10)
  return Number.isInteger(last) && last >= 0 ? last + 1 : 0
}
