import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import goldenLog from '../core/fixtures/session.frames.json' with { type: 'json' }
import type { Frame } from '../core/frame.ts'
import { reduce } from '../core/reduce.ts'
import { fakeSse, type FakeSse } from '../react/fake.ts'
import { useAgentSession, type AgentFetch, type AgentSessionOptions } from '../react/session.ts'
import { ClaudeSession } from './session.tsx'
import type { ThreadClock, ThreadDisplay } from './thread.tsx'

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

test('a tool that answers in one enormous line is still one readable line', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const blob = `{"rows":[${'"x",'.repeat(1000)}]}`

  await act(async () => {
    fake.frame({ kind: 'tool-call', id: 'toolu_q', name: 'Bash', input: { command: 'query' } })
    fake.frame({ kind: 'tool-result', id: 'toolu_q', output: blob, isError: false })
  })

  // A wall does not stop being a wall for arriving without newlines. Counting
  // lines calls this one line and prints all four thousand characters of it.
  const summary = line('Bash').querySelector('summary')?.textContent ?? ''
  expect(summary.length).toBeLessThan(400)
  // Collapsed, not cut: the answer itself is still there to expand.
  expect(line('Bash').textContent).toContain(blob)
  view.unmount()
})

test('a tool called with an enormous argument keeps its line, and the argument', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const command = `echo ${'a'.repeat(4000)}`

  await act(async () => {
    fake.frame({ kind: 'tool-call', id: 'toolu_e', name: 'Bash', input: { command } })
  })

  const summary = line('Bash').querySelector('summary')?.textContent ?? ''
  expect(summary.length).toBeLessThan(400)
  // What it was called with still says what it was: the head of the argument,
  // because a command says what it does at its start.
  expect(summary).toContain('echo aaa')
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

test('a running Thread counts up, and freezes the moment it finishes', async () => {
  const fake = fakeSse()
  const clock = byHand()
  const view = await mount(fake, {}, { clock })

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'delegate the audit' })
    fake.frame(opens('toolu_task', 'audit core', 'Explore'))
  })

  expect(meter('toolu_task').dataset['threadState']).toBe('running')
  expect(elapsed('toolu_task')).toBe('0s')

  // The meter has to move on its own: a Thread produces no Frames while it is
  // thinking, so a duration drawn only when something arrives would sit still
  // for exactly the stretch a viewer is asking about.
  await clock.advance(5_000)
  expect(elapsed('toolu_task')).toBe('5s')

  await act(async () => {
    fake.frame({ kind: 'tool-result', id: 'toolu_task', output: 'no findings', isError: false })
  })
  await clock.advance(120_000)
  // Two minutes on, and the main agent says something — which is what forces
  // this screen to draw again. Without that redraw the assertion below could
  // not tell a duration that is frozen from one that merely was not recomputed,
  // and would pass for a meter that resumes counting the next time anything
  // at all happens.
  await act(async () => {
    fake.frame({ kind: 'text', text: 'The audit came back clean.' })
  })

  // Frozen at what it took, and reading as complete. A meter that kept
  // counting would say a Thread that ended two minutes ago took 2m 5s.
  expect(elapsed('toolu_task')).toBe('5s')
  expect(meter('toolu_task').dataset['threadState']).toBe('settled')
  view.unmount()
})

test('a Thread that failed says so, rather than reading as one that finished', async () => {
  const fake = fakeSse()
  const view = await mount(fake, {}, { clock: byHand() })

  await act(async () => {
    fake.frame(opens('toolu_task', 'audit core', 'Explore'))
    fake.frame({ kind: 'tool-result', id: 'toolu_task', output: 'crashed', isError: true })
  })

  expect(meter('toolu_task').dataset['threadState']).toBe('failed')
  view.unmount()
})

test('a Thread that was already over when the log replayed claims no duration', async () => {
  // The reason this matters: no Frame carries a timestamp, so the only clock
  // is this screen's own. On a reload the whole log lands at once, and a
  // Thread that took four minutes would read `0s` — a number that looks
  // measured and is not. It has to be absent instead.
  const fake = fakeSse()
  const first = await mount(fake, {}, { clock: byHand() })
  await act(async () => {
    fake.frame(opens('toolu_task', 'audit core', 'Explore'))
    fake.frame({ kind: 'tool-result', id: 'toolu_task', output: 'no findings', isError: false })
  })
  expect(meter('toolu_task').dataset['threadState']).toBe('settled')
  first.unmount()

  // A fresh page: the same log, replayed from 0 into a screen that never
  // watched any of it happen.
  const reloaded = await mount(fake, {}, { clock: byHand() })
  expect(meter('toolu_task').dataset['threadState']).toBe('settled')
  expect(elapsed('toolu_task')).toBeUndefined()
  reloaded.unmount()
})

test('a Thread can be filtered out, and the main agent’s own work is what is left', async () => {
  const fake = fakeSse()
  const view = await mount(fake, {}, { threads: 'hidden' })

  await act(async () => {
    for (const frame of golden) fake.frame(frame)
  })

  const expected = reduce(golden)
  const hidden = expected.messages.filter((message) => 'thread' in message && message.thread)
  expect(hidden.length).toBeGreaterThan(0)
  // Exactly the Thread's Messages are gone and nothing else is: a filter that
  // took the `Task` call with them, or that took a Message belonging to no
  // Thread, would miss this by the count.
  expect(drawn()).toBe(expected.messages.length - hidden.length)
  expect(document.querySelectorAll('[data-thread]').length).toBe(0)
  // The `Task` call stays: it is the main agent's own work, not the Thread's.
  expect(there(screen.queryByText('Task'))).toBe(true)
  view.unmount()
})

