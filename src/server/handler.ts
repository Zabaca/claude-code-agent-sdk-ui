import type { Options } from '@anthropic-ai/claude-agent-sdk'

import { classify, type ClassifyInput } from '../core/classify.ts'
import type { FailedFrame, Frame, SettledFrame, SlashCommandInfo } from '../core/frame.ts'
import type { PartialText } from '../core/partial.ts'
import { pushable, type Pushable } from './pushable.ts'

// The willed half of the vocabulary, and the live text that is neither half,
// both live in `core` beside the Frames — one glossary, one place. Re-exported
// here so that everything that reached for them through the handler still can.
export type { AgentEvent, InterruptEvent, PromptEvent } from '../core/event.ts'
export type { PartialText } from '../core/partial.ts'

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

export type AgentQueryFactory = (params: AgentQueryParams) => AgentQuery

export type AgentQueryParams = {
  prompt: AsyncIterable<AgentPromptMessage>
  options: AgentQueryOptions
}

/**
 * What the handler pushes into streaming input when a Turn starts — the SDK's
 * own `SDKUserMessage` shape, named for the wire rather than for the glossary.
 * A Message in `CONTEXT.md` is an entry in the Transcript; this is not one.
 */
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
  /**
   * What the runtime advertises, described rather than merely named. `init`
   * lists bare names; this is where the descriptions, argument hints and
   * aliases come from.
   *
   * Optional, because a query that cannot describe itself is a menu with less
   * in it and never a Turn that failed.
   */
  supportedCommands?(): Promise<AgentSlashCommand[]>
}

/**
 * As much of the SDK's `SlashCommand` as this handler reads. Named for the wire
 * rather than for the glossary, and every field treated as optional on the way
 * in for the same reason `classify` treats an `SDKMessage` that way: a menu must
 * never fail a Turn because the SDK grew a field or dropped one.
 */
export type AgentSlashCommand = {
  /** The command's name, as the SDK gives it — without the leading slash. */
  name: string
  description?: string
  argumentHint?: string
  aliases?: string[]
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

        const from = resumeFrom(request.headers.get('last-event-id'))
        for (let index = from; index < this.#log.length; index++) {
          const frame = this.#log[index]
          if (frame) write(frameEvent(frame, index))
        }

        const letGo = () => {
          if (write) this.#listeners.delete(write)
          try {
            controller.close()
          } catch {
            // Already closed.
          }
        }

        if (request.signal.aborted) {
          letGo()
          return
        }

        this.#listeners.add(write)
        request.signal.addEventListener('abort', letGo)
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
      // A `supportedCommands()` still outstanding is deliberately not awaited
      // here. It looked like it belonged — "started at init, awaited after the
      // stream closes" — but nothing awaits this task: `#host` calls it as
      // `void this.#observe(query)`, and `#describe` swallows its own errors,
      // so awaiting here could not be observed by anything and could not
      // surface a rejection either. Code that exists to satisfy a phrase is
      // code nothing can hold to account.
      //
      // The half of that phrase with teeth is the other one: the await must
      // never happen *inside* the loop above, because the reply travels on the
      // stream the loop is pulling. `describing the commands never stops
      // messages being pulled` is what enforces it — move the await into the
      // loop and it stops passing and starts hanging, which is why it is raced
      // against a clock.
    }
  }

  #saw(message: ClassifyInput): void {
    const partial = partialIn(message)
    if (partial) {
      this.#partial(partial)
      return
    }
    // The runtime has just named what it loaded, so now it can be asked what it
    // advertises. Started here and never awaited here: see `#describe`.
    if (isInit(message)) this.#describe()
    for (const frame of classify(message)) this.#append(frame)
  }

  // --- what the runtime advertises ---------------------------------------------

  /**
   * Asks the runtime to describe its slash commands, and returns immediately.
   *
   * This is the one genuine concurrency hazard in the package. The reply to
   * `supportedCommands()` arrives on the same transport the messages arrive on,
   * so awaiting it from inside the message loop stops the loop pulling — and
   * the thing it is waiting for is behind the messages it has stopped pulling.
   * The handler then waits forever for something only it could have delivered.
   * Started here, resolved on its own, and awaited nowhere: the Frame it lands
   * is appended when the answer arrives, so there is nothing left for anyone to
   * wait on. See the `finally` in `#observe` for why not even teardown does.
   *
   * `init` already advertised the bare names, so what this adds is the
   * descriptions, argument hints and aliases — which is why a failure here is
   * caught and dropped rather than raised. A menu with less in it is not a Turn
   * that failed, and a Turn that died is a moment when knowing what you can type
   * is worth more than usual.
   */
  #describe(): void {
    const query = this.#query
    const ask = query?.supportedCommands
    if (!query || !ask) return

    void (async () => {
      try {
        const described = commandsIn(await ask.call(query))
        // REPLACE semantics reach the Transcript, so an empty answer retained
        // here would blank a menu `init` had already filled.
        if (described.length > 0) this.#append({ kind: 'commands', commands: described })
      } catch {
        // Caught at the call site, which is the only place it can be caught
        // without travelling up the observation task and being read as a query
        // that broke — failing a Turn that ran perfectly.
      }
    })()
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
    // An interrupt still in flight short-circuits the failure before it reaches
    // the log: what the runtime reports as an aborted Turn is retained here as a
    // Turn that finished as asked, because a stop the person asked for is not a
    // problem they have. `terminalReason` survives, so a consumer that wants to
    // tell an interrupt from a natural ending still can.
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

/** The runtime naming what it loaded — where a Session gets its id (ADR-0002). */
function isInit(message: ClassifyInput): boolean {
  return str(message['type']) === 'system' && str(message['subtype']) === 'init'
}

/**
 * What the runtime described, read the way `classify` reads an `SDKMessage`:
 * every field optional on the way in, and a record without a name dropped
 * rather than retained half-built.
 */
function commandsIn(described: unknown): SlashCommandInfo[] {
  if (!Array.isArray(described)) return []
  const commands: SlashCommandInfo[] = []
  for (const entry of described) {
    const command = record(entry)
    const name = command && str(command['name'])
    if (!command || name === undefined) continue
    commands.push(
      compact<SlashCommandInfo>({
        name,
        description: str(command['description']),
        argumentHint: str(command['argumentHint']),
        aliases: strings(command['aliases']),
      }),
    )
  }
  return commands
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.filter((entry): entry is string => typeof entry === 'string')
  return kept.length > 0 ? kept : undefined
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
