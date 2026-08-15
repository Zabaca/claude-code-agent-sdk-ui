import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import type { ClassifyInput } from './core/classify.ts'
import { decodeEvents } from './core/wire.ts'
import { useAgentSession, type AgentEventSource, type AgentFetch } from './react/session.ts'
import { fakeQuery } from './server/fake.ts'
import { createAgentHandler, type AgentHandler } from './server/handler.ts'
import { ClaudeSession } from './ui/session.tsx'

/**
 * The whole stack in one test: an Event willed at the composer, through the
 * real handler, out as SSE, back through `useAgentSession`, `reduce` and the
 * container, onto a screen.
 *
 * Every other seam is driven with a stand-in for the layer beneath it, which
 * is right — and is also where an interrupt hid for three tickets. `reduce`
 * had a passing interrupt test the whole time, because it was fed a `failed`
 * Frame; the handler had a passing interrupt test, because it asserted the
 * Frame it retained. Neither could see that the Frame one produced was not
 * the Frame the other was tested against. Only the composition can.
 *
 * The one thing still faked is the SDK's `query()`, because a credential is
 * the one thing a test must never need.
 */

test('an interrupt driven through the whole stack reads as interrupted, not as a Turn that finished', async () => {
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('write a novel')
  await enter()

  // The runtime picks the work up, echoes what it was asked — which is what
  // settles the Message the composer put on screen optimistically — and
  // starts talking.
  await said(sdk, init('sess-e2e'), asked('write a novel'), says('Once upon a time'))
  expect(screen.getByText('Once upon a time')).toBeDefined()
  expect(there(screen.queryByRole('status'))).toBe(true)

  // The person stops it.
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'Escape' })
  })
  expect(sdk.interrupts).toBe(1)

  // And the runtime reports the abort the way it actually reports one: a
  // result that failed, carrying the terminal reason it failed for.
  await said(sdk, aborted())

  // The Turn is idle — a stop the person asked for is not a problem they have
  // — and the ending says which ending it was. Between those two claims sits
  // the whole defect: the handler retains an interrupt as a *settled* Frame,
  // so `settled` alone would draw this identically to a novel that finished.
  expect(outcomes()).toEqual(['interrupted'])
  const ending = ended()[0] ?? ''
  expect(ending).toContain('interrupted')
  expect(ending).not.toContain('failed')
  expect(there(screen.queryByRole('status'))).toBe(false)
  expect(there(screen.queryByRole('alert'))).toBe(false)

  view.unmount()
})

test('a Turn nobody stopped still reads as settled', async () => {
  // The other half of the same predicate: `terminalReason` decides, so a Turn
  // that ran to the end must not be swept up by the interrupt reading.
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('say hi')
  await enter()
  await said(sdk, init('sess-e2e-2'), asked('say hi'), says('Hello there'), settled())

  expect(outcomes()).toEqual(['settled'])
  expect(ended()[0]).toContain('settled')
  expect(sdk.interrupts).toBe(0)
  view.unmount()
})

/**
 * The slash menu, driven from where its contents actually come from.
 *
 * A unit test can feed the container a `commands` Frame of any shape it likes,
 * and the last defect on this project lived in exactly that gap — a Frame the
 * server never sends. So nothing here names a Frame: what goes in is an SDK
 * `init`, a `supportedCommands()` reply and a `commands_changed`, and what comes
 * out is read off the screen. Everything between is the real handler, the real
 * `classify`, the real `reduce` and the real container.
 */
test('what the runtime advertises is what the menu offers', async () => {
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('say hi')
  await enter()
  await said(sdk, initAdvertising('sess-slash', ['clear', 'usage']))

  // `init` advertises bare names, so that is all there is to go on at first.
  await type('/u')
  expect(offered()).toEqual(['/usage'])
  expect(row()).not.toContain('[window]')

  // The runtime describes them, on the same transport the messages travel.
  sdk.describes([
    {
      name: 'usage',
      description: 'Show what this Session has spent',
      argumentHint: '[window]',
      aliases: ['cost', 'stats'],
    },
  ])
  await said(sdk, says('Hello there'), settled())

  // The hint and the aliases are the whole reason for asking, and they only
  // reach the screen if every layer between carries them: the handler's reader,
  // the Frame, `reduce`'s REPLACE, and the row.
  expect(row()).toContain('Show what this Session has spent')
  expect(row()).toContain('[window]')
  expect(row()).toContain('/cost')

  // And the alias resolves, which is the thing a bare name cannot do.
  await type('/cos')
  expect(offered()).toEqual(['/usage'])

  view.unmount()
})

