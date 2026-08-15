import { act, render, screen } from '@testing-library/react'
import { expect, test } from 'bun:test'

import { fakeSse, type FakeSse } from '../react/fake.ts'
import { useAgentSession } from '../react/session.ts'
import { ClaudeSession } from './session.tsx'

/**
 * What a tool answered, drawn as the thing it is: a file edit is a diff, and
 * the agent's plan is a list.
 *
 * Everything here is asserted through `ClaudeSession` over the real hook and
 * the real `reduce`, so what is proved is the whole path a Frame takes to the
 * screen — including that `structured` survives `reduce` at all. A test that
 * handed the mapping a hunk directly would pass with the wire disconnected.
 *
 * The diffs come from the SDK's own `structuredPatch`; nothing here computes a
 * diff, reads a file, or guesses. The line numbers are the risk — an
 * off-by-one produces a diff that renders perfectly and points at the wrong
 * lines — so every case asserts the whole gutter, not that "a diff appeared".
 */

/** An insertion: the old and new line numbers diverge, which is the point. */
const INSERTION = {
  filePath: '/repo/src/a.ts',
  originalFile: 'alpha\nbeta\ngamma\n',
  structuredPatch: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 5,
      lines: [' alpha', '+inserted one', '+inserted two', ' beta', ' gamma'],
    },
  ],
}

test('an Edit is drawn as a diff, numbered against the file it produced', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_edit',
      name: 'Edit',
      input: { file_path: '/repo/src/a.ts' },
    })
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_edit',
      output: 'Applied 1 edit',
      isError: false,
      structured: INSERTION,
    })
  })

  // Two lines were inserted after `alpha`, so `beta` is line 4 of the file
  // that now exists and `gamma` is line 5. Numbered from the *old* file they
  // would read 2 and 3 — a diff that looks entirely correct and sends a
  // reviewer to the wrong lines. That is what this pins.
  expect(rows('/repo/src/a.ts')).toEqual([
    '1| |alpha',
    '2|+|inserted one',
    '3|+|inserted two',
    '4| |beta',
    '5| |gamma',
  ])
  view.unmount()
})

/**
 * A `Write` that made a file that was not there. `originalFile` is `null`,
 * which is the only thing on the wire saying so.
 *
 * `oldStart` is deliberately not what this leans on: a pure insertion consumes
 * no old line numbers, so the rows render identically whether the SDK numbers
 * the absent file from 0 or from 1. Asserting it either way would be pinning a
 * detail this build cannot verify.
 */
const CREATION = {
  type: 'create',
  filePath: '/repo/src/new.ts',
  content: 'export const one = 1\nexport const two = 2\n',
  originalFile: null,
  structuredPatch: [
    {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: ['+export const one = 1', '+export const two = 2'],
    },
  ],
}

test('a Write that created a file says so, rather than reporting an update', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_write',
      name: 'Write',
      input: { file_path: '/repo/src/new.ts' },
    })
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_write',
      output: 'File created successfully',
      isError: false,
      structured: CREATION,
    })
  })

  expect(rows('/repo/src/new.ts')).toEqual([
    '1|+|export const one = 1',
    '2|+|export const two = 2',
  ])

  // `originalFile: null` is the whole difference between a file that was made
  // and a file that was changed, and it is the only place the wire says which.
  // Read past, a creation reads as an edit to something that never existed.
  expect(said('/repo/src/new.ts')).toContain('Created with 2 lines')
  expect(said('/repo/src/new.ts')).not.toContain('Updated with')
  view.unmount()
})

/**
 * Two hunks from one edit. The second starts 39 lines below the first, and its
 * `newStart` is its `oldStart` plus the two lines the first hunk inserted —
 * which is what a real patch of this file would carry.
 */
const TWO_HUNKS = {
  filePath: '/repo/src/two.ts',
  originalFile: 'alpha\nbeta\ngamma\n',
  structuredPatch: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 5,
      lines: [' alpha', '+inserted one', '+inserted two', ' beta', ' gamma'],
    },
    {
      oldStart: 40,
      oldLines: 4,
      newStart: 42,
      newLines: 2,
      lines: [' one', '-two', '-three', ' four'],
    },
  ],
}