test('a Thread can be nested under the Task call that opened it, losing nothing', async () => {
  const fake = fakeSse()
  const view = await mount(fake, {}, { threads: 'nested' })

  await act(async () => {
    for (const frame of golden) fake.frame(frame)
  })

  const expected = reduce(golden)
  // Fewer top-level entries than Messages, because the Thread's work moved
  // under its opener — and every Message still on screen, because moving is
  // not the same as dropping.
  expect(drawn()).toBeLessThan(expected.messages.length)
  expect(document.querySelectorAll('[data-thread]').length).toBeGreaterThan(0)
  expect(document.querySelectorAll('[data-tool], [data-thread], [data-opens]').length).toBeGreaterThan(0)
  const nest = document.querySelector('[data-thread-nest]')
  expect(there(nest)).toBe(true)
  // The Thread's work is inside its opener, not merely after it.
  expect(nest?.closest('[data-opens="toolu_task"]')).not.toBeNull()
  expect(nest?.querySelectorAll('[data-thread="toolu_task"]').length).toBe(
    expected.messages.filter((message) => 'thread' in message && message.thread === 'toolu_task')
      .length,
  )
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

  // Told apart without reading, too. #7 drew the words apart; drawn in the
  // same colour, the only thing separating an answer that died from one that
  // finished is a word at the end of a scrolled-past line.
  expect(entry(1).style.color).toBe('var(--cc-error)')
  expect(entry(0).style.color).not.toBe('var(--cc-error)')

  // And the Turn stopped: a working line still spinning under a Turn that
  // died says the agent is still on it, which is the same lie in motion.
  expect(there(screen.queryByRole('status'))).toBe(false)
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

test('an interrupt leaves the Session idle on screen, not merely un-failed', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'write a novel' })
  })
  expect(screen.getByRole('status')).toBeDefined()

  // The shape the handler actually produces: a *settled* Frame carrying the
  // terminal reason. The other UI test drives the `failed` arm, so between
  // them both branches of the predicate are exercised at this seam and neither
  // can regress on its own.
  await act(async () => {
    fake.frame({ kind: 'settled', terminalReason: 'aborted_streaming' })
  })

  expect(outcomes()).toEqual(['interrupted'])
  // Idle is a screen-level claim, not only a Turn field: the working line is
  // gone, nothing is reported as a problem, and esc no longer wills an
  // interrupt against a Turn that is not running.
  expect(there(screen.queryByRole('status'))).toBe(false)
  expect(there(screen.queryByRole('alert'))).toBe(false)
  await act(async () => escape())
  expect(wire.posted).toEqual([])
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
  // And what it says. The path alone reports that something arrived; the
  // content is the thing the agent is now acting on, and it is what nobody in
  // this conversation ever said.
  expect(said).toContain('Prefers Bun.')

  // And the empty one leaves no row behind either: a blank entry in the log is
  // still the screen taking up space for something it will not explain.
  const rows = [...screen.getByRole('log').children].map((row) => (row.textContent ?? '').trim())
  expect(rows).toEqual([said])
  view.unmount()
})

test('a hook that refused is not drawn like a hook that passed', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'format-on-edit',
      hookEvent: 'PostToolUse',
      status: 'success',
      output: 'formatted 2 files',
    })
    fake.frame({
      kind: 'hook',
      id: 'hook-2',
      name: 'block-secrets',
      hookEvent: 'PreToolUse',
      status: 'error',
      stderr: 'refused: .env is not readable',
      exitCode: 2,
    })
  })

  const [passed, refused] = markers('hook')
  // Which hook, and at which lifecycle point: a hook that ran before a tool
  // call and one that ran after it changed different things.
  expect(passed).toContain('format-on-edit')
  expect(passed).toContain('PostToolUse')
  expect(refused).toContain('block-secrets')
  expect(refused).toContain('PreToolUse')
  // A hook that refused rewrote what the agent was allowed to do, and its own
  // words are the only account of why. Dropped, the Transcript shows a tool
  // call that simply did not happen and never says who stopped it.
  expect(refused).toContain('refused: .env is not readable')
  expect(refused).toContain('2')
  // And told apart without reading: run and refused are not the same state.
  expect(statusOf('hook', 1)).toBe('error')
  expect(statusOf('hook', 0)).not.toBe('error')
  expect(colourAt('hook', 1)).toBe('var(--cc-error)')
  expect(colourAt('hook', 0)).not.toBe('var(--cc-error)')
  view.unmount()
})

test('a hook that says a great deal is collapsed to its last lines, and keeps all of them', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const said = Array.from({ length: 200 }, (_, at) => `line ${at + 1}`)

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'SessionStart:startup',
      hookEvent: 'SessionStart',
      status: 'success',
      output: said.join('\n'),
    })
  })

  // The complaint this exists for: a hook's own words are the runtime's, not
  // the agent's, and two hundred lines of them push the conversation off the
  // screen before it has started.
  const shown = preview('hook', 0)
  expect(shown.length).toBeLessThanOrEqual(5)
  // The tail, because that is where a hook says how it ended.
  expect(shown.at(-1)).toBe('line 200')
  expect(shown).not.toContain('line 1')
  // Collapsed, not dropped: everything the hook said is still a click away.
  // Truncation is what the screen does, never what the Transcript holds.
  expect(whole('hook', 0)).toContain('line 1\n')
  expect(whole('hook', 0)).toContain('line 200')
  // And it says how much it is holding back, so the click is discoverable
  // rather than something a reader has to guess is there.
  expect(marker('hook', 0).textContent).toContain('195')
  view.unmount()
})

test('a hook that says one enormous line is collapsed too', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  // What the screenshot actually showed: a JSON payload whose newlines are
  // escaped, so it is one physical line thousands of characters wide.
  // Counting lines alone calls this short and prints the whole wall.
  const blob = `{"additionalContext":"${'x'.repeat(4000)}"} exit 0`

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'SessionStart:startup',
      hookEvent: 'SessionStart',
      status: 'success',
      output: blob,
    })
  })

  const shown = preview('hook', 0).join('\n')
  expect(shown.length).toBeLessThan(400)
  expect(shown).toContain('exit 0')
  expect(whole('hook', 0)).toContain(blob)
  view.unmount()
})

