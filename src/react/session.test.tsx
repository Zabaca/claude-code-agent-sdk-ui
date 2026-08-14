import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'bun:test'

import { fakeSse, type FakeSse } from './fake.ts'
import {
  useAgentSession,
  type AgentFetch,
  type AgentSession,
  type AgentSessionOptions,
} from './session.ts'

test('the Transcript grows as Frames arrive', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  expect(session.current.transcript.messages).toEqual([])

  await act(async () => {
    fake.frame({ kind: 'session', sessionId: 'session-abc' })
    fake.frame({ kind: 'prompt', text: 'hello' })
  })

  expect(session.current.transcript.sessionId).toBe('session-abc')
  expect(session.current.transcript.messages).toEqual([{ kind: 'prompt', text: 'hello' }])
  expect(session.current.transcript.turn).toEqual({ status: 'working' })

  await act(async () => {
    fake.frame({ kind: 'text', text: 'Hello there' })
    fake.frame({ kind: 'settled', result: 'Hello there' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hello there' },
    { kind: 'outcome', outcome: 'settled', result: 'Hello there' },
  ])
  expect(session.current.transcript.turn).toEqual({ status: 'idle' })
})

test('sending a prompt starts a Turn, and interrupting stops it', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => session.current.send('write a novel'))

  expect(wire.posted).toEqual([
    { method: 'POST', contentType: 'application/json', body: { type: 'prompt', text: 'write a novel' } },
  ])
  expect(session.current.transcript.turn).toEqual({ status: 'working' })

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
    fake.frame({ kind: 'text', text: 'Once upon' })
  })

  expect(session.current.transcript.turn).toEqual({ status: 'working' })

  await act(async () => session.current.interrupt())

  expect(wire.posted[1]).toEqual({
    method: 'POST',
    contentType: 'application/json',
    body: { type: 'interrupt' },
  })

  // The Turn stops when the handler says it stopped, not when we asked.
  await act(async () => {
    fake.frame({ kind: 'settled', terminalReason: 'aborted_streaming' })
  })

  expect(session.current.transcript.turn).toEqual({ status: 'idle' })
  expect(session.current.transcript.messages.at(-1)).toEqual({
    kind: 'outcome',
    outcome: 'settled',
    terminalReason: 'aborted_streaming',
  })
})

test("a person's own Message shows at once, and is not doubled by its Frame", async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => session.current.send('hello'))

  // Shown before anything came back — nothing has been retained yet.
  expect(fake.log).toEqual([])
  expect(session.current.transcript.messages).toEqual([{ kind: 'prompt', text: 'hello' }])

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'hello' })
  })

  expect(session.current.transcript.messages).toEqual([{ kind: 'prompt', text: 'hello' }])

  // And it is the Frame's Message that stayed: the optimistic one carried none
  // of what the runtime knows about the prompt.
  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'a hook said so', synthetic: true })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'prompt', text: 'a hook said so', synthetic: true },
  ])
})

test('the same words sent twice stay two Messages', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    session.current.send('again')
    session.current.send('again')
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'again' },
    { kind: 'prompt', text: 'again' },
  ])

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'again' })
  })

  // One of the two is now the runtime's; the other is still only ours.
  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'again' },
    { kind: 'prompt', text: 'again' },
  ])

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'again' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'again' },
    { kind: 'prompt', text: 'again' },
  ])
})

test('a prompt nobody at the keyboard wrote settles nothing of theirs', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    session.current.send('carry on')
    session.current.send('carry on')
  })

  await act(async () => {
    // The runtime's own words, and a peer's, that happen to read the same. A
    // Turn the person did not start must not stand in for one they did.
    fake.frame({ kind: 'prompt', text: 'carry on', synthetic: true })
    fake.frame({ kind: 'prompt', text: 'carry on', origin: { kind: 'discord', from: 'someone' } })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'carry on', synthetic: true },
    { kind: 'prompt', text: 'carry on', origin: { kind: 'discord', from: 'someone' } },
    { kind: 'prompt', text: 'carry on' },
    { kind: 'prompt', text: 'carry on' },
  ])
})