test('a skill discovered mid-Session is in the menu without a reload', async () => {
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('work in packages/api')
  await enter()
  await said(sdk, initAdvertising('sess-changed', ['clear']))

  await type('/dep')
  expect(offered()).toEqual([])

  // The SDK pushes the whole list again when it changes — REPLACE semantics,
  // which is why `/clear` goes with it.
  await said(sdk, commandsChanged())
  expect(offered()).toEqual(['/deploy'])
  await type('/cl')
  expect(offered()).toEqual([])

  view.unmount()
})

test('three concurrent Threads stay apart, and none of their work becomes the main agent’s', async () => {
  // The trap this whole ticket exists for, driven through the real wire: the
  // SDK says whose work a message is with `parent_tool_use_id`, and only the
  // composition can show that the id survives classify, the handler's SSE
  // framing, the hook and `reduce` all the way onto the screen.
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('audit the three packages')
  await enter()
  await said(
    sdk,
    init('sess-threads'),
    asked('audit the three packages'),
    // One assistant message opening three Threads at once, which is how the
    // runtime actually starts three background agents.
    opening(
      { id: 'toolu_task_core', description: 'audit core', subagent_type: 'Explore' },
      { id: 'toolu_task_ui', description: 'audit ui', subagent_type: 'Explore' },
      { id: 'toolu_task_server', description: 'audit server', subagent_type: 'general-purpose' },
    ),
  )

  // Their work arrives interleaved, as three agents running at once produce it.
  await said(
    sdk,
    inThread('toolu_task_core', uses('toolu_c1', 'Read', { file_path: '/repo/core/reduce.ts' })),
    inThread('toolu_task_ui', uses('toolu_u1', 'Grep', { pattern: 'cc:flex' })),
    inThread('toolu_task_server', uses('toolu_s1', 'Bash', { command: 'bun test src/server' })),
    inThread('toolu_task_core', uses('toolu_c2', 'Read', { file_path: '/repo/core/frame.ts' })),
  )

  // Every tool line the sub-agents ran is attributed to the Thread that ran it.
  expect(threadOf('Grep')).toEqual(['toolu_task_ui'])
  expect(threadOf('Bash')).toEqual(['toolu_task_server'])
  expect(threadOf('Read')).toEqual(['toolu_task_core', 'toolu_task_core'])
  // And the converse, which is the half that catches a Thread id dropped
  // anywhere on the wire: the only tool calls that are the main agent's own
  // are the three `Task` calls. Were `parent_tool_use_id` lost at any seam,
  // these four would join them here.
  expect(unattributed()).toEqual(['Task', 'Task', 'Task'])

  // Each `Task` call names the Thread it opened, and wears the same marker
  // that Thread's work wears — which is what makes the opener and the work it
  // started read as one line of work rather than two unrelated things.
  expect(opened()).toEqual(['toolu_task_core', 'toolu_task_ui', 'toolu_task_server'])
  expect(marker('[data-opens="toolu_task_ui"]')).toBe('↳2')
  expect(marker('[data-thread="toolu_task_ui"]')).toBe('↳2')

  // Three meters, one per Thread, each saying what it was asked to do, what
  // kind of agent is doing it, and how much it has done. Drawn from one Thread
  // and repeated three times, the tool counts would not disagree.
  expect(metered()).toEqual([
    { thread: 'toolu_task_core', state: 'running', toolCalls: 2 },
    { thread: 'toolu_task_ui', state: 'running', toolCalls: 1 },
    { thread: 'toolu_task_server', state: 'running', toolCalls: 1 },
  ])
  expect(meter('toolu_task_ui')).toContain('audit ui')
  expect(meter('toolu_task_server')).toContain('general-purpose')

  // And told apart at a glance, not only by id: three Threads, three colours
  // down the left edge. Drawn in one colour, a viewer would be back to reading
  // `tool_use` ids off the DOM to know who did what — which is the state this
  // surface exists to end.
  expect(new Set(hues()).size).toBe(3)

  // One Thread says how full its own window is. That reading rides on an
  // assistant message carrying the Thread's id, so this is also the whole of
  // #17 driven through the real wire: the number has to land on the Thread it
  // belongs to and nowhere else.
  // The main agent reports its own window in the same breath, and much fuller
  // — which is the pair that makes this a real check. Before #17 the second of
  // these two readings simply overwrote the first, whichever way round they
  // arrived.
  await said(sdk, holding('toolu_task_core', 7_400), holding(null, 190_000))
  expect(meter('toolu_task_core')).toContain('7.4k context')
  // And nothing is invented for the two that have not said. A zero would be
  // the screen making up a number for a window it has never seen; the Session's
  // 190k borrowed as theirs would be worse, because it looks like a reading.
  expect(meter('toolu_task_ui')).not.toContain('context')
  expect(meter('toolu_task_server')).not.toContain('context')
  expect(meter('toolu_task_ui')).not.toContain('190k')

  // One finishes. Its meter stops and reads as complete; the other two are
  // still going, so a meter keyed to Turn state rather than to its own Thread
  // would stop all three here.
  await said(sdk, answered(null, 'toolu_task_ui', 'no findings in ui'))
  expect(metered()).toEqual([
    { thread: 'toolu_task_core', state: 'running', toolCalls: 2 },
    { thread: 'toolu_task_ui', state: 'settled', toolCalls: 1 },
    { thread: 'toolu_task_server', state: 'running', toolCalls: 1 },
  ])

  view.unmount()
})