test('every hunk of a patch is drawn, each numbered from its own start', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_multi',
      name: 'Edit',
      input: { file_path: '/repo/src/two.ts' },
    })
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_multi',
      output: 'Applied 2 edits',
      isError: false,
      structured: TWO_HUNKS,
    })
  })

  expect(rows('/repo/src/two.ts')).toEqual([
    '1| |alpha',
    '2|+|inserted one',
    '3|+|inserted two',
    '4| |beta',
    '5| |gamma',
    // The gap. Line 5 sitting directly above line 42 would read as one
    // continuous stretch of a file, which is a claim about code nobody made.
    '| |⋯',
    '42| |one',
    // Removed lines keep the number they had in the file that was replaced —
    // it is the only number they have. Numbered against the new file they
    // would both read 42, pointing two different deletions at one line.
    '41|-|two',
    '42|-|three',
    '43| |four',
  ])

  expect(said('/repo/src/two.ts')).toContain('Updated with 2 additions and 2 removals')
  view.unmount()
})

test('an Edit that answered without a patch draws its plain line, not a diff', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  // `classify` withholds the structured output when one user message answers
  // more than one call, so an `Edit` batched with another tool arrives with no
  // patch at all. There is nothing to draw and nothing to reconstruct — a file
  // read now would race the next edit, and a guess would be a diff someone
  // reviews code from.
  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_bare',
      name: 'Edit',
      input: { file_path: '/repo/src/bare.ts' },
    })
    fake.frame({ kind: 'tool-result', id: 'toolu_bare', output: 'Applied 1 edit', isError: false })
  })

  expect(there(document.querySelector('[data-diff]'))).toBe(false)
  // Still on screen, though: the call happened, and a Transcript that drops it
  // because it could not draw it the pretty way has lost the edit entirely.
  expect(screen.getByText('/repo/src/bare.ts')).toBeDefined()
  expect(screen.getByText('Applied 1 edit')).toBeDefined()
  view.unmount()
})

test('an Edit that failed is never drawn as a change that landed', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_fail',
      name: 'Edit',
      input: { file_path: '/repo/src/a.ts' },
    })
    // A patch rides along on the failure. Drawn from it, the screen would show
    // a file that still says `alpha` as though it had been rewritten.
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_fail',
      output: 'String to replace not found',
      isError: true,
      structured: INSERTION,
    })
  })

  expect(there(document.querySelector('[data-diff]'))).toBe(false)
  expect(status('Edit')).toBe('error')
  view.unmount()
})

test('a "no newline at end of file" note does not consume a line number', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_eof',
      name: 'Edit',
      input: { file_path: '/repo/src/eof.ts' },
    })
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_eof',
      output: 'Applied 1 edit',
      isError: false,
      structured: {
        filePath: '/repo/src/eof.ts',
        originalFile: 'one\ntwo',
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 3,
            lines: [' one', '-two', '\\ No newline at end of file', '+two', '+three'],
          },
        ],
      },
    })
  })

  // The `\` row is a note about the line above it, not a line of either file.
  // Counted as one, every row below it shifts by one — an off-by-one that
  // appears only in files that happen to lack a trailing newline.
  expect(rows('/repo/src/eof.ts')).toEqual([
    '1| |one',
    '2|-|two',
    '| | No newline at end of file',
    '2|+|two',
    '3|+|three',
  ])
  view.unmount()
})

// --- the agent's plan ----------------------------------------------------------

const PLAN = [
  { content: 'Read the spec', status: 'completed', activeForm: 'Reading the spec' },
  { content: 'Wire the diff', status: 'in_progress', activeForm: 'Wiring the diff' },
  { content: 'Add the replay case', status: 'pending', activeForm: 'Adding the replay case' },
]

