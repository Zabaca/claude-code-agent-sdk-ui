import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'
import { StrictMode } from 'react'

import type { AgentEventSourceFactory } from '../react/session.ts'
import { Playground } from './app.tsx'
import { replayTransport, type ReplayTransport } from './replay.ts'
import { SCRIPT } from './script.ts'

test('the playground in replay mode needs no credential and no network', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = render(<Playground mode="replay" transport={replay} />)
  await drain(replay)

  expect(screen.getByText('Reading the test first.')).toBeDefined()
  expect(screen.getByLabelText('Prompt')).toBeDefined()
  view.unmount()
})

test('a mount React ran twice draws the log once, not twice', async () => {
  // The hook places a Frame at the index its `id:` names rather than pushing
  // it, and StrictMode is the cheapest way to hold it to that: the effect
  // runs, tears down and runs again, so the log is delivered a second time.
  const plain = replayTransport({ wait: immediately, script: SCRIPT })
  const once = render(<Playground mode="replay" transport={plain} />)
  await drain(plain)
  const expected = entries()
  once.unmount()

  const twice = replayTransport({ wait: immediately, script: SCRIPT })
  const strict = render(
    <StrictMode>
      <Playground mode="replay" transport={twice} />
    </StrictMode>,
  )
  await drain(twice)

  // The same script, the same Transcript — not each Message over again.
  expect(entries()).toEqual(expected)
  expect(expected.length).toBeGreaterThan(4)
  strict.unmount()
})

test('typing into the playground reaches replay rather than the network', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = render(<Playground mode="replay" transport={replay} />)
  await drain(replay)

  await act(async () => {
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'does this work?' } })
  })
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'Enter' })
  })
  await drain(replay)

  // Answered, and answered by the script: a playground whose composer went to
  // the browser's own `fetch` would either 404 or, worse, reach a real agent
  // from the mode that promises it never does.
  expect(screen.getByText(/Replaying an answer to/)).toBeDefined()
  expect(replay.log.some((frame) => frame.kind === 'prompt' && frame.text === 'does this work?'))
    .toBe(true)
  view.unmount()
})

test('the harness the runtime reported is what the header shows', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = render(<Playground mode="replay" transport={replay} />)

  // Before the runtime has said anything, the header says so rather than
  // inventing a model, a version or a working directory.
  expect(screen.getByText('no model reported yet')).toBeDefined()

  await drain(replay)

  // Twice on screen now, and deliberately: the welcome box states what the
  // runtime loaded once at the top, and the status line above the composer
  // keeps the same facts where a terminal keeps them — which is what Claude
  // Code itself does. `getByText` would fail on the pair, so this counts them.
  expect(screen.getByText('claude-opus-4')).toBeDefined()
  expect(screen.getByText('/repo')).toBeDefined()
  // And the status line under the composer says the same two facts in the
  // shorthand a status line uses: the directory by its name, the model in
  // brackets. Same source, drawn twice, exactly as the terminal does it.
  const status = document.querySelector('[data-status-line]')?.textContent ?? ''
  expect(status).toContain('repo')
  expect(status).toContain('[claude-opus-4]')
  view.unmount()
})

test('live mode opens the handler rather than the replay script', async () => {
  const opened: string[] = []
  const createEventSource: AgentEventSourceFactory = (endpoint) => {
    opened.push(endpoint)
    return { addEventListener: () => {}, close: () => {} }
  }
  // Replay's transport is handed in and must go unused: a live Session driven
  // by a scripted log would be the playground lying about what it is.
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = render(
    <Host createEventSource={createEventSource}>
      <Playground mode="live" endpoint="/agent" transport={replay} />
    </Host>,
  )
  await act(async () => {
    await tick()
  })

  expect(replay.log).toEqual([])
  expect(screen.queryAllByText('Reading the test first.').length).toBe(0)
  view.unmount()
})

// --- driving the seam ---------------------------------------------------------

/**
 * Live mode reaches for the browser's own `EventSource`, which no test has.
 * Standing one up for the duration is how the "live does not replay" claim is
 * made without a credential.
 */
function Host({
  createEventSource,
  children,
}: {
  createEventSource: AgentEventSourceFactory
  children: React.ReactNode
}) {
  const had = globalThis.EventSource
  class Stub {
    constructor(endpoint: string) {
      createEventSource(endpoint)
    }
    addEventListener() {}
    close() {}
  }
  globalThis.EventSource = Stub as unknown as typeof EventSource
  queueMicrotask(() => {
    globalThis.EventSource = had
  })
  return <>{children}</>
}

/** What the Transcript says, entry by entry, as text rather than as nodes. */
function entries(): string[] {
  return [...screen.getByRole('log').children].map((entry) => (entry.textContent ?? '').trim())
}

function immediately(): Promise<void> {
  return Promise.resolve()
}

async function drain(replay: ReplayTransport): Promise<void> {
  await act(async () => {
    await tick()
    await replay.quiet()
    await tick()
  })
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('the branch comes from the host, and its absence is silent', async () => {
  // No Frame carries a branch, so the playground asks its own server — which
  // is the only party that knows, being the one running inside the checkout.
  const original = globalThis.fetch
  globalThis.fetch = ((url: unknown) =>
    String(url) === '/branch'
      ? Promise.resolve(new Response(JSON.stringify({ branch: 'ticket/9' })))
      : Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof globalThis.fetch

  try {
    const replay = replayTransport({ wait: immediately, script: SCRIPT })
    const view = render(<Playground mode="replay" transport={replay} />)
    await drain(replay)
    expect(screen.getAllByText('git:(ticket/9)')[0]).toBeDefined()
    view.unmount()
  } finally {
    globalThis.fetch = original
  }

  // And where the host cannot say — no git, or a server that does not answer —
  // the line simply has no branch on it. A default of "main" would be the
  // playground stating a fact it does not have.
  globalThis.fetch = (() =>
    Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof globalThis.fetch
  try {
    const replay = replayTransport({ wait: immediately, script: SCRIPT })
    const view = render(<Playground mode="replay" transport={replay} />)
    await drain(replay)
    expect(document.querySelector('[data-status-line]')?.textContent ?? '').not.toContain('git:')
    view.unmount()
  } finally {
    globalThis.fetch = original
  }
})