test('a hook short enough to read is left alone', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'format-on-edit',
      hookEvent: 'PostToolUse',
      status: 'success',
      output: 'formatted 2 files',
    })
  })

  // A disclosure around two words is a click that buys nothing and hides
  // something: collapsing is for walls, not for everything that is not prose.
  expect(marker('hook', 0).querySelector('[data-spill]')).toBeNull()
  expect(marker('hook', 0).textContent).toContain('formatted 2 files')
  view.unmount()
})

test('a hook that refused shows why without being expanded', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const checks = Array.from({ length: 40 }, (_, at) => `checked ${at}`).join('\n')

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'block-secrets',
      hookEvent: 'PreToolUse',
      status: 'error',
      stderr: `${checks}\nrefused: .env is not readable`,
      exitCode: 2,
    })
  })

  // A refusal rewrote what the agent was allowed to do, and the hook's own
  // words are the only account of why. Behind a click with nothing visible,
  // the Transcript shows a tool call that simply did not happen.
  expect(preview('hook', 0)).toContain('refused: .env is not readable')
  view.unmount()
})

test('a hook that also printed chatter still ends on why it refused', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const chatter = Array.from({ length: 40 }, (_, at) => `scanning ${at}`).join('\n')

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'block-secrets',
      hookEvent: 'PreToolUse',
      status: 'error',
      stdout: chatter,
      stderr: 'refused: .env is not readable',
      exitCode: 2,
    })
  })

  // The preview is the tail, so which channel is written last decides what
  // survives it. Chatter on stdout must not push the refusal off the screen.
  expect(preview('hook', 0)).toContain('refused: .env is not readable')
  view.unmount()
})

test('an expanded wall says how to put it back', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const said = Array.from({ length: 200 }, (_, at) => `line ${at + 1}`).join('\n')

  await act(async () => {
    fake.frame({
      kind: 'hook',
      id: 'hook-1',
      name: 'SessionStart:startup',
      hookEvent: 'SessionStart',
      status: 'success',
      output: said,
    })
  })

  // A summary whose every part hides when open collapses to nothing, and a
  // reader who expanded two hundred lines with the mouse has no way back to
  // them with it. Something in the summary has to survive opening.
  const summary = marker('hook', 0).querySelector('[data-spill] summary')
  const standing = [...(summary?.children ?? [])].filter(
    (part) => !part.className.includes('group-open:hidden'),
  )
  expect(standing.length).toBeGreaterThan(0)
  expect(standing.map((part) => part.textContent).join(' ')).toContain('collapse')
  view.unmount()
})

test('a recall that carries a long memory is collapsed the same way', async () => {
  const fake = fakeSse()
  const view = await mount(fake)
  const remembered = Array.from({ length: 60 }, (_, at) => `remembered ${at + 1}`).join('\n')

  await act(async () => {
    fake.frame({
      kind: 'recall',
      mode: 'select',
      memories: [{ path: '/memories/ports.md', scope: 'personal', content: remembered }],
    })
  })

  // Whose memory it is stays on the marker line — provenance is the claim.
  expect(marker('recall', 0).textContent).toContain('/memories/ports.md')
  expect(preview('recall', 0).length).toBeLessThanOrEqual(5)
  expect(whole('recall', 0)).toContain('remembered 1\n')
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

test('the working line shows how full the context is, while the Turn is still running', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'read the whole repo' })
  })
  // No reading yet, so no number. A `0` here would be the working line
  // reporting an empty context window rather than an unmeasured one.
  expect(working()).not.toContain('tokens')

  await act(async () => {
    fake.frame({ kind: 'context', totalTokens: 52_000, maxTokens: 200_000 })
  })
  expect(working()).toContain('52,000 tokens')

  // A second reading, still mid-Turn: the SDK attaches `context_usage` to every
  // assistant message, so the count moves while the agent works. Read only at
  // the end, the meter would sit on a stale figure for the whole Turn — which
  // is the one stretch of time anybody is watching it.
  await act(async () => {
    fake.frame({ kind: 'context', totalTokens: 91_500, maxTokens: 200_000 })
  })
  expect(working()).toContain('91,500 tokens')
  expect(there(screen.queryByRole('status'))).toBe(true)

  view.unmount()
})

test('deliberation is off the screen by default, and on it only when asked for', async () => {
  const fake = fakeSse()
  const quiet = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'is this safe?' })
    // Live and retained alike. Streaming deliberation into the Transcript would
    // put the model's reasoning on screen as though it were an answer, which is
    // a product decision nobody made.
    fake.partial({ block: 0, kind: 'reasoning', text: 'Maybe not, let me check' })
    fake.frame({ kind: 'reasoning', text: 'Maybe not, let me check the caller' })
    fake.frame({ kind: 'text', text: 'It is safe.' })
  })

  expect(screen.getByText('It is safe.')).toBeDefined()
  expect(there(screen.queryByText(/Maybe not/))).toBe(false)

  quiet.unmount()

  // The same log, with the flag on. Nothing about the wire changed — the
  // Frames were always there — so this is a viewing decision, not a capture
  // one, and the escape hatch exists for the person debugging a prompt.
  const asked = await mount(fake, { reasoning: true })

  const deliberation = screen.getByText('Maybe not, let me check the caller')
  expect(deliberation).toBeDefined()
  // And told apart from the answer. Drawn identically, thinking on screen
  // *is* an answer to anyone reading it.
  expect(deliberation.className).not.toBe(screen.getByText('It is safe.').className)

  asked.unmount()
})

