import type { Options } from '@anthropic-ai/claude-agent-sdk'

import { classify, type ClassifyInput } from '../core/classify.ts'
import type { FailedFrame, Frame, SettledFrame } from '../core/frame.ts'

/**
 * One handler, one Session (ADR-0002). It hosts the SDK's `query()`, classifies
 * every message it yields, keeps an append-only coalesced Frame log, and streams
 * Frames to the browser over SSE with `id:` set to the Frame index.
 *
 * `GET` opens the stream and replays the log — from `Last-Event-ID` where the
 * browser sent one, from the beginning where it did not, which is what a cold
 * reload wants. Two named events come down it: `frame`, one retained Frame with
 * its index as `id:`, and `partial`, live text carrying no `id:` at all.
 *
 * `POST` carries an {@link AgentEvent}. The client may never name `cwd`,
 * `tools`, `permissionMode` or `systemPrompt` (ADR-0001) — nothing but `type`
 * and `text` is ever read off a request, so there is nowhere to name them.
 */
export type AgentHandler = (request: Request) => Promise<Response>

/** What the host names when it constructs the handler. Never the client. */
export type AgentHandlerOptions = {
  /** Continue a prior Session by its id. */
  resume?: string
  cwd?: string
  model?: string
  systemPrompt?: Options['systemPrompt']
  /** Defaults to `bypassPermissions` (ADR-0003). */
  permissionMode?: Options['permissionMode']
  allowedTools?: string[]
  disallowedTools?: string[]
  /**
   * Stands in for the SDK's `query()`. The seam the handler is tested at: with
   * one of these the whole `Request → Response` path runs with no credential
   * and no network, and the SDK is never imported.
   */
  createQuery?: AgentQueryFactory
}

/** An Event — something a person willed, as opposed to a Frame, which is observed. */
export type AgentEvent = { type: 'prompt'; text: string } | { type: 'interrupt' }

export type AgentQueryFactory = (params: AgentQueryParams) => AgentQuery

export type AgentQueryParams = {
  prompt: AsyncIterable<AgentPromptMessage>
  options: AgentQueryOptions
}

/** What the handler pushes into streaming input when a Turn starts. */
export type AgentPromptMessage = {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: null
}

/** Only what this handler ever asks a query for. */
export type AgentQueryOptions = Pick<
  Options,
  | 'resume'
  | 'cwd'
  | 'model'
  | 'systemPrompt'
  | 'permissionMode'
  | 'allowDangerouslySkipPermissions'
  | 'allowedTools'
  | 'disallowedTools'
  | 'includePartialMessages'
>

/** Only what this handler ever asks of a query. */
export type AgentQuery = AsyncIterable<ClassifyInput> & {
  interrupt(): Promise<unknown>
  close?(): void
}

