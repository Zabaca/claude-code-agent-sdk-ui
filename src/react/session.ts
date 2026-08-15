'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { ClaudeEffort, ClaudeMode } from '../core/composer.ts'
import type { AgentEvent, PromptEvent, PromptImage } from '../core/event.ts'
import type { Frame } from '../core/frame.ts'
import { blockAt, isPartialKind, type PartialKind, type PartialText } from '../core/partial.ts'
import { reduce } from '../core/reduce.ts'
import type { Transcript } from '../core/transcript.ts'

/**
 * The browser half. Opens the SSE stream the handler serves, runs `reduce` over
 * the Frames arriving on it, and hands a composer what it needs.
 *
 * Reconnection is the browser's, not ours. A transient drop makes `EventSource`
 * reopen with `Last-Event-ID` and the handler resumes from the next Frame; a
 * cold reload opens a source that sends no such header and replays from 0,
 * which is what a fresh page wants. There is no cursor of ours to get wrong.
 *
 * What the hook does own is that a Frame is placed at the index its `id:` names
 * rather than pushed, so a Frame arriving twice — a proxy that dropped the
 * header, a mount React ran twice — overwrites itself instead of doubling the
 * Transcript.
 */
export function useAgentSession(options: AgentSessionOptions): AgentSession {
  const [state, apply] = useReducer(step, undefined, initial)
  const [effort, setEffort] = useState<ClaudeEffort>(options.effort ?? 'xhigh')
  const { endpoint } = options
  const reasoning = options.reasoning === true

  const create = useLatest(options.createEventSource ?? browserEventSource)
  const post = useLatest(options.fetch ?? browserFetch)

  useEffect(() => {
    const source = create.current(endpoint)
    source.addEventListener('frame', (event) => {
      apply({ type: 'frame', index: Number.parseInt(event.lastEventId, 10), body: event.data })
    })
    source.addEventListener('partial', (event) => {
      apply({ type: 'partial', body: event.data })
    })
    return () => source.close()
  }, [endpoint, create])

  /** Puts an Event on the wire, and says so if the handler would not take it. */
  const will = useCallback(
    async (event: AgentEvent): Promise<string | undefined> => {
      try {
        const response = await post.current(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        })
        if (response.ok) return undefined
        return `the handler refused the ${event.type} Event: ${response.status}`
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    [endpoint, post],
  )

  const send = useCallback(
    (text: string, images: PromptImage[] = []): void => {
      // Whitespace alone starts no Turn — but a picture is not whitespace. A
      // screenshot with no words is a whole prompt, and the guard that exists
      // to stop an empty composer willing a Turn must not eat one.
      if (text.trim() === '' && images.length === 0) return
      // Shown before the handler has said anything, and identified so that the
      // Frame for these exact words takes this Message's place rather than
      // being added beside it.
      const at = mark()
      apply({ type: 'sent', at, text })
      // Absent rather than empty when nothing was pasted: an always-present
      // `images: []` would change what every ordinary Turn puts on the wire.
      const event: PromptEvent =
        images.length === 0 ? { type: 'prompt', text } : { type: 'prompt', text, images }
      void will(event).then((refused) => {
        if (refused !== undefined) apply({ type: 'unsent', at, why: refused })
      })
    },
    [will],
  )

  /**
   * Where a held picture can be asked for. The endpoint is the hook's, so
   * composing this is the hook's job rather than a container's — and a handle
   * travels as a query parameter, never as a path segment, so there is nothing
   * here for a `../` to traverse even before the host's map lookup refuses it.
   */
  const resolve = options.imageSrc
  const imageSrc = useCallback(
    (handle: string): string =>
      resolve
        ? resolve(handle)
        : `${endpoint}${endpoint.includes('?') ? '&' : '?'}image=${encodeURIComponent(handle)}`,
    [endpoint, resolve],
  )

  const interrupt = useCallback((): void => {
    // Nothing optimistic: the Turn stops when the handler says it stopped. An
    // interrupt that never reached the runtime must not leave an idle Turn on
    // screen while the agent is still working.
    void will({ type: 'interrupt' }).then((refused) => {
      if (refused !== undefined) apply({ type: 'broke', why: refused })
    })
  }, [will])

  // One producer. Everything on screen — retained, still being written, or not
  // yet acknowledged — is placed by the module whose job placing is, so the
  // Transcript the hook hands out has the same index-stability the golden test
  // holds `reduce` to. Assembling the tail here instead is what used to move
  // the agent's words out from under their own React key whenever a Thread
  // streamed beside them.
  const transcript = useMemo(
    (): Transcript =>
      reduce(present(state.frames), { reasoning, live: state.live, sent: state.sent }),
    [state.frames, state.live, state.sent, reasoning],
  )

  const mode = useMemo(
    () => modeOf(transcript.harness?.permissionMode) ?? options.mode ?? 'auto',
    [transcript.harness?.permissionMode, options.mode],
  )

  return compact<AgentSession>({
    transcript,
    send,
    imageSrc,
    interrupt,
    mode,
    effort,
    setEffort,
    error: state.error,
  })
}

/** What the hook is given. Only `endpoint` is required. */
export type AgentSessionOptions = {
  /** The handler's URL — `GET` for the stream, `POST` for an Event. */
  endpoint: string
  /**
   * Stands in for the browser's own `EventSource`. The seam the hook is tested
   * at: with one of these the whole surface runs with no network.
   */
  createEventSource?: AgentEventSourceFactory
  /**
   * Stands in for the browser's `fetch`, which is how an Event reaches the
   * handler. Injected for the same reason as `createEventSource`; the browser's
   * own `fetch` satisfies it, so a host wanting to add a header can wrap one.
   */
  fetch?: AgentFetch
  /**
   * Put the agent's deliberation in the Transcript — live and retained alike.
   * Off by default, following "thinking is not an answer".
   */
  reasoning?: boolean
  /**
   * What the composer shows until the runtime has said what it loaded. The
   * handler's own default is `bypassPermissions`, which is `auto` (ADR-0003).
   */
  mode?: ClaudeMode
  /** What the composer's effort chip starts at. */
  effort?: ClaudeEffort
  /**
   * Where a held picture can be asked for, when it is not the handler holding
   * it. The third transport seam, beside `createEventSource` and `fetch`, and
   * there for the same reason: an image fetch is transport, and replay is a
   * whole surface running with no network behind it.
   *
   * It changes who holds the bytes and nothing else. A Message still names a
   * handle and only a handle; whoever resolves one is still expected to do it
   * by lookup, so a handle they never held gets nothing back.
   *
   * The default composes a query parameter against `endpoint`, which is what
   * the handler serves.
   */
  imageSrc?: (handle: string) => string
}

/** As much of `fetch` as the hook uses. The browser's own satisfies it. */
/**
 * The browser's own `fetch`, called on the window.
 *
 * Not `globalThis.fetch` itself: it is a native method, it is held in a ref and
 * called as `post.current(...)`, and that makes its `this` the ref rather than
 * the window — which Chrome refuses with "Failed to execute 'fetch' on
 * 'Window': Illegal invocation". Wrapped rather than bound so there is one
 * reference for the life of the module and nothing to rebind per render.
 *
 * Only live mode ever reaches it. Replay supplies its own `fetch`, and so does
 * every test, which is how this survived to be found in a browser.
 */
const browserFetch: AgentFetch = (endpoint, init) => globalThis.fetch(endpoint, init)

export type AgentFetch = (
  endpoint: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>

/** What a composer is handed. */
export type AgentSession = {
  /** What is on screen now, from everything that has happened. */
  transcript: Transcript
  /**
   * Wills a prompt Event. Whitespace alone starts no Turn.
   *
   * Pictures travel **ahead of the words** — the handler puts them there,
   * because a picture before the words about it reads better to the model.
   * They are payloads rather than handles, and that is the one direction the
   * handle rule does not run in: a handle is something the host minted, so a
   * person pasting a screenshot has none to name yet.
   */
  send(text: string, images?: PromptImage[]): void
  /**
   * Where to ask the host for a picture it is holding, by the handle it minted.
   * A Message names a handle and never a location, so this is the only thing
   * that turns one into something a browser can fetch — and what it makes is a
   * query parameter against this Session's own endpoint, so a handle the host
   * never minted resolves to nothing rather than to a file.
   */
  imageSrc(handle: string): string
  /** Wills an interrupt Event. The Turn ends when the handler says it did. */
  interrupt(): void
  /**
   * The permission mode the runtime actually loaded, in the composer's
   * vocabulary. Read-only, and deliberately: the client may not name what runs
   * (ADR-0001), and that is enforced by the wire rather than merely asserted —
   * an {@link AgentEvent} is a prompt or an interrupt, so there is no Event a
   * mode change could travel on.
   *
   * `ClaudePrompt` takes an `onModeChange`, and under this hook there is
   * nothing to give it: shift+tab cycling the mode line would change what the
   * composer says without changing what runs, which is worse than doing
   * nothing. Leave the prop unset until an Event exists that can carry it.
   */
  mode: ClaudeMode
  /**
   * How hard the model is asked to think. The composer's own state: no Frame
   * reports effort, so there is nothing to derive it from and nowhere to send
   * it. It is here because this is where a composer's state lives.
   */
  effort: ClaudeEffort
  setEffort(effort: ClaudeEffort): void
  /** Why the last Event did not reach the handler, if one did not. */
  error?: string
}

/** One SSE event, as much of `MessageEvent` as the hook reads. */
export type AgentServerEvent = {
  data: string
  /** For a `frame` this is its own `id:`; for a `partial`, the one before it. */
  lastEventId: string
}

/** As much of `EventSource` as the hook uses. */
export type AgentEventSource = {
  addEventListener(name: string, listener: (event: AgentServerEvent) => void): void
  close(): void
}

export type AgentEventSourceFactory = (endpoint: string) => AgentEventSource

// --- what has arrived -----------------------------------------------------------

type SessionState = {
  /**
   * Index-addressed, because a Frame's `id:` is its index in the handler's log.
   * Placing rather than pushing is what makes a redelivered Frame idempotent.
   */
  frames: (Frame | undefined)[]
  /** Blocks streaming right now, in the order they were started. */
  live: Live[]
  /** Prompts on the wire whose Frame has not come back yet. */
  sent: Sent[]
  error?: string
}

/**
 * A block of prose as it is being written. Never retained: the handler keeps
 * whole Messages in its log, so what is here is only ever what has not become
 * a Frame yet.
 */
type Live = {
  /** Thread and block index together, which is what identifies a block. */
  at: string
  kind: PartialKind
  text: string
  thread?: string
  /**
   * How many Frames had been retained when the block opened — where it belongs
   * in the order. Stamped once and moved only when a block ahead of it settles
   * into a Frame, so a block keeps the place it started at however much
   * arrives around it.
   */
  after: number
}

/** A person's words, shown before the handler has retained them. */
type Sent = { at: number; text: string }

type Arrival =
  | { type: 'frame'; index: number; body: string }
  | { type: 'partial'; body: string }
  | { type: 'sent'; at: number; text: string }
  | { type: 'unsent'; at: number; why: string }
  | { type: 'broke'; why: string }

function initial(): SessionState {
  return { frames: [], live: [], sent: [] }
}

function step(state: SessionState, arrival: Arrival): SessionState {
  switch (arrival.type) {
    case 'frame': {
      const frame = parse<Frame>(arrival.body)
      if (!frame || !Number.isInteger(arrival.index) || arrival.index < 0) return state

      // A Frame at an index already held is the same Frame again — a replay
      // from 0 after the header was lost, or a mount React ran twice. It
      // overwrites itself and nothing else happens: were it allowed to settle
      // an optimistic Message a second time, the replay would eat words still
      // on their way to the handler.
      const known = state.frames[arrival.index] !== undefined
      const frames = state.frames.slice()
      frames[arrival.index] = frame
      if (known) return { ...state, frames }

      return {
        ...state,
        frames,
        live: retire(state.live, frame, arrival.index),
        sent: settle(state.sent, frame),
      }
    }
    case 'partial': {
      const partial = parse<PartialText>(arrival.body)
      if (!partial || !isPartialKind(partial.kind)) return state
      const at = blockAt(partial)
      const held = state.live.findIndex((one) => one.at === at)
      const block = compact<Live>({
        at,
        kind: partial.kind,
        // The whole block so far, never an addition to it: the handler folds
        // the deltas and sends what the block holds.
        text: partial.text,
        thread: partial.thread,
        // Kept from when the block opened, never restamped: a delta arriving
        // after a Thread's Frame landed must not move the block it grows.
        //
        // Counted over what is present rather than over the array's length,
        // because a Frame arriving out of order leaves a hole and `reduce`
        // walks the log without one. Blocks opened at the same count keep
        // their relative order, which is the order they are held in.
        after: state.live[held]?.after ?? present(state.frames).length,
      })
      if (held === -1) return { ...state, live: [...state.live, block] }
      const live = state.live.slice()
      live[held] = block
      return { ...state, live }
    }
    case 'sent': {
      // The last refusal stops being worth reporting the moment fresh words are
      // on their way, so it is dropped rather than left standing.
      const { error, ...rest } = state
      return { ...rest, sent: [...state.sent, { at: arrival.at, text: arrival.text }] }
    }
    case 'unsent':
      return {
        ...state,
        sent: state.sent.filter((sent) => sent.at !== arrival.at),
        error: arrival.why,
      }
    case 'broke':
      return { ...state, error: arrival.why }
  }
}

/**
 * A block's Frame takes the live copy's place. The oldest live block of that
 * kind and Thread is the one it is the whole of, because blocks close in the
 * order they opened, so a Message of several blocks gives them up one Frame at
 * a time and the ones still being written stay.
 *
 * Not conditioned on having seen the block close: the `partial` saying so
 * carries no `id:` and is therefore never replayed, so a connection that
 * dropped mid-block would otherwise leave the half-written copy on screen
 * beside the whole one the reconnect brings.
 *
 * A Turn that ended takes every live block with it. The handler retains no
 * Frame for a block the runtime never completed, so a reload would not show it
 * either; what is on screen follows the log rather than outliving it.
 */
function retire(live: Live[], frame: Frame, index: number): Live[] {
  if (live.length === 0) return live
  if (frame.kind === 'settled' || frame.kind === 'failed') return []
  if (frame.kind !== 'text' && frame.kind !== 'reasoning') return live
  const at = live.findIndex((one) => one.kind === frame.kind && one.thread === frame.thread)
  if (at === -1) return live
  // The Frame takes the settled block's place, and that place was ahead of
  // every block opened after it — so those move past the Frame rather than
  // staying where a block that is no longer live used to be. Only blocks
  // behind the settled one move, and only far enough to clear it: a Frame that
  // settles nothing, which is most of them, moves nothing at all.
  return [
    ...live.slice(0, at),
    ...live.slice(at + 1).map((one) => ({ ...one, after: Math.max(one.after, index + 1) })),
  ]
}

/**
 * The Frame for words we already put on screen takes their place. Matched on
 * the words themselves and one at a time, so sending the same thing twice
 * leaves two Messages rather than collapsing into one — and a prompt the person
 * did not write, whether the runtime wrote it or a peer asked for it, settles
 * nothing.
 */
function settle(sent: Sent[], frame: Frame): Sent[] {
  if (sent.length === 0) return sent
  if (frame.kind !== 'prompt') return sent
  if (frame.synthetic === true || frame.origin !== undefined) return sent
  const at = sent.findIndex((one) => one.text === frame.text)
  if (at === -1) return sent
  return [...sent.slice(0, at), ...sent.slice(at + 1)]
}

/**
 * The runtime's permission mode in the composer's vocabulary. A mode nobody
 * here knows is not translated to a wrong one: the caller's own default stands
 * rather than the composer claiming something the runtime did not say.
 */
function modeOf(permissionMode: string | undefined): ClaudeMode | undefined {
  switch (permissionMode) {
    case 'bypassPermissions':
      return 'auto'
    case 'acceptEdits':
      return 'accept-edits'
    case 'plan':
      return 'plan'
    case 'default':
      return 'manual'
    default:
      return undefined
  }
}

/** Tells one optimistic Message from another, including two of the same words. */
let marks = 0
function mark(): number {
  marks += 1
  return marks
}

/** Drops keys whose value is missing, which `exactOptionalPropertyTypes` wants. */
function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

/** A log with a hole in it still renders what surrounds the hole. */
function present(frames: readonly (Frame | undefined)[]): Frame[] {
  const kept: Frame[] = []
  for (const frame of frames) if (frame) kept.push(frame)
  return kept
}

function parse<T>(body: string): T | undefined {
  try {
    return JSON.parse(body) as T
  } catch {
    return undefined
  }
}

// --- the browser's own transport ------------------------------------------------

/**
 * The default `createEventSource`. `EventSource` is reached for here and
 * nowhere else, so importing the hook costs nothing in an environment that has
 * none — a test, or a server render.
 */
function browserEventSource(endpoint: string): AgentEventSource {
  const source = new EventSource(endpoint)
  return {
    addEventListener: (name, listener) => {
      source.addEventListener(name, (event) => listener(event as MessageEvent))
    },
    close: () => source.close(),
  }
}

/**
 * Keeps the newest value reachable without making it a dependency. A caller who
 * passes a fresh closure every render must not thereby tear the stream down and
 * open it again.
 */
function useLatest<T>(value: T): { readonly current: T } {
  const held = useRef(value)
  useEffect(() => {
    held.current = value
  })
  return held
}