test("the working line reports the conversation's window, never a sub-agent's", async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  // The recorded stream takes two context readings: one inside the Thread the
  // `Task` call opened, and one for the agent's own window. Both are read off
  // the fixture rather than restated, so a regenerated golden file can still
  // disagree with this test — every other test of the count builds its own
  // Frame, and a line wired to a shape nobody sends is wired to nothing.
  const readings = golden.flatMap((frame, at) =>
    frame.kind === 'context' ? [{ at, thread: frame.thread, tokens: frame.totalTokens }] : [],
  )
  const threaded = readings.find((one) => one.thread !== undefined)
  const own = readings.find((one) => one.thread === undefined)
  if (!threaded || !own) throw new Error('the golden log needs both a Thread reading and its own')

  // Both land while the Turn is still running, so the working line is on
  // screen for each — including for the one it must refuse to draw.
  const ended = golden.findIndex((frame) => frame.kind === 'settled' || frame.kind === 'failed')
  expect(threaded.at).toBeLessThan(own.at)
  expect(own.at).toBeLessThan(ended)

  await act(async () => {
    for (const frame of golden.slice(0, threaded.at + 1)) fake.frame(frame)
  })

  // A sub-agent's window is not the conversation's. This is #17 at the seam a
  // person actually reads: the Thread's 7,000 used to land on the Session
  // meter, so the line drawn next to the conversation reported a background
  // agent's window — a number that is not about the thing it is drawn beside.
  // The meter is on screen and has nothing to say yet, which is the correct
  // silence: guarded in `core` and at the hook, and until now nowhere here.
  expect(working()).not.toContain(threaded.tokens.toLocaleString('en-US'))
  expect(working()).not.toContain('tokens')

  await act(async () => {
    for (const frame of golden.slice(threaded.at + 1, own.at + 1)) fake.frame(frame)
  })

  expect(working()).toContain(`${own.tokens.toLocaleString('en-US')} tokens`)
  // And the Thread's reading never appears — not before its own arrives, and
  // not after it either.
  expect(working()).not.toContain(threaded.tokens.toLocaleString('en-US'))

  view.unmount()
})

test('a rate limit is never read as a context reading', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'prompt', text: 'keep going' })
    // The subscription meter, and only it. It answers "how much of my week is
    // left"; the working line asks "how full is this conversation". A fallback
    // from one to the other would put a number on screen that looks like a
    // reading and is a reading of something else entirely.
    fake.frame({ kind: 'rate-limit', status: 'allowed_warning', utilization: 0.62 })
  })

  expect(working()).not.toContain('tokens')
  expect(working()).not.toContain('62')
  expect(working()).not.toContain('0.62')

  // And once the context meter does report, that is what the line shows — the
  // rate limit sitting beside it changes nothing.
  await act(async () => {
    fake.frame({ kind: 'context', totalTokens: 52_000 })
  })
  expect(working()).toContain('52,000 tokens')
  expect(working()).not.toContain('62%')

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

test('typing a slash opens a menu that filters as the person types', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
  })

  // Nothing typed, so nothing offered: a palette on screen before it was
  // asked for is a palette in the way.
  expect(there(screen.queryByRole('listbox'))).toBe(false)

  await type('/')
  expect(offered()).toEqual(['/clear', '/compact', '/usage'])

  // `/usage` is offered here too, because its alias `cost` starts with a `c`.
  // Filtering names alone would hide it from the letter people actually type.
  await type('/c')
  expect(offered()).toEqual(['/clear', '/compact', '/usage'])

  await type('/com')
  expect(offered()).toEqual(['/compact'])

  // Past the name and into the arguments, the menu has done its job and gets
  // out of the way.
  await type('/compact focus on the tests')
  expect(there(screen.queryByRole('listbox'))).toBe(false)
  view.unmount()
})

test('a command says what it takes and what else it answers to', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
  })
  await type('/u')

  const row = screen.getByRole('option').textContent ?? ''
  expect(row).toContain('/usage')
  expect(row).toContain('Show what this Session has spent')
  // The two things the runtime describes that a bare name cannot: what to type
  // after it, and what else resolves to it. Drop either and the menu says a
  // command exists without saying how to use it or that `/cost` is the same
  // thing — which is what this ticket is for.
  expect(row).toContain('[window]')
  expect(row).toContain('/cost')
  expect(row).toContain('/stats')
  view.unmount()
})

test('an alias finds the command it resolves to', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
  })
  await type('/cos')

  // Filtering on names alone leaves `/cost` looking like a command that does
  // not exist, which is the opposite of what advertising an alias is for.
  expect(offered()).toEqual(['/usage'])
  view.unmount()
})

test('the menu is keyboard-operable, and completing it does not will a Turn', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
  })
  await type('/c')

  expect(offered()).toEqual(['/clear', '/compact', '/usage'])
  expect(active()).toBe('/clear')
  await press('ArrowDown')
  expect(active()).toBe('/compact')
  await press('ArrowUp')
  expect(active()).toBe('/clear')
  // Round the ends, so the list is reachable from either direction.
  await press('ArrowUp')
  expect(active()).toBe('/usage')

  // Enter takes the highlighted command rather than sending what is typed:
  // sending `/c` would run a command nobody has — and would do it while a
  // menu was on screen saying `/c` was not yet a command.
  await press('Enter')
  expect(wire.posted).toEqual([])
  expect(composer().value).toBe('/usage ')
  expect(there(screen.queryByRole('listbox'))).toBe(false)

  // With the menu gone, Enter means what it always means.
  await enter()
  expect(wire.posted).toEqual([{ body: { type: 'prompt', text: '/usage ' } }])
  view.unmount()
})

test('esc closes the menu without interrupting the Turn behind it', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
    fake.frame({ kind: 'prompt', text: 'write a novel' })
  })
  await type('/c')

  await act(async () => escape())

  // The Session binds esc to interrupt. With a menu open, esc is the menu's:
  // dismissing a palette must not kill the Turn running behind it.
  expect(wire.posted).toEqual([])
  expect(there(screen.queryByRole('listbox'))).toBe(false)

  // And esc goes back to meaning interrupt the moment the menu is gone.
  await act(async () => escape())
  expect(wire.posted).toEqual([{ body: { type: 'interrupt' } }])
  view.unmount()
})

