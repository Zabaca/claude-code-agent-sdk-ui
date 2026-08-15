import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import goldenLog from '../core/fixtures/session.frames.json' with { type: 'json' }
import type { Frame } from '../core/frame.ts'
import { reduce } from '../core/reduce.ts'
import { fakeSse, type FakeSse } from '../react/fake.ts'
import { useAgentSession, type AgentFetch, type AgentSessionOptions } from '../react/session.ts'
import { ClaudeSession } from './session.tsx'

test("the agent's prose reaches the screen", async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'fix the flaky test' })
    fake.frame({ kind: 'text', text: 'I looked at the suite.' })
  })

  expect(screen.getByText('fix the flaky test')).toBeDefined()
  expect(screen.getByText('I looked at the suite.')).toBeDefined()
  // And told apart: a person's words are Claude Code's prompt row, with the
  // caret and the dark ground; the agent's prose is plain text. Drawn the
  // same, a Transcript stops saying who said what.
  expect(screen.getByText('fix the flaky test').parentElement?.textContent).toContain('❯')
  expect(screen.getByText('I looked at the suite.').parentElement?.textContent).not.toContain('❯')
  view.unmount()
})

test('a tool call is a visible line the moment it starts, and reads as pending', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_read',
      name: 'Read',
      input: { file_path: '/repo/src/a.ts' },
    })
  })

  expect(screen.getByText('Read')).toBeDefined()
  expect(screen.getByText('/repo/src/a.ts')).toBeDefined()
  expect(line('Read').dataset['status']).toBe('pending')
  // Written where the result will go, not only announced: a call handed a
  // result it does not have yet draws a blank line there and says "pending"
  // to a screen reader alone.
  expect(visible('Read')).toContain('pending')

  await act(async () => {
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_read',
      output: 'export const a = 1',
      isError: false,
    })
  })

  expect(line('Read').dataset['status']).toBe('success')
  expect(screen.getByText('export const a = 1')).toBeDefined()
  view.unmount()
})

test('a tool that answered with an error reads as an error', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'tool-call', id: 'toolu_bash', name: 'Bash', input: { command: 'bun test' } })
    fake.frame({ kind: 'tool-result', id: 'toolu_bash', output: '1 failed', isError: true })
  })

  expect(line('Bash').dataset['status']).toBe('error')
  view.unmount()
})

test('a long tool output is summarised to one line and expandable to the whole', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'tool-call', id: 'toolu_ls', name: 'Bash', input: { command: 'ls' } })
    fake.frame({ kind: 'tool-result', id: 'toolu_ls', output: 'one\ntwo\nthree', isError: false })
  })

  // The collapsed line says the first line and how much more there is; the
  // rest is behind the disclosure, which keeps a Transcript scannable.
  const summary = line('Bash').querySelector('summary')?.textContent ?? ''
  expect(summary).toContain('one')
  expect(summary).toContain('+2 lines')
  expect(summary).not.toContain('three')
  expect(line('Bash').textContent).toContain('three')
  view.unmount()
})

test('prose still being written is on screen before its Frame exists', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'say hi' })
    fake.partial({ block: 0, kind: 'text', text: 'Hel' })
  })
  expect(screen.getByText('Hel')).toBeDefined()

  await act(async () => {
    fake.partial({ block: 0, kind: 'text', text: 'Hello there' })
  })
  // Replace, never append: the handler sends the whole block each time.
  expect(there(screen.queryByText('Hel'))).toBe(false)
  expect(screen.getByText('Hello there')).toBeDefined()

  await act(async () => {
    fake.frame({ kind: 'text', text: 'Hello there' })
  })
  // The Frame takes the live copy's place rather than doubling it.
  expect(screen.queryAllByText('Hello there').length).toBe(1)
  view.unmount()
})

test('the whole golden log renders, with nothing silently dropped', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    for (const frame of golden) fake.frame(frame)
  })

  // What is on screen is compared against `reduce`'s own answer for the same
  // log, so a kind the container forgets to draw is a count that disagrees
  // rather than a Message that quietly vanished.
  const expected = reduce(golden)
  const said = [...screen.getByRole('log').children].map((entry) =>
    (entry.textContent ?? '').trim(),
  )
  expect(said.length).toBe(expected.messages.length)
  expect(said.filter((text) => text === '')).toEqual([])

  view.unmount()
})