/**
 * Partial text on the wire. Deliberately not a Frame: a Frame is what the log
 * retains and what `reduce` consumes, and the log holds whole Messages. These
 * events carry no `id:`, so they never move the browser's `Last-Event-ID` and a
 * reconnect loses nothing by skipping them.
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

export function createAgentHandler(options: AgentHandlerOptions = {}): AgentHandler {
  const session = new AgentSession(options)
  return (request) => session.handle(request)
}

class AgentSession {
  readonly #options: AgentHandlerOptions
  readonly #log: Frame[] = []
  readonly #listeners = new Set<(chunk: string) => void>()
  /** Text and reasoning blocks open right now, keyed by Thread and block index. */
  readonly #open = new Map<string, { kind: 'text' | 'reasoning'; text: string; thread?: string }>()

  #query: AgentQuery | undefined
  #input: Pushable<AgentPromptMessage> | undefined
  #sessionId: string | undefined
  #turnOpen = false
  #interrupting = false

  constructor(options: AgentHandlerOptions) {
    this.#options = options
  }

  handle(request: Request): Promise<Response> {
    if (request.method === 'GET') return Promise.resolve(this.#stream(request))
    if (request.method === 'POST') return this.#willed(request)
    return Promise.resolve(new Response(null, { status: 405, headers: { allow: 'GET, POST' } }))
  }

  // --- the wire ---------------------------------------------------------------

  #stream(request: Request): Response {
    const encoder = new TextEncoder()
    let write: ((chunk: string) => void) | undefined

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        write = (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            // The browser let go mid-write; `cancel` unsubscribes us.
          }
        }

        for (let index = resumeFrom(request.headers.get('last-event-id')); index < this.#log.length; index++) {
          const frame = this.#log[index]
          if (frame) write(frameEvent(frame, index))
        }

        this.#listeners.add(write)
        request.signal.addEventListener('abort', () => {
          if (write) this.#listeners.delete(write)
          try {
            controller.close()
          } catch {
            // Already closed.
          }
        })
      },
      cancel: () => {
        if (write) this.#listeners.delete(write)
      },
    })

    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  /**
   * An Event arriving from the browser. `type` and `text` are the only fields
   * ever read: no request can name `cwd`, `tools`, `permissionMode` or
   * `systemPrompt`, because there is nowhere for it to name them (ADR-0001).
   */
  async #willed(request: Request): Promise<Response> {
    const body = await json(request)

    switch (str(body?.['type'])) {
      case 'prompt': {
        const text = str(body?.['text'])
        if (text === undefined) return refuse('a prompt Event needs `text`')
        await this.#send(text)
        return new Response(null, { status: 202 })
      }
      case 'interrupt': {
        await this.#interrupt()
        return new Response(null, { status: 202 })
      }
      default:
        return refuse('an Event is `{ type: "prompt", text }` or `{ type: "interrupt" }`')
    }
  }

  // --- hosting the query ------------------------------------------------------

  async #send(text: string): Promise<void> {
    const input = await this.#host()
    this.#turnOpen = true
    input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  /** Starts the query if it is not already running, and returns its input. */
  async #host(): Promise<Pushable<AgentPromptMessage>> {
    const running = this.#input
    if (running) return running

    const input = pushable<AgentPromptMessage>()
    // Lazily, and only here: the SDK reads a credential from the environment as
    // it loads, so a run that never starts a Turn must never pull it in.
    const createQuery = this.#options.createQuery ?? (await sdkQuery())
    const query = createQuery({ prompt: input, options: this.#queryOptions() })

    this.#input = input
    this.#query = query
    void this.#observe(query)
    return input
  }

  #queryOptions(): AgentQueryOptions {
    const host = this.#options
    const permissionMode = host.permissionMode ?? 'bypassPermissions'
    const options: AgentQueryOptions = { includePartialMessages: true, permissionMode }

    // The SDK refuses to bypass permissions unless the bypass is said twice, so
    // that it is never reached by default. Here it is the default (ADR-0003).
    if (permissionMode === 'bypassPermissions') options.allowDangerouslySkipPermissions = true

    // A Session that already named itself resumes as itself, so a query the
    // handler has to restart continues the same conversation.
    const resume = this.#sessionId ?? host.resume
    if (resume !== undefined) options.resume = resume
    if (host.cwd !== undefined) options.cwd = host.cwd
    if (host.model !== undefined) options.model = host.model
    if (host.systemPrompt !== undefined) options.systemPrompt = host.systemPrompt
    if (host.allowedTools !== undefined) options.allowedTools = host.allowedTools
    if (host.disallowedTools !== undefined) options.disallowedTools = host.disallowedTools

    return options
  }

  async #observe(query: AgentQuery): Promise<void> {
    try {
      for await (const message of query) this.#saw(message)
      this.#idle()
    } catch (error) {
      // An interrupt is not a failure: a stop the person asked for must never
      // overwrite an idle Turn with a problem nobody had.
      if (this.#interrupting) this.#idle()
      else this.#broke(error)
    } finally {
      this.#open.clear()
      if (this.#query === query) {
        this.#query = undefined
        this.#input = undefined
      }
    }
  }

  #saw(message: ClassifyInput): void {
    const partial = partialIn(message)
    if (partial) {
      this.#partial(partial)
      return
    }
    for (const frame of classify(message)) this.#append(frame)
  }

  // --- partial on the wire, coalesced in the log ------------------------------

  /**
   * Deltas stream live and are never retained. The block's deltas fold into its
   * whole text when it closes, and the log takes one Frame for the whole block
   * from the Message the SDK completes — so the log stays a bounded, whole-
   * Message, deterministic fixture rather than a timing-dependent recording.
   */
  #partial(event: { type: string; thread: string | undefined; body: Rec }): void {
    const { type, thread, body } = event
    if (type === 'message_start' || type === 'message_stop') {
      this.#open.clear()
      return
    }

    const block = num(body['index'])
    if (block === undefined) return
    const at = `${thread ?? ''}#${block}`

    if (type === 'content_block_start') {
      const started = record(body['content_block'])
      const kind = blockKind(str(started?.['type']))
      if (!kind) return
      this.#open.set(at, compact({ kind, text: str(started?.['text']) ?? '', thread }))
      return
    }

    const open = this.#open.get(at)
    if (!open) return

    if (type === 'content_block_delta') {
      const delta = record(body['delta'])
      const said = str(delta?.['text']) ?? str(delta?.['thinking'])
      if (said === undefined) return
      open.text += said
      this.#emit(partialEvent(compact<PartialText>({ block, ...open })))
      return
    }

    if (type === 'content_block_stop') {
      this.#open.delete(at)
      this.#emit(partialEvent(compact<PartialText>({ block, ...open, done: true })))
    }
  }

  // --- the log ----------------------------------------------------------------

  #append(frame: Frame): void {
    // `signal.aborted` short-circuits before any failure Frame is emitted: what
    // the runtime calls an aborted Turn is, here, a Turn that finished as asked.
    const retained = frame.kind === 'failed' && this.#interrupting ? idleFrom(frame) : frame

    if (retained.kind === 'session') this.#sessionId = retained.sessionId
    if (retained.kind === 'settled' || retained.kind === 'failed') {
      this.#turnOpen = false
      this.#interrupting = false
    }

    this.#log.push(retained)
    this.#emit(frameEvent(retained, this.#log.length - 1))
  }

  /** The Turn stopped without the runtime saying so. It is idle, not broken. */
  #idle(): void {
    if (this.#turnOpen) this.#append({ kind: 'settled' })
    this.#interrupting = false
  }

  #broke(error: unknown): void {
    if (!this.#turnOpen) return
    this.#append({
      kind: 'failed',
      subtype: 'error_during_execution',
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  #emit(chunk: string): void {
    for (const listener of this.#listeners) listener(chunk)
  }

  // --- interrupt --------------------------------------------------------------

  async #interrupt(): Promise<void> {
    const query = this.#query
    if (!query || !this.#turnOpen) return

    this.#interrupting = true
    try {
      await query.interrupt()
    } catch {
      // The query could not be asked politely; end it and let the loop settle.
      query.close?.()
    }
  }
}