test('a command the runtime advertises mid-Session is reachable at once', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'commands', commands: COMMANDS })
  })
  await type('/dep')
  expect(there(screen.queryByRole('listbox'))).toBe(false)

  // `commands_changed` — a skill discovered while the agent worked in a
  // subdirectory. REPLACE semantics, so the old list goes with it.
  await act(async () => {
    fake.frame({
      kind: 'commands',
      commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>' }],
    })
  })

  expect(offered()).toEqual(['/deploy'])
  await type('/c')
  expect(there(screen.queryByRole('listbox'))).toBe(false)
  view.unmount()
})

test('a name that arrives with its slash already on it is still reachable', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  // The SDK documents `SlashCommand.name` as carrying no leading slash, and
  // `classify` keeps what it is given rather than tidying it. If that ever
  // stops holding, the failure is silent rather than ugly: `/clear` is not a
  // prefix of anything anyone types, so the menu answers every keystroke with
  // nothing at all. The breakage this fails on is drawing `//clear` and
  // matching nothing.
  await act(async () => {
    fake.frame({ kind: 'commands', commands: [{ name: '/clear', description: 'Clear it' }] })
  })
  await type('/cl')

  expect(offered()).toEqual(['/clear'])
  expect(screen.getByRole('option').textContent).not.toContain('//clear')
  view.unmount()
})

test('a runtime that advertises nothing offers nothing', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await type('/')

  // No empty box, and no invented defaults: a menu that listed commands the
  // runtime never advertised would be a palette of things that do not run.
  expect(there(screen.queryByRole('listbox'))).toBe(false)
  view.unmount()
})

test('an image is drawn from its handle, and says who put it there', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'image', mediaType: 'image/png', handle: 'img_pasted' })
    fake.frame({ kind: 'prompt', text: 'why is this button clipped' })
    fake.frame({
      kind: 'image',
      mediaType: 'image/png',
      handle: 'img_shown',
      toolCallId: 'toolu_shot',
    })
  })

  const [pasted, shown] = pictures()

  // Drawn from the handle and from nothing else. A `src` that were a data URI
  // or a path would mean the Message had named a location, which is the thing
  // the whole handle discipline exists to prevent.
  //
  // Nothing here passes `imageSrc`, so this is the hook's own default and the
  // shape the handler actually serves: the handle as a query parameter against
  // this Session's endpoint. Pinned rather than left incidental, because the
  // option added for replay must not change what every other caller gets.
  expect(pasted?.src).toBe(`${endpoint}?image=img_pasted`)
  expect(pasted?.src).toContain('img_pasted')
  expect(shown?.src).toContain('img_shown')
  for (const picture of pictures()) {
    expect(picture.src).not.toContain('data:')
    expect(picture.src).not.toContain('..')
  }

  // Alt text is required, and the two are not the same sentence: a picture the
  // person pasted and one the agent captured are different facts about the
  // conversation, and a reader who cannot see either must still be able to
  // tell them apart.
  //
  // Breakage this fails on: the `image` case still drawing `Undrawn`, or an
  // `<img>` with no alt — a picture that is silent to exactly the reader who
  // most needs it described.
  expect(pasted?.alt).not.toBe('')
  expect(shown?.alt).not.toBe('')
  expect(pasted?.alt).not.toBe(shown?.alt)
  expect(shown?.alt).toContain('toolu_shot')

  // And the Transcript keeps the order the Frames arrived in: the picture is
  // ahead of the words about it, which is where it was sent.
  const rows = [...screen.getByRole('log').children]
  expect(rows.findIndex((row) => row.querySelector('img'))).toBe(0)
  view.unmount()
})

test('an image the host is not holding draws its marker and fetches nothing', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'image', mediaType: 'image/png', handle: 'img_held' })
    // The shape the handler retains for an image it could not mint against —
    // one the SDK gave only a location for, or a payload that was not an
    // image. It arrived, so it is in the Transcript; it is not held, so there
    // is nothing to draw.
    fake.frame({ kind: 'image', mediaType: 'image/png' })
  })

  // Both through the one screen, and exactly one result. "An image with no
  // handle draws no picture" passes just as well when the whole case is
  // missing, so the held one is driven alongside it: two markers, one picture.
  //
  // Breakage this fails on: building a `src` from an absent handle, which is
  // `?image=undefined` — a request the browser really makes, to a handle
  // nobody minted, from a screen that will show a broken image either way.
  expect(shownImages()).toHaveLength(2)
  expect(pictures()).toHaveLength(1)
  expect(shownImages()[1]).toContain('not held')
  view.unmount()
})

test('a pasted screenshot travels with the prompt, ahead of the words about it', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  const wentThrough = await paste(png('one'), png('two'))
  // Taken by the composer rather than left to the browser, which would
  // otherwise insert the file's *name* into the words as well.
  expect(wentThrough).toBe(false)

  // What the composer writes in their place: one marker per picture, numbered
  // in the order they were pasted, so the sentence can name them.
  expect(composer().value).toBe('[Image #1] [Image #2] ')

  await type('why is [Image #1] clipped and [Image #2] not')
  await enter()

  // Both pictures, in the order they were pasted, and the words the person
  // wrote around the markers — the two halves of one sentence.
  //
  // Breakage this fails on: the paste being ignored altogether, which is the
  // silent one — the Turn runs, the agent answers, and it answers about a
  // picture it never received.
  expect(wire.posted).toEqual([
    {
      body: {
        type: 'prompt',
        text: 'why is [Image #1] clipped and [Image #2] not',
        images: [
          { mediaType: 'image/png', data: base64('one') },
          { mediaType: 'image/png', data: base64('two') },
        ],
      },
    },
  ])
  // And the composer is empty of both, so the next Turn does not resend them.
  expect(composer().value).toBe('')
  expect(attached()).toEqual([])
  view.unmount()
})