test("a sub-agent's work is attributed to the Thread it belongs to", async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    for (const frame of golden) fake.frame(frame)
  })

  // The `Task` call is the main agent's own work; the `Read` it spawned is
  // not, and the screen has to be able to tell them apart.
  expect(entryFor('Task').dataset['thread']).toBeUndefined()
  expect(entryFor('Read').dataset['thread']).toBe('toolu_task')
  view.unmount()
})

test('a Turn that died is not drawn like a Turn that finished', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'first' })
    fake.frame({ kind: 'settled', result: 'done' })
    fake.frame({ kind: 'prompt', text: 'second' })
    fake.frame({ kind: 'failed', subtype: 'error_max_turns', reason: 'ran out of turns' })
  })

  const [settled, failed] = ended()

  // The whole point: two Turns that ended differently must not read the same.
  expect(settled).not.toBe(failed)
  expect(outcomes()).toEqual(['settled', 'failed'])
  expect(settled).toContain('settled')
  // And the reason is on screen. `reduce` is already carrying it; a drawing
  // that throws it away tells a viewer the Turn ended and hides that it died.
  expect(failed).toContain('failed')
  expect(failed).toContain('ran out of turns')
  expect(failed).toContain('error_max_turns')
  view.unmount()
})

test('an interrupted Turn reads as an ending, not as an error', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
    fake.frame({
      kind: 'failed',
      subtype: 'error_during_execution',
      reason: 'aborted by user',
      terminalReason: 'aborted_streaming',
    })
  })

  expect(outcomes()).toEqual(['interrupted'])
  const line = ended()[0] ?? ''
  // A stop the person asked for is not a problem they have: it is not called a
  // failure and it is not painted like one.
  expect(line).toContain('interrupted')
  expect(line).not.toContain('failed')
  expect(entry(0).style.color).not.toBe('var(--cc-error)')
  // The runtime's account of the abort still gets read.
  expect(line).toContain('aborted by user')
  view.unmount()
})

test('a compaction says memory became a summary, and what that cost', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'text', text: 'Reading the suite.' })
    fake.frame({
      kind: 'compacted',
      trigger: 'auto',
      preTokens: 180000,
      postTokens: 42000,
      durationMs: 3100,
    })
  })

  const said = divergence('compacted')
  // The counts are the whole of the claim. A boundary drawn without them says
  // a compaction happened and hides how much of the conversation the agent
  // can no longer see — which is the silence this marker exists to break.
  expect(said).toContain('180,000')
  expect(said).toContain('42,000')
  // And which kind of compaction: one the person asked for and one the window
  // forced are different facts about the Session.
  expect(said).toContain('auto')
  view.unmount()
})

test('a compaction the runtime gave no counts for does not invent any', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'compacted' })
  })

  // Still drawn — the boundary happened, and that alone changes what the agent
  // can see. But a plausible-looking zero would be the screen making up a
  // number the SDK never gave.
  const said = divergence('compacted')
  expect(said).not.toBe('')
  expect(said).not.toContain('0')
  expect(said).not.toContain('undefined')
  expect(said).not.toContain('NaN')
  view.unmount()
})

test('a reset is not drawn like a compaction — memory gone is not memory summarised', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'compacted', trigger: 'auto', preTokens: 180000, postTokens: 42000 })
    fake.frame({ kind: 'reset', transcriptId: 'conv-2' })
  })

  const summarised = divergence('compacted')
  const cleared = divergence('reset')

  // The harder loss must not borrow the softer one's words. Drawn the same,
  // the screen would tell a viewer their conversation was condensed when it
  // was actually thrown away.
  expect(cleared).not.toBe(summarised)
  expect(cleared).not.toContain('summary')
  expect(cleared).not.toContain('compact')
  expect(cleared).toContain('cleared')
  // And told apart without reading a word of it.
  expect(colour('reset')).not.toBe(colour('compacted'))
  // The id the fresh Transcript is mounted under: the one fact a reset
  // carries, and the handle for the conversation that replaced this one.
  expect(cleared).toContain('conv-2')
  view.unmount()
})

