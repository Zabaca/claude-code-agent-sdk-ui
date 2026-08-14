import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import type { ClassifyInput } from './core/classify.ts'
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

// --- driving the seam ---------------------------------------------------------

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
          for (;;) {
            const at = buffered.indexOf('\n\n')
            if (at === -1) break
            const block = buffered.slice(0, at)
            buffered = buffered.slice(at + 2)
            let name = 'message'
            let data = ''
            for (const field of block.split('\n')) {
              if (field.startsWith('id: ')) lastEventId = field.slice(4)
              else if (field.startsWith('event: ')) name = field.slice(7)
              else if (field.startsWith('data: ')) data = field.slice(6)
            }
            for (const listener of listeners.get(name) ?? []) listener({ data, lastEventId })
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