test('what is pasted is visible before it is sent, and can be taken back', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await paste(png('one'), png('two'))

  // A paste that vanished into a variable is a paste the person cannot check,
  // cannot count and cannot undo. Two of them, told apart.
  expect(attached()).toHaveLength(2)

  await act(async () => attachment(0).click())
  expect(attached()).toHaveLength(1)

  await type('just this one')
  await enter()

  expect(wire.posted).toEqual([
    {
      body: {
        type: 'prompt',
        text: 'just this one',
        images: [{ mediaType: 'image/png', data: base64('two') }],
      },
    },
  ])
  view.unmount()
})

test('a screenshot with no words still starts a Turn, and is never silently dropped', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await paste(png('one'))
  // The words the composer wrote itself are words: a picture pasted into an
  // empty composer sends as its own marker.
  await enter()

  expect(wire.posted).toEqual([
    {
      body: {
        type: 'prompt',
        text: '[Image #1] ',
        images: [{ mediaType: 'image/png', data: base64('one') }],
      },
    },
  ])
  expect(attached()).toEqual([])
  view.unmount()
})

test('a screenshot with the marker deleted still starts a Turn', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await paste(png('one'))
  // The marker is text like any other, so it can be deleted — and then the
  // composer is holding a picture and no words at all. This is the arm the
  // markers took away from the test above, and it is the one that matters:
  // "look at this" is a whole prompt when the picture *is* the prompt.
  //
  // Breakage this fails on — the silent one, which is why it is here: `send`
  // guards on whitespace, so a Turn carrying a picture and no words wills
  // nothing, while the composer clears the tray on submit anyway. The
  // screenshot vanishes, no Turn starts, and nothing on screen says why.
  await type('')
  await enter()

  expect(wire.posted).toEqual([
    { body: { type: 'prompt', text: '', images: [{ mediaType: 'image/png', data: base64('one') }] } },
  ])
  expect(attached()).toEqual([])
  view.unmount()
})

test('the marker goes in at the cursor, not at the end', async () => {
  const fake = fakeSse()
  const view = await mount(fake, { fetch: recorder().fetch })

  await type('why is this clipped')
  const field = composer()
  field.selectionStart = 7 // just after "why is "
  field.selectionEnd = 7
  await paste(png('one'))

  // Where the cursor is, is where the person is talking about. Appending
  // instead would make every prompt read "…and here is a picture", which is
  // the one sentence a marker exists to avoid.
  //
  // Breakage this fails on: reading the caret after the bytes are read, by
  // which time it has moved — or never reading it at all.
  expect(composer().value).toBe('why is [Image #1] this clipped')
  view.unmount()
})

test('the tray shows the picture, numbered to match the words', async () => {
  const fake = fakeSse()
  const view = await mount(fake, { fetch: recorder().fetch })

  await paste(png('one'), png('two'))

  // A tray of file names cannot answer the only question a person has after
  // pasting twice — *which two* — because a clipboard screenshot is called
  // `image.png` every time. The picture answers it.
  //
  // Breakage this fails on: the tray drawn from `name`, which is what shipped.
  const shown = [...document.querySelectorAll<HTMLImageElement>('[data-attachment] img')]
  expect(shown).toHaveLength(2)
  expect(shown[0]?.src).toBe(`data:image/png;base64,${base64('one')}`)
  expect(shown[1]?.src).toBe(`data:image/png;base64,${base64('two')}`)

  // And numbered the same as the markers now sitting in the draft, so moving
  // "[Image #2]" in the sentence moves a picture the person can see.
  expect(attached()).toEqual(['[Image #1]✕', '[Image #2]✕'])
  expect(composer().value).toContain('[Image #2]')
  view.unmount()
})

test('taking a picture back takes its marker with it, and renumbers the rest', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await paste(png('one'), png('two'))
  await type('compare [Image #1] against [Image #2] please')

  await act(async () => attachment(0).click())

  // The first picture is gone, so the second is now the first — in the tray
  // and in the sentence alike.
  //
  // Breakage this fails on: dropping the picture and leaving the words, which
  // sends the agent a prompt about an [Image #2] that is not in the request,
  // and no [Image #1] for the picture that is.
  expect(composer().value).toBe('compare against [Image #1] please')
  expect(attached()).toEqual(['[Image #1]✕'])

  await enter()
  expect(wire.posted).toEqual([
    {
      body: {
        type: 'prompt',
        text: 'compare against [Image #1] please',
        images: [{ mediaType: 'image/png', data: base64('two') }],
      },
    },
  ])
  view.unmount()
})

test('whitespace with nothing attached still wills nothing', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await type('   ')
  await enter()

  // The other arm. Loosening the guard so a picture can travel must not
  // loosen it for an empty composer, which is what "whitespace alone starts
  // no Turn" has always meant.
  expect(wire.posted).toEqual([])
  view.unmount()
})

test('a picture is described once, and one with no picture is still described', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'image', mediaType: 'image/png', handle: 'img_held' })
    fake.frame({ kind: 'image', mediaType: 'image/png' })
  })

  const [held, unheld] = [...document.querySelectorAll('[data-image]')]

  // The caption is verbatim the picture's alt, so a reader who hears both
  // hears the same sentence twice. The alt is what carries it — it is required
  // and it is on the picture itself — so the caption beside it is decoration.
  const heldCaption = held?.querySelector('[data-caption]')
  const unheldCaption = unheld?.querySelector('[data-caption]')
  expect(held?.querySelector('img')?.alt).toBe(heldCaption?.textContent?.trim().replace('▣ ', ''))
  expect(held?.querySelector('img')?.alt).not.toBe('')
  expect(heldCaption?.getAttribute('aria-hidden')).toBe('true')

  // But only where there *is* a picture to carry it. Hiding the caption
  // unconditionally would leave the unheld case with no accessible text at
  // all — silencing the very entry that exists to say something arrived that
  // cannot be shown.
  //
  // Breakage this fails on: `aria-hidden` on the caption without the
  // condition, which reads as tidier and makes half the states mute.
  expect(unheld?.querySelector('img')).toBe(null)
  // Either absent or an explicit "false" — both mean audible; only "true"
  // would silence it, which is the one thing this is asserting against.
  expect(unheldCaption?.getAttribute('aria-hidden')).not.toBe('true')
  expect(unheldCaption?.textContent ?? '').toContain('not held')
  view.unmount()
})

