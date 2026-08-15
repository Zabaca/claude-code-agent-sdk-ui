import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import { reduce } from '../core/reduce.ts'
import { useAgentSession } from '../react/session.ts'
import { ClaudeSession } from '../ui/session.tsx'
import { OPENING, replayTransport, type ReplayTransport } from './replay.ts'

test('replay drives the whole container with no credential and no network', async () => {
  const replay = replayTransport({ wait: immediately })
  const view = await mount(replay)

  await drain(replay)

  // Prose the agent "wrote", a tool that answered, and a tool that failed —
  // what a reviewer is meant to be able to see in seconds.
  expect(screen.getByText('Reading the test first.')).toBeDefined()
  // The main agent's own read, then the two the Threads ran — the second of
  // which failed, which is why the third status is not a success.
  expect(statuses('Read')).toEqual(['success', 'success', 'error'])
  // The failing run, then the passing one — a status that is read off the
  // line rather than only coloured.
  expect(statuses('Bash')).toEqual(['error', 'success', 'success'])
  // The Turn ended, so the working line is gone.
  expect(there(screen.queryByRole('status'))).toBe(false)
  view.unmount()
})

test('the composer reaches replay: a prompt is answered, and settles once', async () => {
  const replay = replayTransport({ wait: immediately })
  const view = await mount(replay)
  await drain(replay)

  await act(async () => {
    fireEvent.change(composer(), { target: { value: 'what is replay?' } })
  })
  await act(async () => {
    fireEvent.keyDown(composer(), { key: 'Enter' })
  })
  await drain(replay)

  // Once, not twice: the Frame replay retains for these words takes the
  // optimistic Message's place rather than landing beside it.
  expect(screen.queryAllByText('what is replay?').length).toBe(1)
  expect(screen.getByText(/Replaying an answer to/)).toBeDefined()
  // Replay took the Event, so there is nothing to report about it.
  expect(there(screen.queryByRole('alert'))).toBe(false)
  view.unmount()

  // And they were retained, not merely drawn: a reload has nothing but the
  // log to rebuild from, so words the log never took are words a refresh
  // loses.
  const reloaded = await mount(replay)
  await drain(replay)
  expect(screen.queryAllByText('what is replay?').length).toBe(1)
  expect(screen.getByText(/Replaying an answer to/)).toBeDefined()
  reloaded.unmount()
})

test('prose arrives word by word, before the block becomes a Frame', async () => {
  const clock = paced()
  const replay = replayTransport({ wait: clock.wait })
  const view = await mount(replay)

  // session, harness, commands, the prompt, then the block opening.
  await clock.beat(6)

  // Half a sentence is on screen and the log does not hold it yet: what is
  // there is live text, which is the thing that makes the interface feel
  // alive rather than arriving in blocks.
  const said = screen.getByRole('log').textContent ?? ''
  expect(said).toContain('Reading the')
  expect(said).not.toContain('Reading the test first.')
  expect(replay.log.some((frame) => frame.kind === 'text')).toBe(false)

  await clock.beat(4)
  expect(screen.getByRole('log').textContent).toContain('Reading the test first.')
  // And exactly once: the Frame takes the live copy's place rather than
  // landing beside it.
  expect(screen.queryAllByText('Reading the test first.').length).toBe(1)
  expect(replay.log.some((frame) => frame.kind === 'text')).toBe(true)
  view.unmount()
})

test('interrupting replay cuts the script short and ends the Turn idle', async () => {
  const clock = paced()
  const replay = replayTransport({ wait: clock.wait })
  const view = await mount(replay)

  // Far enough in that prose is streaming and a Turn is plainly running.
  await clock.beat(12)
  expect(screen.getByRole('status')).toBeDefined()
  const before = screen.getByRole('log').textContent ?? ''

  await act(async () => {
    fireEvent.keyDown(composer(), { key: 'Escape' })
  })
  // More beats than the whole script has, so anything still willing to play
  // would have played by now.
  await clock.beat(120)

  // A stop the person asked for is not a failure, and nothing the runtime was
  // about to say is said after it.
  expect(there(screen.queryByRole('status'))).toBe(false)
  expect(screen.getByRole('log').textContent).not.toContain('There it is')
  expect(screen.getByRole('log').textContent).not.toContain('the suite is green')
  expect(before).not.toBe('')

  // Retained as the handler retains it: a Turn that ended idle, keeping the
  // runtime's word for why. A stop the person asked for is not a problem
  // they have, and the log must not record one.
  expect(replay.log.map((frame) => frame.kind)).not.toContain('failed')
  expect(replay.log.at(-1)?.kind).toBe('settled')
  view.unmount()
})