test('with a Thread’s prose forwarded, the main agent’s words stay the main agent’s', async () => {
  // #19's hazard, and the reason forwarding was only safe to turn on after
  // attribution landed. With it off, nothing but the main agent ever streamed
  // prose, so a block index alone identified a block. With it on, a sub-agent
  // streams too — and both start at block 0, because the index counts blocks
  // within a message and each is writing its own. Keyed by index alone, the
  // two sentences below grow the same bubble: whichever delta arrives next
  // appends to whatever the last one opened, and a background agent's words
  // land in the middle of the agent's answer to the person.
  //
  // Driven through the real handler, because its folding is where that key is.
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('delegate the audit')
  await enter()
  await said(
    sdk,
    init('sess-forward'),
    asked('delegate the audit'),
    opening({ id: 'toolu_task_core', description: 'audit core', subagent_type: 'Explore' }),
  )

  // Both open a block 0 and write into it, alternating — which is what two
  // agents talking at once actually puts on one stream.
  await said(
    sdk,
    blockOpens(null, 0),
    blockOpens('toolu_task_core', 0),
    writes(null, 0, 'The audit'),
    writes('toolu_task_core', 0, 'Reading'),
    writes(null, 0, ' is running.'),
    writes('toolu_task_core', 0, ' reduce.ts.'),
  )

  // Two lines, each whole, neither carrying a word of the other.
  expect(screen.getAllByText('The audit is running.')).toHaveLength(1)
  expect(screen.getAllByText('Reading reduce.ts.')).toHaveLength(1)

  // And attribution is the half #19 could have broken: forwarding makes more
  // messages carry `parent_tool_use_id`, so the risk runs both ways. The
  // Thread's sentence belongs to the Thread; the main agent's belongs to no
  // Thread at all and must not have acquired one.
  expect(threadHolding('Reading reduce.ts.')).toBe('toolu_task_core')
  expect(threadHolding('The audit is running.')).toBeUndefined()

  // The whole Turn's worth: exactly one entry on screen is a Thread's, and it
  // is none of the person's words, the `Task` call, or the agent's answer. A
  // blanket attribution would sweep those up and still pass the two
  // assertions above.
  expect(document.querySelectorAll('[data-thread]')).toHaveLength(1)
  view.unmount()
})

/**
 * Images through the whole stack, which is the only place the handle rule can
 * be shown to hold.
 *
 * Every claim it makes spans two layers. "A Message carries a handle and never
 * a payload" is the handler substituting and the browser drawing; "an unminted
 * handle resolves to nothing" is a URL the screen composed and a lookup the
 * host performs. Tested apart, each half can pass against a shape the other
 * never produces — which is exactly how the interrupt hid for three tickets.
 *
 * So nothing here names a Frame. What goes in is a paste and an SDK echo; what
 * comes out is read off the screen, and the picture is fetched back through the
 * real handler using the very `src` the real container rendered.
 */