test('a prompt the handler refuses is taken back off the Transcript', async () => {
  const fake = fakeSse()
  const wire = recorder(400)
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => session.current.send('hello'))

  expect(session.current.transcript.messages).toEqual([])
  expect(session.current.transcript.turn).toEqual({ status: 'idle' })
  expect(session.current.error).toBe('the handler refused the prompt Event: 400')
})

test('an interrupt that never reached the handler is said, not swallowed', async () => {
  const fake = fakeSse()
  const session = await mount(fake, {
    fetch: () => Promise.reject(new Error('the network went away')),
  })

  await act(async () => session.current.interrupt())

  expect(session.current.error).toBe('the network went away')
})

test('a caller who builds a transport each render does not restart the stream', async () => {
  const fake = fakeSse()
  const view = renderHook(() =>
    useAgentSession({ endpoint, createEventSource: (url) => fake.createEventSource(url) }),
  )
  await settle()

  view.rerender()
  view.rerender()
  await settle()

  // A fresh closure every render is not a reason to drop the stream and open
  // another — that would replay the whole log on every keystroke.
  expect(fake.sources).toHaveLength(1)
})

test('empty words start no Turn', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => session.current.send('   '))

  expect(wire.posted).toEqual([])
  expect(session.current.transcript.messages).toEqual([])
})

test('a page reload replays the log and gets the whole Transcript back', async () => {
  const fake = fakeSse()
  const before = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'session', sessionId: 'session-abc' })
    fake.frame({ kind: 'prompt', text: 'hello' })
    fake.frame({ kind: 'text', text: 'Hello there' })
    fake.frame({ kind: 'settled', result: 'Hello there' })
  })

  const kept = before.current.transcript

  // The page goes. Nothing of the hook's survives it.
  before.unmount()
  const after = await mount(fake)

  expect(after.current.transcript).toEqual(kept)
  expect(after.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hello there' },
    { kind: 'outcome', outcome: 'settled', result: 'Hello there' },
  ])
  // A fresh source sends no `Last-Event-ID`, so the handler replayed from 0.
  expect(fake.resumes).toEqual([0, 0])
})

test('a dropped connection resumes mid-stream, losing and doubling nothing', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'session', sessionId: 'session-abc' })
    fake.frame({ kind: 'prompt', text: 'hello' })
    // Live text carries no `id:`, so it must not move the resume cursor.
    fake.partial({ block: 0, kind: 'text', text: 'Hel' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hel' },
  ])

  await act(async () => {
    fake.drop()
    // Three more Frames happen while nothing is listening — including the whole
    // of the block that was half-written when the connection went. They reach
    // the log and no further, which is the gap the reconnect has to close.
    fake.frame({ kind: 'text', text: 'Hello' })
    fake.frame({ kind: 'text', text: ' there' })
    fake.frame({ kind: 'settled', result: 'Hello there' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hel' },
  ])

  await act(async () => fake.reconnect())

  // Resumed after the prompt Frame, not after the partial and not from 0.
  expect(fake.resumes).toEqual([0, 2])
  // One source throughout: the browser reconnected, it did not start again.
  expect(fake.sources).toHaveLength(1)
  // The half-written block is gone, not left beside the whole one: the
  // `partial` that would have closed it carried no `id:` and was never replayed.
  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hello there' },
    { kind: 'outcome', outcome: 'settled', result: 'Hello there' },
  ])
  expect(session.current.transcript.sessionId).toBe('session-abc')
})

test('a log replayed over Frames already held leaves the Transcript as it was', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'hello' })
    fake.frame({ kind: 'text', text: 'Hello there' })
    fake.frame({ kind: 'tool-call', id: 'call-1', name: 'Read', input: { file: 'a.ts' } })
    fake.frame({ kind: 'tool-result', id: 'call-1', output: 'ok', isError: false })
  })

  const held = session.current.transcript

  // Everything again, from 0 — a proxy that ate `Last-Event-ID`, or an effect
  // React ran a second time. Every Frame the hook holds arrives once more.
  await act(async () => fake.replay())

  expect(session.current.transcript).toEqual(held)
  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hello there' },
    {
      kind: 'tool-call',
      id: 'call-1',
      name: 'Read',
      input: { file: 'a.ts' },
      status: 'success',
      output: 'ok',
    },
  ])
})