test('a recall says what surfaced; one that surfaced nothing is correctly silent', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'recall',
      mode: 'select',
      memories: [{ path: '/memories/ports.md', scope: 'personal', content: 'Prefers Bun.' }],
    })
    // Nothing was surfaced, so nothing entered the agent's context and there
    // is no divergence to report.
    fake.frame({ kind: 'recall', mode: 'select', memories: [] })
  })

  // Exactly one. Two would be an empty recall claiming context arrived that
  // never did; zero would be the marker missing altogether — and "an empty
  // recall renders nothing" on its own cannot tell that apart from working,
  // which is why both recalls are driven through the same screen.
  expect(divergences('recall')).toBe(1)
  const said = divergence('recall')
  // Where it came from, because the whole point of the marker is that this
  // text was never said in this conversation.
  expect(said).toContain('/memories/ports.md')
  expect(said).toContain('personal')

  // And the empty one leaves no row behind either: a blank entry in the log is
  // still the screen taking up space for something it will not explain.
  const rows = [...screen.getByRole('log').children].map((row) => (row.textContent ?? '').trim())
  expect(rows).toEqual([said])
  view.unmount()
})

test('Enter wills a prompt Event and empties the composer', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await type('write a novel')
  await enter()

  expect(wire.posted).toEqual([{ body: { type: 'prompt', text: 'write a novel' } }])
  expect(composer().value).toBe('')
  // The person's words are on screen before the handler has said anything.
  expect(screen.getByText('write a novel')).toBeDefined()
  view.unmount()
})

test('whitespace alone wills nothing', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await type('   ')
  await enter()

  expect(wire.posted).toEqual([])
  view.unmount()
})

test('esc interrupts a running Turn, and does nothing when none is running', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await act(async () => escape())
  expect(wire.posted).toEqual([])

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
  })
  await act(async () => escape())

  expect(wire.posted).toEqual([{ body: { type: 'interrupt' } }])
  view.unmount()
})

test('esc interrupts from anywhere in the Session, not only from the input', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
    fake.frame({ kind: 'tool-call', id: 'toolu_read', name: 'Read', input: { path: '/a.ts' } })
  })

  // Hands on a tool line, which is where they are after expanding one.
  await act(async () => {
    fireEvent.keyDown(line('Read'), { key: 'Escape' })
  })

  expect(wire.posted).toEqual([{ body: { type: 'interrupt' } }])
  view.unmount()
})

test('the working line is on screen only while the Turn runs', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  expect(there(screen.queryByRole('status'))).toBe(false)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
  })
  expect(screen.getByRole('status')).toBeDefined()

  await act(async () => {
    fake.frame({ kind: 'settled', result: 'done' })
  })
  expect(there(screen.queryByRole('status'))).toBe(false)
  view.unmount()
})

test('the mode line reports what the runtime loaded, and is not a control', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  // Nothing said yet, so the composer shows the caller's default rather than
  // claiming a mode the runtime never reported.
  expect(screen.getByText('auto mode on')).toBeDefined()

  await act(async () => {
    fake.frame({ kind: 'harness', permissionMode: 'plan' })
  })

  expect(screen.getByText('plan mode on')).toBeDefined()
  // ADR-0001 is enforced by the wire: an Event is a prompt or an interrupt, so
  // no Event can carry a mode change. A mode line that could be activated
  // would change what the composer says without changing what runs.
  expect(there(screen.getByText('plan mode on').closest('button'))).toBe(false)
  view.unmount()
})

test('the effort chip is a control, because effort is the composer’s own', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  const chip = screen.getByText(/xhigh/).closest('button')
  expect(there(chip)).toBe(true)
  await act(async () => chip?.click())
  expect(screen.getByText(/max/)).toBeDefined()
  view.unmount()
})

test('an Event the handler refused is reported rather than swallowed', async () => {
  const fake = fakeSse()
  const wire = recorder(500)
  const view = await mount(fake, { fetch: wire.fetch })

  await type('write a novel')
  await enter()
  await settle()

  expect(screen.getByRole('alert').textContent).toContain('500')
  view.unmount()
})

// --- driving the seam ---------------------------------------------------------

function composer(): HTMLInputElement {
  return screen.getByLabelText('Prompt') as HTMLInputElement
}