// --- SSE framing ---------------------------------------------------------------

function frameEvent(frame: Frame, index: number): string {
  return `id: ${index}\nevent: frame\ndata: ${JSON.stringify(frame)}\n\n`
}

/** No `id:`, so a partial never moves the browser's resume cursor. */
function partialEvent(partial: PartialText): string {
  return `event: partial\ndata: ${JSON.stringify(partial)}\n\n`
}

/** `Last-Event-ID` names the last Frame that landed; resume with the next one. */
function resumeFrom(lastEventId: string | null): number {
  if (lastEventId === null) return 0
  const last = Number.parseInt(lastEventId, 10)
  return Number.isInteger(last) && last >= 0 ? last + 1 : 0
}

// --- reading a shape we do not control ------------------------------------------

type Rec = Record<string, unknown>

/** The SDK is loaded here and nowhere else, so no import costs a credential. */
async function sdkQuery(): Promise<AgentQueryFactory> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  return sdk.query as unknown as AgentQueryFactory
}

function partialIn(
  message: ClassifyInput,
): { type: string; thread: string | undefined; body: Rec } | undefined {
  if (str(message['type']) !== 'stream_event') return undefined
  const body = record(message['event'])
  const type = body && str(body['type'])
  if (!body || type === undefined) return undefined
  return { type, thread: str(message['parent_tool_use_id']), body }
}

function blockKind(type: string | undefined): 'text' | 'reasoning' | undefined {
  if (type === 'text') return 'text'
  if (type === 'thinking') return 'reasoning'
  return undefined
}

/** An interrupted Turn ends idle, keeping what the runtime measured of it. */
function idleFrom(failed: FailedFrame): SettledFrame {
  return compact<SettledFrame>({
    kind: 'settled',
    turns: failed.turns,
    durationMs: failed.durationMs,
    terminalReason: failed.terminalReason,
  })
}

async function json(request: Request): Promise<Rec | undefined> {
  try {
    return record(await request.json())
  } catch {
    return undefined
  }
}

function refuse(why: string): Response {
  return new Response(JSON.stringify({ error: why }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  const out: Rec = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

function record(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// --- streaming input -----------------------------------------------------------

type Pushable<T> = AsyncIterable<T> & { push(item: T): void }

/** A queue read as an async iterable — the shape streaming input takes. */
function pushable<T>(): Pushable<T> {
  const items: T[] = []
  let wake: (() => void) | undefined

  return {
    push: (item) => {
      items.push(item)
      const resume = wake
      wake = undefined
      resume?.()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = items.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
