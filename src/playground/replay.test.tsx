import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import { reduce } from '../core/reduce.ts'
import { useAgentSession } from '../react/session.ts'
import { ClaudeSession } from '../ui/session.tsx'
import { replayTransport, type ReplayTransport } from './replay.ts'
import { OPENING, SCRIPT } from './script.ts'

test('replay drives the whole container with no credential and no network', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
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
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
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
  const replay = replayTransport({ wait: clock.wait, script: SCRIPT })
  const view = await mount(replay)

  // session, harness, commands, the prompt, the deliberation, then the block
  // opening. The deliberation is a Frame like any other on the wire — it is
  // only the Transcript it is kept out of — so it takes a beat here.
  await clock.beat(7)

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
  const replay = replayTransport({ wait: clock.wait, script: SCRIPT })
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
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
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
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
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

  // The Thread that reported a window shows it; the two that did not show no
  // figure — not a zero, and not the main agent's 186k borrowed as theirs.
  expect(reads('toolu_task_core')).toContain('7.4k context')

  // A Thread's own prose, on screen and attributed. Without the handler asking
  // for it (#19) this line would not exist at all, and the playground would be
  // demonstrating the heartbeat-counter view it was built to replace.
  const spoke = screen.getByText('Checking whether reduce touches a clock.')
  expect(spoke.closest<HTMLElement>('[data-thread]')?.dataset['thread']).toBe('toolu_task_core')
  expect(reads('toolu_task_ui')).not.toContain('context')
  expect(reads('toolu_task_ui')).not.toContain('186k')
  view.unmount()
})

test('the opening log plays every divergence, and each reaches the screen', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)

  // The points where the Transcript reads the same before and after while what
  // the agent can see has changed. A playground that played none of them would
  // demonstrate the screen at its most convincing and least honest.
  expect(marks()).toEqual(['recall', 'hook', 'compacted', 'reset'])
  // And a Turn that died, beside the ones that did not — the pictures case
  // and the Thread case both appended their own after the divergences.
  expect(outcomes()).toEqual(['settled', 'failed', 'settled', 'settled', 'settled'])

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

test('the opening log deliberates, and the playground does not show it', async () => {
  const frames = OPENING.flatMap((beat) => (beat.frame ? [beat.frame] : []))
  const thought = frames.flatMap((frame) => (frame.kind === 'reasoning' ? [frame.text] : []))

  // Played, so the default is demonstrated against something rather than
  // asserted about an empty log.
  expect(thought.length).toBeGreaterThan(0)

  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)

  const shown = screen.getByRole('log').textContent ?? ''
  for (const line of thought) expect(shown).not.toContain(line)
  // And the Turn it was thinking during did reach the screen, so the silence
  // above is deliberation being withheld rather than the script not running.
  expect(shown).toContain('Pinned, and the suite is green.')

  view.unmount()
})

test('the opening log edits a file, and the edit is drawn as the change it made', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)

  // The same guard, for this ticket's case. A script whose `Edit` answered
  // with prose alone would demo a collapsed line saying "Applied 1 edit" — the
  // playground would look untouched by #8 while every test still passed.
  const edit = document.querySelector('[data-diff="/repo/src/core/reduce.test.ts"]')
  if (!edit) throw new Error('the opening log draws no diff')

  const said = edit.textContent ?? ''
  expect(said).toContain('Updated with')
  // Two hunks, so the gap between them is on screen rather than only tested.
  // Without it the playground shows one continuous stretch of a file.
  expect(said).toContain('⋯')
  expect(said).toContain('reduce(fixture)')

  // And a file that did not exist before, which is the case a reviewer most
  // needs to see told apart from an edit.
  const written = document.querySelector('[data-diff="/repo/src/core/fixtures/frames.json"]')
  expect((written?.textContent ?? '').includes('Created with')).toBe(true)
  view.unmount()
})

