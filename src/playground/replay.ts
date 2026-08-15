import type { Frame, SlashCommandInfo } from '../core/frame.ts'
import { holdable } from '../core/image.ts'
import type { PartialText } from '../core/partial.ts'
import type { AgentEventSource, AgentEventSourceFactory, AgentFetch } from '../react/session.ts'

/**
 * Replay — the playground's other half, and the fourth job the Frame log does.
 *
 * The Frame log is already the wire format, the test fixture and the reconnect
 * mechanism. Here it is a driver: a scripted log played into
 * `useAgentSession`'s own injectable transport, so the whole surface runs with
 * no credential, no network and no SDK. A reviewer sees the UI in seconds and
 * for free.
 *
 * It stands in for the transport and for nothing else. `useAgentSession`,
 * `reduce` and the components are the same ones live mode runs — if replay and
 * live diverged in code, replay would stop proving anything about live. What
 * replay substitutes is exactly what the handler substitutes when it is given
 * a `createQuery`: where the Frames come from.
 */

/** One thing the script does: a Frame, live text, or a pause before either. */
export type Beat = {
  /** How long after the previous beat this one lands. */
  after?: number
  /** Retained, and delivered with its index as `id:` — as the handler does. */
  frame?: Frame
  /** Live text. No `id:`, so it never moves the resume cursor. */
  partial?: PartialText
}

/**
 * What there is to play. Data, handed in — the transport reads it and never
 * reaches for a particular one, which is what lets a test drive three beats
 * where the playground drives the whole corpus.
 */
export type ReplayScript = {
  /** Played as soon as the stream opens, so the screen is never empty. */
  opening: Beat[]
  /** What a prompt Event is answered with. */
  answer: (text: string) => Beat[]
  /**
   * The pictures the script names handles for. Replay has no host holding
   * bytes, so it holds its own — and the rule is the handler's: a Message names
   * a handle, and turning one into something a browser can fetch is a lookup.
   */
  held?: ReadonlyMap<string, string>
}

export type ReplayOptions = {
  /**
   * How the script waits between beats. The seam a test drives it at: one that
   * does not wait makes the whole script land in microtasks, with no timers.
   */
  wait?: (ms: number) => Promise<void>
  /** What to play. */
  script: ReplayScript
}

export type ReplayTransport = {
  /** For `useAgentSession({ createEventSource })`. */
  createEventSource: AgentEventSourceFactory
  /** For `useAgentSession({ fetch })` — where a willed Event arrives. */
  fetch: AgentFetch
  /**
   * For `useAgentSession({ imageSrc })` — where a held picture comes from when
   * there is no host holding it. See {@link ReplayScript.held}.
   */
  imageSrc: (handle: string) => string
  /** The retained log, as the handler keeps it. Index is the `id:`. */
  log: Frame[]
  /** Resolves once nothing is being played. */
  quiet(): Promise<void>
}