test('a reload replays the log, because every Frame carries its index', async () => {
  const replay = replayTransport({ wait: immediately })
  const first = await mount(replay)
  await drain(replay)
  const said = screen.getByRole('log').textContent
  first.unmount()

  // A fresh page sends no `Last-Event-ID`, so the whole log comes down again.
  const second = await mount(replay)
  await drain(replay)
  expect(screen.getByRole('log').textContent).toBe(said)
  second.unmount()
})

test('replay shows three Threads running at once, told apart and metered', async () => {
  const replay = replayTransport({ wait: immediately })
  const view = await mount(replay)
  await drain(replay)

  // Three Threads, each saying what it was asked to do and what kind of agent
  // did it — and each with its own tool count, which is the assertion a script
  // that opened one Thread and drew it three times could not pass.
  expect(metered()).toEqual([
    { thread: 'toolu_task_core', state: 'settled', toolCalls: 2 },
    { thread: 'toolu_task_ui', state: 'settled', toolCalls: 1 },
    { thread: 'toolu_task_server', state: 'failed', toolCalls: 2 },
  ])

  // Every tool call the Threads ran is attributed to the Thread that ran it,
  // and the main agent's own work — the three `Task` calls and the first
  // Turn's five tools — is attributed to none of them.
  expect(attributed()).toEqual({
    toolu_task_core: 2,
    toolu_task_ui: 1,
    toolu_task_server: 2,
  })
  // And each meter says, in words, what its Thread was asked to do and what
  // kind of agent did it.
  expect(reads('toolu_task_server')).toContain('audit server')
  expect(reads('toolu_task_server')).toContain('general-purpose')
  expect(reads('toolu_task_ui')).toContain('audit ui')
  view.unmount()
})

test('the opening log shows prose and a tool call in every state it has', async () => {
  // A guard for the tickets that add their own case here: trimming the script
  // to prose would quietly turn the demo into a demo of less.
  const transcript = reduce(OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : [])))
  const kinds = transcript.messages.map((message) => message.kind)
  const statuses = transcript.messages.flatMap((message) =>
    message.kind === 'tool-call' ? [message.status] : [],
  )

  expect(kinds).toContain('prompt')
  expect(kinds).toContain('text')
  expect(statuses).toContain('success')
  expect(statuses).toContain('error')
  expect(transcript.turn).toEqual({ status: 'idle' })
})

test('the opening log plays every divergence, and each reaches the screen', async () => {
  const replay = replayTransport({ wait: immediately })
  const view = await mount(replay)
  await drain(replay)

  // The points where the Transcript reads the same before and after while what
  // the agent can see has changed. A playground that played none of them would
  // demonstrate the screen at its most convincing and least honest.
  expect(marks()).toEqual(['recall', 'hook', 'compacted', 'reset'])
  // And a Turn that died, beside the two that did not.
  expect(outcomes()).toEqual(['settled', 'failed', 'settled'])

  const said = screen.getByRole('log').textContent ?? ''
  expect(said).toContain('180,000')
  expect(said).toContain('42,000')
  expect(said).toContain('error_max_turns')

  // Two recall Frames were played and one marker was drawn: the one that
  // surfaced nothing is silent because nothing arrived, not because the
  // marker is missing — which is the whole distinction, shown rather than
  // asserted about a mock.
  expect(replay.log.filter((frame) => frame.kind === 'recall').length).toBe(2)
  view.unmount()
})