test("the opening log states a plan, and the plan moves while it runs", async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)

  // Two `TodoWrite` calls, not one. A single list would show three states side
  // by side and never show a task *changing* state — which is the only thing a
  // todo list is for, and the thing a static screenshot cannot demonstrate.
  const lists = [...document.querySelectorAll('[data-todos]')]
  expect(lists.length).toBeGreaterThan(1)

  const first = lists[0]?.textContent ?? ''
  const last = lists.at(-1)?.textContent ?? ''
  expect(first).not.toBe(last)

  // All three states are drawn across the demo, each announced in words.
  const everything = lists.map((one) => one.textContent ?? '').join(' ')
  expect(everything).toContain('(completed)')
  expect(everything).toContain('(in progress)')
  expect(everything).toContain('(pending)')
  view.unmount()
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

test('the replay log has pictures in it, held and unheld, and neither names a location', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)

  // All three states, counted exactly, and each identified by which one it is.
  //
  // The first draft of this asserted `>= 2` pictures and `>= 1` with an image
  // in it, and stayed green when the *pasted* screenshot was deleted from the
  // script — the agent's one and the unheld one satisfied both thresholds. A
  // loose count is how a demo quietly loses half of what it is demonstrating,
  // so each state is named and counted on its own.
  //
  // Breakage each of these fails on: dropping the pasted screenshot, dropping
  // the one the agent captured, or dropping the one the host could not hold —
  // the last of which is what makes the other two legible as *held* rather
  // than as the only thing the surface can do.
  expect(shownAs('pasted', { drawn: true })).toBe(1)
  expect(shownAs('shown', { drawn: true })).toBe(1)
  expect(shownAs('pasted', { drawn: false })).toBe(1)
  expect(document.querySelectorAll('[data-image]').length).toBe(3)
  expect(
    [...document.querySelectorAll('[data-image]')].filter((one) =>
      (one.textContent ?? '').includes('not held'),
    ).length,
  ).toBe(1)

  // The Frames replay retains are the Frames the handler retains: a handle,
  // and never a payload or a location. A replay log that carried bytes would
  // be a fixture of a wire format the handler does not produce.
  const pictures = replay.log.filter((frame) => frame.kind === 'image')
  expect(pictures.length).toBe(3)
  for (const picture of pictures) {
    expect(picture).not.toHaveProperty('data')
    expect(picture).not.toHaveProperty('url')
  }

  // And every picture on screen is drawn with alt text, which is required.
  for (const picture of document.querySelectorAll<HTMLImageElement>('[data-image] img')) {
    expect(picture.alt).not.toBe('')
  }
  view.unmount()
})

test('replay resolves a handle it holds, and nothing at all for one it does not', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })

  // The same both-cases-one-screen shape the handler is held to. Replay holds
  // its own fixtures rather than reaching for a host — but it resolves them
  // the same way the host does, by lookup, so a handle nobody put there gets
  // nothing back.
  //
  // Breakage this fails on: a resolver that builds a URL out of whatever it is
  // handed, which is how a `../` would get somewhere in replay even though it
  // cannot in live.
  const held = OPENING.flatMap((beat) =>
    beat.frame?.kind === 'image' && beat.frame.handle !== undefined ? [beat.frame.handle] : [],
  )
  expect(held.length).toBeGreaterThanOrEqual(1)
  const handle = held[0] ?? ''
  expect(replay.imageSrc(handle)).not.toBe('')
  for (const wrong of ['../../etc/passwd', 'img_nobody_minted', '']) {
    expect(replay.imageSrc(wrong)).toBe('')
  }
})