test('a pasted screenshot reaches the model, and comes back as a handle rather than as bytes', async () => {
  const sdk = fakeQuery()
  const handler = createAgentHandler({ createQuery: sdk.createQuery })
  const view = await mount(handler)

  await paste(shot())
  await type('why is this button clipped')
  await enter()

  // What the model was actually handed: the picture ahead of the words, which
  // is the half no assertion about the screen could ever see.
  expect(sdk.prompts[0]?.message.content).toEqual([
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } },
    { type: 'text', text: 'why is this button clipped' },
  ])

  // The runtime says nothing back about the Turn — it does not echo a prompt
  // pushed into its input, which is why the handler retains the words and the
  // picture itself. The picture on screen below got there that way.
  await said(sdk, init('sess-image'))

  const picture = screen.getByRole('img') as HTMLImageElement
  expect(picture.alt).not.toBe('')

  // Nothing in the browser holds the payload. Asserted on the whole document
  // after a real round trip, rather than on the fields someone thought to
  // strip: the composer let go of the paste when it sent it, and what came
  // back names a handle.
  expect(document.body.innerHTML).not.toContain(PIXEL)
  expect(picture.src).not.toContain('data:')

  // And the handle resolves — through the same handler, at the URL the screen
  // composed. This is the case that stops "resolves to nothing" being
  // satisfied by the whole feature being absent.
  const held = await handler(new Request(picture.src))
  expect(held.status).toBe(200)
  expect(held.headers.get('content-type')).toBe('image/png')
  expect([...new Uint8Array(await held.arrayBuffer())]).toEqual(
    [...atob(PIXEL)].map((character) => character.charCodeAt(0)),
  )

  // The same URL with the handle swapped for something that wants to be a
  // path. It is a query parameter meeting a map lookup, so there is nothing to
  // traverse — and the answer is the same nothing every unminted handle gets.
  //
  // Breakage this fails on: a resolution that joins the handle onto a
  // directory, or that answers differently for "no such key" than for "not
  // yours" — either of which turns a handle into a way to ask about the disk.
  for (const wrong of ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', '/etc/passwd', 'img_0000']) {
    const refused = await handler(new Request(picture.src.replace(/image=.*$/, `image=${wrong}`)))
    expect(refused.status).toBe(404)
    expect(await refused.text()).toBe('')
  }

  view.unmount()
})

test('a Thread reports its own progress, and the meter prefers the runtime’s clock to its own', async () => {
  // `tool_progress` is the SDK's live word on a call still running — and for a
  // `Task` call, that call *is* the Thread. It carries an elapsed time the
  // runtime measured, which is the one thing this renderer could not know:
  // with no timestamp on any other Frame, a Thread joined mid-flight was timed
  // from first sight and could only ever be a lower bound.
  const sdk = fakeQuery()
  const view = await mount(createAgentHandler({ createQuery: sdk.createQuery }))

  await type('delegate the audit')
  await enter()
  await said(
    sdk,
    init('sess-progress'),
    asked('delegate the audit'),
    opening({ id: 'toolu_task_core', description: 'audit core', subagent_type: 'Explore' }),
  )

  // This screen has watched for no time at all and the runtime says the Thread
  // is 95 seconds in — exactly what a reload mid-flight produces.
  await said(sdk, progressing('toolu_task_core', 'Task', 95))

  expect(meter('toolu_task_core')).toContain('1m 35s')
  // Not the renderer's own answer, which is `0s` here. A meter that ignored
  // the runtime's number would report a Thread a minute and a half in as one
  // that had only just started.
  expect(meter('toolu_task_core')).not.toContain('0s')
  view.unmount()
})

test('a screenshot the agent captured is shown rather than described', async () => {
  const sdk = fakeQuery()
  const handler = createAgentHandler({ createQuery: sdk.createQuery })
  const view = await mount(handler)

  await type('show me the page')
  await enter()
  await said(
    sdk,
    init('sess-shown'),
    asked('show me the page'),
    calls('toolu_shot', 'Screenshot'),
    captured('toolu_shot', PIXEL),
  )

  // The agent put a picture in the Transcript, and it is a picture — not a
  // sentence about one, and not a tool result that mentions an image.
  const picture = screen.getByRole('img') as HTMLImageElement
  expect(picture.alt).toContain('toolu_shot')
  expect((await handler(new Request(picture.src))).status).toBe(200)
  expect(document.body.innerHTML).not.toContain(PIXEL)

  view.unmount()
})

// --- driving the seam ---------------------------------------------------------