test('words still on the wire survive a replay of the log', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const session = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'hello' })
    fake.frame({ kind: 'settled' })
  })

  // Said again, and the handler has not retained it yet.
  await act(async () => session.current.send('hello'))
  await act(async () => fake.replay())

  // The replayed prompt Frame is the old one settling a second time; it must
  // not stand in for words the handler has still not heard.
  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'outcome', outcome: 'settled' },
    { kind: 'prompt', text: 'hello' },
  ])
  expect(session.current.transcript.turn).toEqual({ status: 'working' })
})

test('live text replaces what it had, and is not added to it', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'hello' })
    fake.partial({ block: 0, kind: 'text', text: 'Hel' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hel' },
  ])

  await act(async () => fake.partial({ block: 0, kind: 'text', text: 'Hello there' }))

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'hello' },
    { kind: 'text', text: 'Hello there' },
  ])
})

test("a block's Frame takes the place of its live text rather than joining it", async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.partial({ block: 0, kind: 'text', text: 'Hello there' })
    fake.partial({ block: 0, kind: 'text', text: 'Hello there', done: true })
  })

  // The block closed and its Frame has not arrived. What was written stays on
  // screen: it did not stop being true.
  expect(session.current.transcript.messages).toEqual([{ kind: 'text', text: 'Hello there' }])

  await act(async () => fake.frame({ kind: 'text', text: 'Hello there' }))

  expect(session.current.transcript.messages).toEqual([{ kind: 'text', text: 'Hello there' }])
})

test('a block still being written is not the one a Frame settles', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.partial({ block: 0, kind: 'text', text: 'First.' })
    fake.partial({ block: 0, kind: 'text', text: 'First.', done: true })
    fake.partial({ block: 1, kind: 'text', text: 'Sec' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'text', text: 'First.' },
    { kind: 'text', text: 'Sec' },
  ])

  await act(async () => fake.frame({ kind: 'text', text: 'First.' }))

  expect(session.current.transcript.messages).toEqual([
    { kind: 'text', text: 'First.' },
    { kind: 'text', text: 'Sec' },
  ])

  await act(async () => {
    fake.partial({ block: 1, kind: 'text', text: 'Second.', done: true })
    fake.frame({ kind: 'text', text: 'Second.' })
  })

  // Two text Frames in a row are one Message, as `reduce` has them.
  expect(session.current.transcript.messages).toEqual([{ kind: 'text', text: 'First.Second.' }])
})

test("a Thread's live text is its own, not the agent's", async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    // Both are block 0. A block is identified by its Thread as well as its
    // index, or a sub-agent's prose overwrites the agent's.
    fake.partial({ block: 0, kind: 'text', text: 'Main says' })
    fake.partial({ block: 0, kind: 'text', text: 'Sub says', thread: 'call-1' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'text', text: 'Main says' },
    { kind: 'text', text: 'Sub says', thread: 'call-1' },
  ])

  await act(async () => fake.frame({ kind: 'text', text: 'Sub says.', thread: 'call-1' }))

  expect(session.current.transcript.messages).toEqual([
    { kind: 'text', text: 'Sub says.', thread: 'call-1' },
    { kind: 'text', text: 'Main says' },
  ])
})

test('live text does not outlive the Turn that was writing it', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
    fake.partial({ block: 0, kind: 'text', text: 'Once upon' })
  })

  expect(session.current.transcript.messages).toHaveLength(2)

  // Interrupted mid-block. The handler retained no Frame for it, so a reload
  // would not show it either — and what is on screen follows the log.
  await act(async () => fake.frame({ kind: 'settled', terminalReason: 'aborted_streaming' }))

  expect(session.current.transcript.messages).toEqual([
    { kind: 'prompt', text: 'write a novel' },
    { kind: 'outcome', outcome: 'settled', terminalReason: 'aborted_streaming' },
  ])
})