test('a screenshot pasted into replay comes back as a picture in the Transcript', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const view = await mount(replay)
  await drain(replay)
  const before = shownAs('pasted', { drawn: true })

  const file = new File(['a screenshot'], 'image.png', { type: 'image/png' })
  await act(async () => {
    fireEvent.paste(composer(), { clipboardData: { files: [file], items: [] } })
    await tick()
  })
  await act(async () => {
    fireEvent.keyDown(composer(), { key: 'Enter' })
    await tick()
  })
  await drain(replay)

  // Live pushes the pictures to the SDK as content blocks, the SDK says the
  // user message back, and `classify` reads an image block out of it — so a
  // paste ends up on screen. Replay has to end up there too, or the playground
  // is demonstrating something the product does not do.
  //
  // Breakage this fails on: replay reading `text` off the Event and ignoring
  // `images`, which is what shipped — the tray showed the picture, the markers
  // went into the words, the Turn ran, and the Transcript showed the sentence
  // with nothing beside it.
  expect(shownAs('pasted', { drawn: true })).toBe(before + 1)

  // And by a handle, minted here, with the bytes staying here. A replay log
  // that carried a payload would be a fixture of a wire the handler does not
  // produce.
  const minted = replay.log.filter(
    (frame) => frame.kind === 'image' && frame.handle?.includes('minted'),
  )
  expect(minted).toHaveLength(1)
  const picture = minted[0]
  expect(picture?.kind === 'image' && picture.data).toBeUndefined()
  expect(picture?.kind === 'image' && picture.url).toBeUndefined()
  expect(picture?.kind === 'image' ? replay.imageSrc(picture.handle ?? '') : '').toBe(
    `data:image/png;base64,${btoa('a screenshot')}`,
  )
  view.unmount()
})

test('what replay holds are pictures, not single pixels', () => {
  // The playground exists to show the surface, and a 1×1 pixel shows nothing
  // about how a picture is laid out. It was a 1×1 that made the stretched-image
  // bug look like a broken image instead: blown up by the column flex, an empty
  // square filled the Transcript, and a real screenshot in its place would have
  // read as merely too big.
  //
  // Breakage this fails on: a fixture shrunk back to a pixel because it is
  // shorter in the source.
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  for (const handle of ['img_replay_pasted', 'img_replay_shot']) {
    const src = replay.imageSrc(handle)
    expect(src.startsWith('data:image/png;base64,')).toBe(true)
    const bytes = Buffer.from(src.slice('data:image/png;base64,'.length), 'base64')
    // IHDR is the first chunk of a PNG: width and height are the two big-endian
    // uint32s at byte 16.
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(64)
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(64)
  }
})

/**
 * How many image entries of a provenance are on screen, drawn or not drawn —
 * "pasted with a picture" and "pasted without one" being different states that
 * a bare count of either would let stand in for the other.
 */
function shownAs(provenance: 'pasted' | 'shown', { drawn }: { drawn: boolean }): number {
  return [...document.querySelectorAll(`[data-image="${provenance}"]`)].filter(
    (one) => (one.querySelector('img') !== null) === drawn,
  ).length
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
      imageSrc: replay.imageSrc,
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
test('replay refuses a picture live would refuse, rather than drawing one', async () => {
  const replay = replayTransport({ wait: immediately, script: SCRIPT })
  const before = replay.log.filter((frame) => frame.kind === 'image').length

  await replay.fetch('/api/agent', {
    method: 'POST',
    headers: {},
    body: JSON.stringify({
      type: 'prompt',
      text: 'look at this',
      images: [
        { mediaType: 'text/html', data: btoa('<script>alert(1)</script>') },
        { mediaType: 'image/png', data: 'not base64 at all!!' },
      ],
    }),
  })
  await drain(replay)

  // The handler answers 400 to this Event, on both counts: a `text/html`
  // "image" is the stored-XSS shape, and a payload that is not base64 is not a
  // picture. Replay is not a guard — it takes the words rather than refusing
  // the Event — but it must not mint a handle for something live would never
  // hold. A picture drawn here and a 400 there is replay lying about what a
  // paste is, which is the one thing this transport exists not to do.
  expect(replay.log.filter((frame) => frame.kind === 'image').length).toBe(before)
  expect(replay.log.some((frame) => frame.kind === 'prompt' && frame.text === 'look at this')).toBe(
    true,
  )
})

async function drain(replay: ReplayTransport): Promise<void> {
  await act(async () => {
    await replay.quiet()
    await tick()
  })
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Prompt') as HTMLTextAreaElement
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