/** A one-pixel PNG, small enough to read and real enough to decode. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function shot(): File {
  return new File([Uint8Array.from(atob(PIXEL), (c) => c.charCodeAt(0))], 'shot.png', {
    type: 'image/png',
  })
}

/** A screenshot arriving on the clipboard, as one does after a capture. */
function paste(file: File): Promise<void> {
  return act(async () => {
    fireEvent.paste(screen.getByLabelText('Prompt'), {
      clipboardData: { files: [file], items: [] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The command names the menu is offering, in the order it offers them. */
function offered(): string[] {
  return screen.queryAllByRole('option').map((one) => one.getAttribute('data-command') ?? '')
}

/** What the one offered row says. */
function row(): string {
  return screen.getByRole('option').textContent ?? ''
}

const endpoint = 'http://localhost/agent'

async function mount(handler: AgentHandler): Promise<{ unmount(): void }> {
  const wire = through(handler)
  function Host() {
    const session = useAgentSession({
      endpoint,
      createEventSource: wire.createEventSource,
      fetch: wire.fetch,
    })
    return <ClaudeSession session={session} />
  }
  const view = render(<Host />)
  await flush()
  return view
}

/**
 * The browser's half of the wire, over a handler held in memory: `GET` opens
 * the stream and its SSE framing is parsed exactly as `EventSource` would
 * parse it, `POST` carries an Event. Nothing here is the package's own code —
 * it is the part the browser normally provides.
 */
function through(handler: AgentHandler): {
  createEventSource: (endpoint: string) => AgentEventSource
  fetch: AgentFetch
} {
  return {
    createEventSource: (url) => {
      const listeners = new Map<string, ((event: { data: string; lastEventId: string }) => void)[]>()
      const stop = new AbortController()
      let lastEventId = ''

      void (async () => {
        const response = await handler(new Request(url, { signal: stop.signal }))
        const body = response.body
        if (!body) return
        const reader = body.getReader()
        const decoder = new TextDecoder()
        let buffered = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          buffered += decoder.decode(value, { stream: true })
          const arrived = decodeEvents(buffered)
          buffered = arrived.rest
          for (const event of arrived.events) {
            if (event.id !== undefined) lastEventId = event.id
            for (const listener of listeners.get(event.name) ?? []) {
              listener({ data: event.data, lastEventId })
            }
          }
        }
      })()

      return {
        addEventListener: (name, listener) => {
          const registered = listeners.get(name) ?? []
          registered.push(listener)
          listeners.set(name, registered)
        },
        close: () => stop.abort(),
      }
    },
    fetch: async (url, init) => {
      const response = await handler(
        new Request(url, { method: init.method, headers: init.headers, body: init.body }),
      )
      return { ok: response.ok, status: response.status }
    },
  }
}

/** Yields SDK messages and lets them travel the whole way to the screen. */
async function said(
  sdk: { say(message: ClassifyInput): void },
  ...messages: ClassifyInput[]
): Promise<void> {
  for (const message of messages) sdk.say(message)
  await flush()
}

/** A real stream has real turns of the event loop in it; so does this. */
function flush(): Promise<void> {
  return act(async () => {
    for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function type(text: string): Promise<void> {
  return act(async () => {
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: text } })
  })
}

async function enter(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'Enter' })
  })
  await flush()
}

/** What each Turn-ending entry says, in Transcript order. */
function ended(): string[] {
  return [...document.querySelectorAll('[data-outcome]')].map((one) =>
    (one.textContent ?? '').trim(),
  )
}

/** Which ending each one claims, in Transcript order. */
function outcomes(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-outcome]')].map(
    (one) => one.dataset['outcome'],
  )
}

function there(node: Element | null | undefined): boolean {
  return node !== null && node !== undefined
}