test('a Frame settles the block it is the whole of, not one of another kind', async () => {
  const fake = fakeSse()
  const session = await mount(fake, { reasoning: true })

  await act(async () => {
    // Deliberation opened first and is still being written when prose starts.
    fake.partial({ block: 0, kind: 'reasoning', text: 'Hmm, maybe' })
    fake.partial({ block: 1, kind: 'text', text: 'Yes' })
  })

  expect(session.current.transcript.messages).toEqual([
    { kind: 'reasoning', text: 'Hmm, maybe' },
    { kind: 'text', text: 'Yes' },
  ])

  await act(async () => fake.frame({ kind: 'text', text: 'Yes.' }))

  expect(session.current.transcript.messages).toEqual([
    { kind: 'text', text: 'Yes.' },
    { kind: 'reasoning', text: 'Hmm, maybe' },
  ])
})

test('deliberation stays out of the Transcript, live or retained, unless asked for', async () => {
  const fake = fakeSse()
  const quiet = await mount(fake)

  await act(async () => fake.partial({ block: 0, kind: 'reasoning', text: 'Let me think' }))

  // Still being written, and still not on screen.
  expect(quiet.current.transcript.messages).toEqual([])

  await act(async () => {
    fake.frame({ kind: 'reasoning', text: 'Let me think about it' })
    fake.frame({ kind: 'text', text: 'Yes.' })
  })

  expect(quiet.current.transcript.messages).toEqual([{ kind: 'text', text: 'Yes.' }])

  quiet.unmount()
  const asked = await mount(fake, { reasoning: true })

  await act(async () => fake.partial({ block: 1, kind: 'reasoning', text: 'And more' }))

  expect(asked.current.transcript.messages).toEqual([
    { kind: 'reasoning', text: 'Let me think about it' },
    { kind: 'text', text: 'Yes.' },
    { kind: 'reasoning', text: 'And more' },
  ])
})

test('mode is the permission mode the runtime actually loaded', async () => {
  const fake = fakeSse()
  const session = await mount(fake)

  // Nothing has been loaded yet, so the handler's own default stands (ADR-0003).
  expect(session.current.mode).toBe('auto')

  await act(async () => fake.frame({ kind: 'harness', permissionMode: 'plan' }))
  expect(session.current.mode).toBe('plan')

  await act(async () => fake.frame({ kind: 'harness', permissionMode: 'acceptEdits' }))
  expect(session.current.mode).toBe('accept-edits')

  await act(async () => fake.frame({ kind: 'harness', permissionMode: 'default' }))
  expect(session.current.mode).toBe('manual')
})

test("effort is the composer's own, because no Frame has a word for it", async () => {
  const fake = fakeSse()
  const session = await mount(fake, { effort: 'medium' })

  expect(session.current.effort).toBe('medium')

  await act(async () => session.current.setEffort('max'))

  expect(session.current.effort).toBe('max')
})

// --- driving the seam ---------------------------------------------------------

const endpoint = 'http://localhost/agent'

type Mounted = { readonly current: AgentSession; unmount(): void }

/** Renders the hook against the fake transport and lets the first replay land. */
async function mount(fake: FakeSse, options: Partial<AgentSessionOptions> = {}): Promise<Mounted> {
  const view = renderHook(() =>
    useAgentSession({ endpoint, createEventSource: fake.createEventSource, ...options }),
  )
  await settle()
  return {
    get current() {
      return view.result.current
    },
    unmount: view.unmount,
  }
}

/** Lets the transport's microtasks run and React flush what they produced. */
function settle(): Promise<void> {
  return act(async () => {
    await Promise.resolve()
  })
}

type Posted = { method: string; contentType: string | undefined; body: unknown }

/** Stands in for `fetch`, so what an Event puts on the wire is what is asserted. */
function recorder(status = 202): { posted: Posted[]; fetch: AgentFetch } {
  const posted: Posted[] = []
  return {
    posted,
    fetch: async (input, init) => {
      expect(input).toBe(endpoint)
      posted.push({
        method: init.method,
        contentType: init.headers['content-type'],
        body: JSON.parse(init.body) as unknown,
      })
      return { ok: status >= 200 && status < 300, status }
    },
  }
}