test('the opening log advertises commands, and changes them while it runs', async () => {
  // The same guard, for this ticket's case. A demo that showed bare names would
  // be a demo of exactly the thing the menu already had before #11 — the point
  // is the hint and the aliases — and one that advertised a list and never
  // touched it would leave `commands_changed` claimed but never shown.
  const frames = OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : []))
  const advertised = frames.filter((frame) => frame.kind === 'commands')
  expect(advertised.length).toBeGreaterThan(1)

  const last = reduce(frames).commands
  expect(last.some((command) => command.argumentHint !== undefined)).toBe(true)
  expect(last.some((command) => (command.aliases?.length ?? 0) > 0)).toBe(true)

  // REPLACE semantics, so the later list is the one that stands — and it is not
  // the one `init` gave, or nothing was demonstrated.
  expect(last.map((command) => command.name)).not.toEqual(
    advertised[0]?.kind === 'commands' ? advertised[0].commands.map((one) => one.name) : [],
  )
})

// --- driving the seam ---------------------------------------------------------

/** Which divergence each marker reports, in Transcript order. */
function marks(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-divergence]')].map(
    (one) => one.dataset['divergence'],
  )
}

/** Which outcome each Turn-ending entry claims, in Transcript order. */
function outcomes(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-outcome]')].map(
    (one) => one.dataset['outcome'],
  )
}

/** No waiting at all, so a whole script lands in microtasks and uses no timer. */
function immediately(): Promise<void> {
  return Promise.resolve()
}

/**
 * A `wait` a test resolves by hand, so a script can be stopped in the middle
 * of itself. Only ever one beat is waiting, because the script is sequential.
 */
function paced(): { wait: () => Promise<void>; beat(times?: number): Promise<void> } {
  const waiting: (() => void)[] = []
  return {
    wait: () => new Promise<void>((resolve) => waiting.push(resolve)),
    async beat(times = 1) {
      for (let at = 0; at < times; at++) {
        await act(async () => {
          waiting.shift()?.()
          await tick()
        })
      }
    },
  }
}

async function mount(replay: ReplayTransport): Promise<{ unmount(): void }> {
  function Host() {
    const session = useAgentSession({
      endpoint: 'replay',
      createEventSource: replay.createEventSource,
      fetch: replay.fetch,
    })
    return <ClaudeSession session={session} />
  }
  const view = render(<Host />)
  await act(async () => {
    await tick()
  })
  return view
}

/** Lets everything queued play out and React flush what it produced. */
async function drain(replay: ReplayTransport): Promise<void> {
  await act(async () => {
    await replay.quiet()
    await tick()
  })
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function composer(): HTMLInputElement {
  return screen.getByLabelText('Prompt') as HTMLInputElement
}

/** The status each of a tool's lines is drawn with, in Transcript order. */
function statuses(tool: string): (string | undefined)[] {
  return screen
    .queryAllByText(tool)
    .map((found) => found.closest('details')?.dataset['status'])
    .filter((status): status is string => status !== undefined)
}

/** What each Thread meter claims, in the order the Threads were opened. */
function metered(): { thread: string; state: string; toolCalls: number }[] {
  return [...document.querySelectorAll<HTMLElement>('[data-thread-meter]')].map((one) => ({
    thread: one.dataset['threadMeter'] ?? '',
    state: one.dataset['threadState'] ?? '',
    toolCalls: Number(one.dataset['threadTools']),
  }))
}

/** What one Thread's meter reads. */
function reads(thread: string): string {
  const found = document.querySelector(`[data-thread-meter="${thread}"]`)
  if (!found) throw new Error(`no meter for ${thread}`)
  return found.textContent ?? ''
}

/** How many tool calls the Transcript attributes to each Thread. */
function attributed(): Record<string, number> {
  const counted: Record<string, number> = {}
  for (const entry of document.querySelectorAll<HTMLElement>('[data-tool][data-thread]')) {
    const thread = entry.dataset['thread'] ?? ''
    counted[thread] = (counted[thread] ?? 0) + 1
  }
  return counted
}

/** Whether something is on screen. See the note in `ui/session.test.tsx`. */
function there(node: Element | null | undefined): boolean {
  return node !== null && node !== undefined
}