/** The Thread each of a tool's lines is attributed to, in Transcript order. */
function threadOf(tool: string): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-tool="${tool}"]`)].map(
    (entry) => entry.dataset['thread'],
  )
}

/** Every tool call the screen says is the main agent's own, in order. */
function unattributed(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-tool]')]
    .filter((entry) => entry.dataset['thread'] === undefined)
    .map((entry) => entry.dataset['tool'] ?? '')
}

/** The Thread each `Task` call says it opened, in Transcript order. */
function opened(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-opens]')].map(
    (entry) => entry.dataset['opens'],
  )
}

/** The Thread marker an entry wears — the short thing a reader matches on. */
function marker(selector: string): string {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`nothing matching ${selector}`)
  return found.querySelector('[aria-hidden]')?.textContent ?? ''
}

/** The colour each attributed entry is marked with, in Transcript order. */
function hues(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-thread]')].map(
    (entry) => entry.getAttribute('style') ?? '',
  )
}

/** What each Thread meter claims, in the order the Threads were opened. */
function metered(): { thread: string; state: string; toolCalls: number }[] {
  return [...document.querySelectorAll<HTMLElement>('[data-thread-meter]')].map((one) => ({
    thread: one.dataset['threadMeter'] ?? '',
    state: one.dataset['threadState'] ?? '',
    toolCalls: Number(one.dataset['threadTools']),
  }))
}

/** What one Thread's meter reads, for the parts that are words. */
function meter(thread: string): string {
  const found = document.querySelector(`[data-thread-meter="${thread}"]`)
  if (!found) throw new Error(`no meter for ${thread}`)
  return found.textContent ?? ''
}

/** An assistant message opening several Threads at once — one `Task` each. */
function opening(
  ...tasks: { id: string; description: string; subagent_type: string }[]
): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: tasks.map((task) => ({
        type: 'tool_use',
        id: task.id,
        name: 'Task',
        input: {
          description: task.description,
          subagent_type: task.subagent_type,
          prompt: `Audit and report: ${task.description}`,
        },
      })),
    },
  }
}

/**
 * A Thread reporting how full its own window is. The SDK hangs `context_usage`
 * off an assistant message, and that message names the Thread — which is what
 * makes a per-Thread token figure possible at all.
 */
function holding(thread: string | null, totalTokens: number): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: thread,
    message: { role: 'assistant', content: [] },
    context_usage: {
      model: 'claude-haiku-4',
      total_tokens: totalTokens,
      raw_max_tokens: 200000,
    },
  }
}

/** The Thread the entry holding these exact words belongs to, if any. */
function threadHolding(text: string): string | undefined {
  return screen.getByText(text).closest<HTMLElement>('[data-thread]')?.dataset['thread']
}

/**
 * A block opening on the stream. `parent_tool_use_id` is what says whose block
 * it is — and with a Thread's prose forwarded, two of them are open at once.
 */
function blockOpens(thread: string | null, index: number): ClassifyInput {
  return {
    type: 'stream_event',
    parent_tool_use_id: thread,
    event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  }
}

/** More of a block, as it is written. */
function writes(thread: string | null, index: number, text: string): ClassifyInput {
  return {
    type: 'stream_event',
    parent_tool_use_id: thread,
    event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
  }
}

/** The runtime's live word on a call still running, and how long it has been. */
function progressing(id: string, name: string, seconds: number): ClassifyInput {
  return {
    type: 'tool_progress',
    tool_use_id: id,
    tool_name: name,
    parent_tool_use_id: null,
    elapsed_time_seconds: seconds,
    subagent_type: 'Explore',
  }
}

/** What the runtime says for work done inside a Thread. */
function inThread(thread: string, block: Record<string, unknown>): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: thread,
    message: { role: 'assistant', content: [block] },
  }
}

function uses(id: string, name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: 'tool_use', id, name, input }
}

/** A tool answering. `thread` is null for the main agent's own calls. */
function answered(thread: string | null, id: string, output: string): ClassifyInput {
  return {
    type: 'user',
    parent_tool_use_id: thread,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: output }] }],
    },
  }
}

// --- SDK messages the fake yields ---------------------------------------------

function init(sessionId: string): ClassifyInput {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-opus-4',
    cwd: '/work',
    permissionMode: 'bypassPermissions',
  }
}

/** `init`, with the bare command names the runtime advertises on it. */
function initAdvertising(sessionId: string, commands: string[]): ClassifyInput {
  return { ...init(sessionId), slash_commands: commands }
}

/** What the SDK pushes when the list changes under the agent's feet. */
function commandsChanged(): ClassifyInput {
  return {
    type: 'system',
    subtype: 'commands_changed',
    commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>' }],
  }
}

/** A tool call, so the screenshot below has a call to be attributed to. */
function calls(id: string, name: string): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] },
  }
}

/** A tool handing back a screenshot for the Transcript to show. */
function captured(id: string, data: string): ClassifyInput {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: [
            { type: 'text', text: 'Captured.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
          ],
        },
      ],
    },
  }
}

/** The runtime echoing the words it was given — where a prompt Frame comes from. */
function asked(text: string): ClassifyInput {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function says(text: string): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }
}

function settled(): ClassifyInput {
  return { type: 'result', subtype: 'success', result: 'Hello there', num_turns: 1 }
}

/** What the runtime reports for a Turn the person stopped. */
function aborted(): ClassifyInput {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    num_turns: 1,
    terminal_reason: 'aborted_streaming',
    errors: ['Request was aborted'],
  }
}