test('a picture is drawn at its own size, not stretched by the column around it', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({ kind: 'image', mediaType: 'image/png', handle: 'img_held' })
  })

  const picture = document.querySelector<HTMLImageElement>('[data-image] img')
  const drawn = (picture?.className ?? '').split(/\s+/)

  // happy-dom lays nothing out, so this asserts the rule rather than the
  // pixels — but the rule is the whole bug. The picture sits in a column flex,
  // whose `align-items` is `stretch`, and an `img` stretches under it like any
  // other item: to the Transcript's full width, with `height: auto` following
  // its aspect ratio. `max-w-full` does not save it, because nothing is over
  // 100%.
  //
  // Breakage this fails on: dropping `self-start`, which is what shipped — a
  // 200px screenshot blown up into a blurry wall, and the 1×1 replay fixture
  // drawn as an empty square as tall as the Transcript is wide, which reads
  // exactly like an image that failed to load.
  expect(drawn).toContain('cc:self-start')
  // And capped both ways, so a phone screenshot cannot take the whole column.
  expect(drawn).toContain('cc:max-w-full')
  expect(drawn.some((one) => one.startsWith('cc:max-h-'))).toBe(true)
  view.unmount()
})

test('a picture the host would not hold is refused out loud, not dropped', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await paste(svg('diagram'))

  // Refusing an SVG is right — it is script-capable, and holding one would
  // mean serving a script from the Session's own origin. Saying nothing about
  // it is not: the person watches a paste do nothing at all and concludes the
  // paste did not register, rather than that it was turned down.
  //
  // Breakage this fails on: filtering the clipboard down to what is holdable
  // and letting an empty result fall through as if nothing had been pasted.
  expect(attached()).toEqual([])
  expect(refusal()).toContain('image/svg+xml')

  // And it stays refused rather than quietly travelling anyway.
  await type('what is wrong with this')
  await enter()
  expect(wire.posted).toEqual([{ body: { type: 'prompt', text: 'what is wrong with this' } }])
  view.unmount()
})

test('a refusal goes away when a picture the host will hold arrives', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await paste(svg('diagram'))
  expect(refusal()).not.toBe('')

  await paste(png('one'))

  // The other arm, through the same screen. A refusal left standing over a
  // paste that worked would say the screenshot in the tray had been turned
  // down — which is the same lie in the opposite direction, and "no refusal
  // is shown" alone cannot tell a cleared message from one never written.
  expect(refusal()).toBe('')
  expect(attached()).toHaveLength(1)
  view.unmount()
})

test('pasting words is still pasting words', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  const wentThrough = await pasteText('a stack trace')
  await type('what does this mean')
  await enter()

  // Breakage this fails on: a paste handler that calls `preventDefault` on
  // everything, so pasting a stack trace into the composer quietly stops
  // working the day images land — a regression nothing else here would catch,
  // and one no assertion about state could see, because the composer's own
  // insertion is the browser's default action rather than anything React does.
  expect(wentThrough).toBe(true)
  expect(attached()).toEqual([])
  expect(wire.posted).toEqual([
    { body: { type: 'prompt', text: 'what does this mean' } },
  ])
  view.unmount()
})

test('a prompt with no pictures carries no `images` field at all', async () => {
  const fake = fakeSse()
  const wire = recorder()
  const view = await mount(fake, { fetch: wire.fetch })

  await type('just words')
  await enter()

  // The other arm of the predicate. An always-present `images: []` would pass
  // every test above while changing what an ordinary Turn puts on the wire.
  expect(wire.posted).toEqual([{ body: { type: 'prompt', text: 'just words' } }])
  view.unmount()
})

// --- driving the seam ---------------------------------------------------------

/** What each image entry says, in Transcript order — picture or no picture. */
function shownImages(): string[] {
  return [...document.querySelectorAll('[data-image]')].map((one) => (one.textContent ?? '').trim())
}

/** Every picture on screen, in Transcript order. */
function pictures(): HTMLImageElement[] {
  return [...document.querySelectorAll<HTMLImageElement>('[data-image] img')]
}

/** An SVG — an image to the clipboard, and a script to a browser. */
function svg(body: string): File {
  return new File([body], `${body}.svg`, { type: 'image/svg+xml' })
}

/** What the composer says about a paste it turned down. */
function refusal(): string {
  return (document.querySelector('[data-paste-refused]')?.textContent ?? '').trim()
}

/** A PNG whose bytes say which one it is, so two pastes are told apart. */
function png(body: string): File {
  return new File([body], `${body}.png`, { type: 'image/png' })
}

function base64(body: string): string {
  return btoa(body)
}

/**
 * Pasting pictures: what the clipboard hands a composer after a screenshot.
 * Reports whether the default action survived — `fireEvent` returns false when
 * something called `preventDefault`, which is the only way to see that the
 * browser's own insertion was spoken for.
 */