export function replayTransport(options: ReplayOptions): ReplayTransport {
  const wait = options.wait ?? sleep
  const { opening, answer } = options.script

  const log: Frame[] = []
  const listeners = new Map<string, ((event: { data: string; lastEventId: string }) => void)[]>()
  /**
   * The script's fixtures, plus whatever is pasted while the playground is
   * open. Copied rather than held, so a paste mints into this run and not into
   * the script's own constant.
   */
  const held = new Map(options.script.held ?? [])
  let minted = 0
  let started = false
  let playing: Promise<void> = Promise.resolve()
  /** Bumped by an interrupt, which is how a script in flight is cut short. */
  let epoch = 0

  const emit = (name: string, data: string, id: string): void => {
    for (const listener of listeners.get(name) ?? []) listener({ data, lastEventId: id })
  }

  /**
   * Replay's half of `imageSrc`. A lookup, and an empty string for anything it
   * is not holding — the same "nothing" the handler answers with, so the
   * both-cases property holds on this path too and a `../` gets no further here
   * than there.
   */
  const imageSrc = (handle: string): string => held.get(handle) ?? ''

  const retain = (frame: Frame): void => {
    log.push(frame)
    emit('frame', JSON.stringify(frame), String(log.length - 1))
  }

  const play = async (beats: Beat[]): Promise<void> => {
    const mine = epoch
    for (const beat of beats) {
      await wait(beat.after ?? 0)
      // An interrupt landed while this beat was waiting. What the runtime was
      // about to say is not said, exactly as a real abort would have it.
      if (epoch !== mine) return
      if (beat.frame) retain(beat.frame)
      if (beat.partial) emit('partial', JSON.stringify(beat.partial), '')
    }
  }

  /** Queues a script behind whatever is already playing, and reports quiet. */
  const start = (beats: Beat[]): void => {
    playing = playing.then(() => play(beats))
  }

  const createEventSource: AgentEventSourceFactory = () => {
    const source: AgentEventSource = {
      addEventListener: (name, listener) => {
        const registered = listeners.get(name) ?? []
        registered.push(listener)
        listeners.set(name, registered)
      },
      close: () => listeners.clear(),
    }
    // A source the browser opens sends no `Last-Event-ID`, so the whole log
    // comes down it — which is what a cold reload gets, and what makes a
    // reload of the playground show the Session it already had.
    queueMicrotask(() => {
      for (const [index, frame] of log.entries()) {
        emit('frame', JSON.stringify(frame), String(index))
      }
      if (started) return
      started = true
      start(opening)
    })
    return source
  }

  const fetch: AgentFetch = async (_endpoint, init) => {
    const event = parse(init.body)
    if (event?.type === 'prompt' && typeof event.text === 'string') {
      // The person's words are retained first, so the Message the hook put on
      // screen optimistically is settled by a Frame rather than left beside
      // one — the same order the handler produces.
      const text = event.text
      // And what they pasted comes back as Frames, ahead of the words, because
      // that is what live does: the pictures are pushed to the SDK as content
      // blocks, the SDK says the user message back, and `classify` reads an
      // image block out of it. A replay that took the pictures and showed
      // nothing would be replay disagreeing with live about what a paste is —
      // which is the one thing this transport exists not to do.
      //
      // Minted, never inlined. The Frame carries a handle and the bytes stay
      // here, exactly as `images.ts` keeps them in the host: a Message that
      // could name a location is a Message that could fetch from one, and that
      // rule does not get to be relaxed because there is no host today.
      const pictures = imagesIn(event.images).map((picture): Frame => {
        const handle = `img_replay_minted_${(minted += 1)}`
        held.set(handle, `data:${picture.mediaType};base64,${picture.data}`)
        return { kind: 'image', mediaType: picture.mediaType, handle }
      })
      start([...pictures.map((frame) => ({ frame })), { frame: { kind: 'prompt', text } }, ...answer(text)])
      return { ok: true, status: 202 }
    }
    if (event?.type === 'interrupt') {
      epoch += 1
      // A stop the person asked for is not a failure. The handler retains an
      // interrupted Turn as settled and keeps `terminalReason`, so replay does
      // the same rather than inventing a failure nobody had.
      retain({ kind: 'settled', terminalReason: 'aborted_streaming' })
      return { ok: true, status: 202 }
    }
    return { ok: false, status: 400 }
  }

  return { createEventSource, fetch, imageSrc, log, quiet: () => playing }
}

function parse(body: string): { type?: string; text?: unknown; images?: unknown } | undefined {
  try {
    return JSON.parse(body) as { type?: string; text?: unknown; images?: unknown }
  } catch {
    return undefined
  }
}

/**
 * The pictures out of a prompt Event, and nothing that is not one.
 *
 * The handler refuses the whole Event when one does not hold; replay is not a
 * guard, so it drops what will not hold and plays the rest. What it must not do
 * is *disagree* about which is which — a media type replay draws and live
 * answers 400 to is replay lying about what a paste is.
 */
function imagesIn(value: unknown): { mediaType: string; data: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const one = entry as { mediaType?: unknown; data?: unknown }
    const mediaType = typeof one?.mediaType === 'string' ? one.mediaType : undefined
    const data = typeof one?.data === 'string' ? one.data : undefined
    return mediaType !== undefined && data !== undefined && holdable({ mediaType, data })
      ? [{ mediaType, data }]
      : []
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