function type(text: string): Promise<void> {
  return act(async () => {
    fireEvent.change(composer(), { target: { value: text } })
  })
}

function enter(): Promise<void> {
  return act(async () => {
    fireEvent.keyDown(composer(), { key: 'Enter' })
  })
}

function escape(): void {
  fireEvent.keyDown(composer(), { key: 'Escape' })
}

/** The `<details>` a tool call renders as, found by the tool's own name. */
function line(tool: string): HTMLElement {
  const found = screen.getByText(tool).closest('details')
  if (!found) throw new Error(`no tool line for ${tool}`)
  return found
}

/** What each Turn-ending entry says, in Transcript order. */
function ended(): string[] {
  return [...document.querySelectorAll('[data-outcome]')].map((one) =>
    (one.textContent ?? '').trim(),
  )
}

/** Which outcome each ending entry claims, in Transcript order. */
function outcomes(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-outcome]')].map(
    (one) => one.dataset['outcome'],
  )
}

/** The nth Turn-ending entry, for the one thing worth reading off its style. */
function entry(at: number): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>('[data-outcome]')[at]
  if (!found) throw new Error(`no ending entry at ${at}`)
  return found
}

/**
 * What the divergence marker of a given kind says. Exactly one is expected:
 * two would mean the same divergence drawn twice, and none would mean the
 * marker is missing — which is the failure mode these markers exist to stop,
 * so it must be an error rather than an empty string that reads as "silent".
 */
function divergence(kind: string): string {
  const found = document.querySelectorAll<HTMLElement>(`[data-divergence="${kind}"]`)
  if (found.length !== 1) throw new Error(`expected 1 ${kind} marker, found ${found.length}`)
  return (found[0]?.textContent ?? '').trim()
}

/** What colour a marker is drawn in — how it is told apart without reading. */
function colour(kind: string): string {
  const found = document.querySelector<HTMLElement>(`[data-divergence="${kind}"]`)
  if (!found) throw new Error(`no ${kind} marker`)
  return found.style.color
}

/** How many divergence markers of a kind are on screen. */
function divergences(kind: string): number {
  return document.querySelectorAll(`[data-divergence="${kind}"]`).length
}

/** What a tool's collapsed line shows, minus what only a reader would hear. */
function visible(tool: string): string {
  const summary = line(tool).querySelector('summary')?.cloneNode(true) as HTMLElement | null
  for (const hidden of summary?.querySelectorAll('[class~="cc:sr-only"]') ?? []) hidden.remove()
  return summary?.textContent ?? ''
}

/** The Transcript entry a tool's line sits in — where its Thread is marked. */
function entryFor(tool: string): HTMLElement {
  const found = line(tool).parentElement
  if (!found) throw new Error(`no entry for ${tool}`)
  return found
}


const endpoint = 'http://localhost/agent'

/** The committed 37-Frame log — every Frame kind `classify` can emit. */
const golden = goldenLog as Frame[]

/** Renders the container over the hook and lets the first replay land. */
async function mount(
  fake: FakeSse,
  options: Partial<AgentSessionOptions> = {},
): Promise<{ unmount(): void }> {
  function Host() {
    const session = useAgentSession({
      endpoint,
      createEventSource: fake.createEventSource,
      ...options,
    })
    return <ClaudeSession session={session} />
  }
  const view = render(<Host />)
  await settle()
  return view
}

/** Lets the transport's microtasks run and React flush what they produced. */
function settle(): Promise<void> {
  return act(async () => {
    await Promise.resolve()
  })
}

type Posted = { body: unknown }

/** Stands in for `fetch`, so what an Event puts on the wire is what is asserted. */
function recorder(status = 202): { posted: Posted[]; fetch: AgentFetch } {
  const posted: Posted[] = []
  return {
    posted,
    fetch: async (_input, init) => {
      posted.push({ body: JSON.parse(init.body) as unknown })
      return { ok: status >= 200 && status < 300, status }
    },
  }
}

export { recorder }

/**
 * Whether something is on screen, as a boolean. Asserted on a value rather
 * than on the node itself because a failing assertion that has to print a DOM
 * element walks a graph with cycles in it and never comes back — a suite that
 * hangs where it should have reported.
 */
function there(node: Element | null | undefined): boolean {
  return node !== null && node !== undefined
}