test("a TodoWrite is drawn as the agent's list, each item in the state it is in", async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_todo',
      name: 'TodoWrite',
      input: { todos: PLAN },
    })
    fake.frame({
      kind: 'tool-result',
      id: 'toolu_todo',
      output: 'Todos have been modified successfully',
      isError: false,
      structured: { oldTodos: [], newTodos: PLAN },
    })
  })

  // Glyph, words and announced state are read together. A list whose three
  // rows all render ◻ is still "a todo list on screen" — and says nothing
  // true about what the agent has done, is doing, or has not started.
  expect(todos()).toEqual([
    '⎿ ✔ Read the spec (completed)',
    '◼ Wire the diff (in progress)',
    '◻ Add the replay case (pending)',
  ])
  view.unmount()
})

test('the plan is on screen while the call is still in flight', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  // The list is the call's own input, so it is renderable before the tool
  // answers — and it is the only copy that survives when `classify` withholds
  // the structured output because one message answered several calls.
  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_todo',
      name: 'TodoWrite',
      input: { todos: PLAN },
    })
  })

  expect(todos()).toEqual([
    '⎿ ✔ Read the spec (completed)',
    '◼ Wire the diff (in progress)',
    '◻ Add the replay case (pending)',
  ])
  view.unmount()
})

test('a state this build does not know is not quietly drawn as pending', async () => {
  const fake = fakeSse()
  const view = await mount(fake)

  await act(async () => {
    fake.frame({
      kind: 'tool-call',
      id: 'toolu_todo',
      name: 'TodoWrite',
      input: {
        todos: [{ content: 'Ship it', status: 'cancelled', activeForm: 'Shipping it' }],
      },
    })
  })

  // `ClaudeTodoList` has three states and the SDK may grow a fourth. Mapping
  // an unknown one onto ◻ would report a cancelled task as one still to do —
  // the wrong state, drawn confidently. Dropping the row is worse still: the
  // task vanishes. So it renders, and says what it actually is.
  expect(todos()).toEqual(['⎿ ◻ Ship it (cancelled) (pending)'])
  view.unmount()
})

// --- reading what is on screen ------------------------------------------------

/**
 * One diff's gutter, mark and text, row by row, as `number|mark|text`. The
 * three are read together on purpose: a row asserted only by its text passes
 * whatever number sits beside it.
 */
function rows(file: string): string[] {
  const diff = document.querySelector(`[data-diff="${file}"]`)
  if (!diff) throw new Error(`no diff for ${file}`)
  const pre = diff.querySelector('pre')
  if (!pre) throw new Error(`no diff body for ${file}`)
  return [...pre.children].map((row) => {
    const copy = row.cloneNode(true) as HTMLElement
    // The "added: " / "removed: " prefixes are for a reader, not for the eye.
    for (const hidden of copy.querySelectorAll('[class~="cc:sr-only"]')) hidden.remove()
    return [...copy.children].map((cell) => cell.textContent ?? '').join('|')
  })
}

/** Everything one diff says, headline and summary included. */
function said(file: string): string {
  const diff = document.querySelector(`[data-diff="${file}"]`)
  if (!diff) throw new Error(`no diff for ${file}`)
  return diff.textContent ?? ''
}

/**
 * Each row of the agent's plan: its glyph, its words, and the state announced
 * to a reader, in one string. Read apart, a row asserted only by its words
 * passes in whatever state it happens to be drawn.
 */
function todos(): string[] {
  const list = document.querySelector('[data-todos]')
  if (!list) throw new Error('no todo list')
  return [...list.querySelectorAll('li')].map((row) =>
    (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
  )
}

/** What a plain tool line claims about how the call went. */
function status(tool: string): string | undefined {
  const found = screen.getByText(tool).closest('details')
  if (!found) throw new Error(`no tool line for ${tool}`)
  return found.dataset['status']
}

/**
 * Whether something is on screen, as a boolean — asserted on a value rather
 * than on the node, because printing a failed DOM assertion walks a graph with
 * cycles in it and never comes back.
 */
function there(node: Element | null | undefined): boolean {
  return node !== null && node !== undefined
}

const endpoint = 'http://localhost/agent'

async function mount(fake: FakeSse): Promise<{ unmount(): void }> {
  function Host() {
    const session = useAgentSession({ endpoint, createEventSource: fake.createEventSource })
    return <ClaudeSession session={session} />
  }
  const view = render(<Host />)
  await act(async () => {
    await Promise.resolve()
  })
  return view
}