async function paste(...files: File[]): Promise<boolean> {
  let wentThrough = true
  await act(async () => {
    wentThrough = fireEvent.paste(composer(), { clipboardData: { files, items: [] } })
    // Reading a File is asynchronous, as it is in a browser.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return wentThrough
}

/** Pasting words, which is what a composer's paste has always been for. */
async function pasteText(text: string): Promise<boolean> {
  let wentThrough = true
  await act(async () => {
    wentThrough = fireEvent.paste(composer(), {
      clipboardData: { files: [], items: [], getData: () => text },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return wentThrough
}

/** What the composer says it is about to send with the words. */
function attached(): string[] {
  return [...document.querySelectorAll('[data-attachment]')].map((one) =>
    (one.textContent ?? '').trim(),
  )
}

function attachment(at: number): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>('[data-attachment] button')[at]
  if (!found) throw new Error(`no attachment at ${at}`)
  return found
}

/** What a runtime advertises, described — the shape `supportedCommands()` gives. */
const COMMANDS = [
  { name: 'clear', description: 'Clear the conversation' },
  { name: 'compact', description: 'Summarise the conversation', argumentHint: '[focus]' },
  {
    name: 'usage',
    description: 'Show what this Session has spent',
    argumentHint: '[window]',
    aliases: ['cost', 'stats'],
  },
]

/** The command names the menu is offering, in the order it offers them. */
function offered(): string[] {
  return screen.queryAllByRole('option').map((row) => row.getAttribute('data-command') ?? '')
}

/** The one row Enter would take. */
function active(): string | undefined {
  return screen
    .queryAllByRole('option')
    .find((row) => row.getAttribute('aria-selected') === 'true')
    ?.getAttribute('data-command') as string | undefined
}

function press(key: string): Promise<void> {
  return act(async () => {
    fireEvent.keyDown(composer(), { key })
  })
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Prompt') as HTMLTextAreaElement
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

/** What every marker of a kind says, in Transcript order. */
function markers(kind: string): string[] {
  return [...document.querySelectorAll(`[data-divergence="${kind}"]`)].map((one) =>
    (one.textContent ?? '').trim(),
  )
}

/** The nth marker of a kind, for what is read off it rather than out of it. */
function marker(kind: string, at: number): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>(`[data-divergence="${kind}"]`)[at]
  if (!found) throw new Error(`no ${kind} marker at ${at}`)
  return found
}

/**
 * What a marker's own long output shows before anyone expands it — the lines a
 * reader is made to scroll past, which is the whole complaint.
 */
function preview(kind: string, at: number): string[] {
  const shown = marker(kind, at).querySelector('[data-preview]')
  if (!shown) throw new Error(`no preview on the ${kind} marker at ${at}`)
  return (shown.textContent ?? '').split('\n')
}

/** Everything that output said, expanded — what collapsing must not lose. */
function whole(kind: string, at: number): string {
  const held = marker(kind, at).querySelector('[data-whole]')
  if (!held) throw new Error(`no expanded output on the ${kind} marker at ${at}`)
  return held.textContent ?? ''
}

function statusOf(kind: string, at: number): string | undefined {
  return marker(kind, at).dataset['status']
}

function colourAt(kind: string, at: number): string {
  return marker(kind, at).style.color
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

/** A `Task` call, which is the only thing that opens a Thread. */
function opens(id: string, description: string, subagentType: string): Frame {
  return {
    kind: 'tool-call',
    id,
    name: 'Task',
    input: { description, subagent_type: subagentType, prompt: description },
    opens: { thread: id, description, subagentType },
  }
}

/** One Thread's meter. */
function meter(thread: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-thread-meter="${thread}"]`)
  if (!found) throw new Error(`no meter for ${thread}`)
  return found
}

/** What a Thread's meter says it has been running for, if it says anything. */
function elapsed(thread: string): string | undefined {
  return meter(thread).querySelector('[data-thread-elapsed]')?.textContent ?? undefined
}

/** How many entries the Transcript is drawing at the top level. */
function drawn(): number {
  return screen.getByRole('log').children.length
}

/**
 * A clock a test moves itself. The meter's duration is the one number on
 * screen that comes from a clock rather than from a Frame, so the clock is
 * injectable for the same reason the transport is.
 */
function byHand(): ThreadClock & { advance(ms: number): Promise<void> } {
  let at = 0
  const ticking = new Set<() => void>()
  return {
    now: () => at,
    tick: (onTick) => {
      ticking.add(onTick)
      return () => ticking.delete(onTick)
    },
    advance: async (ms) => {
      at += ms
      await act(async () => {
        for (const onTick of [...ticking]) onTick()
      })
    },
  }
}


const endpoint = 'http://localhost/agent'

/** The committed 37-Frame log — every Frame kind `classify` can emit. */
const golden = goldenLog as Frame[]

test("the agent's answer is drawn as the Markdown it is written in", async () => {
  // Reached through the container, so the wiring is covered as well as the
  // renderer: a perfect renderer nothing calls draws nothing. Claude Code
  // answers in Markdown constantly, and all of it used to arrive as one run of
  // literal text with the asterisks and backticks still in it.
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () =>
    fake.frame({ kind: 'text', text: '## What I did\n\n- ran `bun test`\n- **it passed**' }),
  )

  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('What I did')
  expect(document.querySelectorAll('li').length).toBe(2)
  expect(document.querySelector('code')?.textContent).toBe('bun test')
  expect(document.querySelector('strong')?.textContent).toBe('it passed')

  // The person's own words are not Markdown — they are what they typed.
  await act(async () => fake.frame({ kind: 'prompt', text: 'why is **this** broken' }))
  expect(screen.getByText('why is **this** broken')).toBeDefined()
  view.unmount()
})

async function mount(
  fake: FakeSse,
  options: Partial<AgentSessionOptions> = {},
  props: { threads?: ThreadDisplay; clock?: ThreadClock } = {},
): Promise<{ unmount(): void }> {
  function Host() {
    const session = useAgentSession({
      endpoint,
      createEventSource: fake.createEventSource,
      ...options,
    })
    return <ClaudeSession session={session} {...props} />
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

/** What the working line reads, minus the stylesheet it carries inline. */
function working(): string {
  const status = screen.getByRole('status')
  let text = status.textContent ?? ''
  for (const style of status.querySelectorAll('style')) {
    text = text.replace(style.textContent ?? '', '')
  }
  return text
}
