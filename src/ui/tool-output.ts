import type { ToolCallMessage } from '../core/transcript.ts'
import type { DiffLine } from './claude-diff.tsx'
import type { Todo } from './claude-todo-list.tsx'

/**
 * What a tool answered, read into the props the components already take.
 *
 * Ours rather than vendored, and kept out of `session.tsx` so the container
 * stays the thin wiring it says it is. Nothing here knows what a Session is
 * either — it reads a Message and returns props.
 *
 * The one rule this file exists to keep: **it never invents a diff.** Every
 * line rendered comes from the SDK's own `structuredPatch`, which `Edit` and
 * `Write` carry on their Output. There is no diff algorithm here, no file
 * read, and therefore no race between reading a file and the edit landing —
 * and where the patch does not reach us, the answer is `undefined` and the
 * caller falls back to the plain tool line. A plausible-looking diff nobody
 * can back up is worse than none: someone reviews code from it.
 */

/** The props `ClaudeDiff` takes, derived from what the tool answered. */
export type Diff = {
  file: string
  summary: string
  lines: DiffLine[]
}

/**
 * One hunk of a unified patch, as `FileEditOutput` / `FileWriteOutput` carry
 * it. Declared here rather than imported so a log recorded against an SDK
 * version this build has never seen still reads — the same rule `classify`
 * follows on the way in.
 */
type Hunk = {
  oldStart: number
  newStart: number
  lines: string[]
}

/**
 * The diff a tool call produced, or `undefined` where there is none to draw.
 *
 * Keyed off the shape rather than off the tool's name: anything that answers
 * with a `structuredPatch` has said what changed, and a tool named something
 * this build has not heard of is not a reason to throw that away.
 *
 * A call that failed never draws a diff, whatever it attached. `structured`
 * survives on the Message once a result lands, so an errored `Edit` drawn from
 * it would be the screen showing a change that was not made.
 */
export function diffOf(message: ToolCallMessage): Diff | undefined {
  if (message.status !== 'success') return undefined

  const output = record(message.structured)
  const hunks = hunksIn(output?.['structuredPatch'])
  if (hunks.length === 0) return undefined

  const lines = linesOf(hunks)
  const additions = lines.filter((line) => line.type === 'add').length
  const removals = lines.filter((line) => line.type === 'del').length
  // A patch that changed nothing is not a diff. Drawn anyway it would be an
  // empty box under a heading claiming a file was updated.
  if (additions + removals === 0) return undefined

  const file = str(output?.['filePath']) ?? str(message.input['file_path']) ?? message.name

  return {
    file,
    // `originalFile` is `null` on both Output types exactly when the file did
    // not exist before, so a `Write` that created a file says so instead of
    // reporting it as an update of something that was never there.
    summary: summaryOf(output !== undefined && output['originalFile'] === null, additions, removals),
    lines,
  }
}

/**
 * A patch's hunks laid out as rows, each carrying the number a reader would
 * find it at.
 *
 * Which file a row is numbered against is the whole of the care here. A
 * removed line exists only in the file that was replaced, so it takes the old
 * number; an added line exists only in the file that now exists, so it takes
 * the new one; a context line is in both and is numbered against the file a
 * reader is about to open — the new one. Numbering context from the old file
 * is the silent failure this is written to avoid: after an insertion every
 * later row is off by exactly the number of lines inserted, and the diff still
 * reads perfectly.
 */
function linesOf(hunks: Hunk[]): DiffLine[] {
  const out: DiffLine[] = []

  for (const [at, hunk] of hunks.entries()) {
    // The gap between two hunks. Without it a row numbered 5 sits directly
    // above one numbered 42 and the two read as consecutive.
    if (at > 0) out.push({ type: 'ctx', text: '⋯' })

    let oldAt = hunk.oldStart
    let newAt = hunk.newStart

    for (const line of hunk.lines) {
      const text = line.slice(1)
      switch (line[0]) {
        case '+':
          out.push({ type: 'add', n: newAt, text })
          newAt += 1
          break
        case '-':
          out.push({ type: 'del', n: oldAt, text })
          oldAt += 1
          break
        case '\\':
          // "\ No newline at end of file" — a note about the line above, not a
          // line of either file. Counted as one it would shift every number
          // below it by one, which is the same off-by-one wearing a hat.
          out.push({ type: 'ctx', text })
          break
        default:
          out.push({ type: 'ctx', n: newAt, text })
          oldAt += 1
          newAt += 1
      }
    }
  }

  return out
}

function summaryOf(created: boolean, additions: number, removals: number): string {
  if (created) return `Created with ${count(additions, 'line')}`
  const said = [
    additions === 0 ? undefined : count(additions, 'addition'),
    removals === 0 ? undefined : count(removals, 'removal'),
  ].filter((part): part is string => part !== undefined)
  return `Updated with ${said.join(' and ')}`
}

function count(many: number, noun: string): string {
  return `${many} ${noun}${many === 1 ? '' : 's'}`
}

/**
 * The agent's plan, as `TodoWrite` states it, or `undefined` where there is no
 * list to draw.
 *
 * Read from the result where there is one and from the call's own input where
 * there is not. The input is not a fallback for its own sake: it is the list
 * the moment the call starts, so the plan is on screen before the tool answers
 * — and it is the only copy left when `classify` withholds the structured
 * output because one message answered several calls at once.
 *
 * A call that failed draws no list. The plan it names was not the one adopted.
 */
export function todosOf(message: ToolCallMessage): Todo[] | undefined {
  if (message.status === 'error') return undefined

  const answered = record(message.structured)?.['newTodos']
  const todos = entriesIn(answered) ?? entriesIn(message.input['todos'])
  return todos !== undefined && todos.length > 0 ? todos : undefined
}

/** What the SDK calls each state, and what `ClaudeTodoList` draws it as. */
const STATE: Record<string, Todo['status']> = {
  completed: 'done',
  in_progress: 'active',
  pending: 'todo',
}

function entriesIn(value: unknown): Todo[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item): Todo[] => {
    const entry = record(item)
    // `activeForm` is the same task said in the present tense, so it stands in
    // where there is no `content` rather than leaving a row with no words.
    const label = entry && (str(entry['content']) ?? str(entry['activeForm']))
    if (label === undefined) return []

    const said = entry && str(entry['status'])
    const status = said === undefined ? undefined : STATE[said]
    // A state this build has no glyph for. Drawn as ◻ alone it would report,
    // say, a cancelled task as one still to do — the wrong state, drawn with
    // full confidence. Dropping the row loses the task altogether. So the row
    // stays and carries the runtime's own word for where it stands.
    if (status === undefined) {
      return [{ label: said === undefined ? label : `${label} (${said})`, status: 'todo' }]
    }
    return [{ label, status }]
  })
}

/** Hunks that are actually usable. One missing its starts cannot be numbered. */
function hunksIn(value: unknown): Hunk[] {
  return list(value).flatMap((entry): Hunk[] => {
    const hunk = record(entry)
    const oldStart = hunk && num(hunk['oldStart'])
    const newStart = hunk && num(hunk['newStart'])
    const lines = hunk && strings(hunk['lines'])
    if (oldStart === undefined || newStart === undefined || lines === undefined) return []
    return [{ oldStart, newStart, lines }]
  })
}

// --- reading a shape we do not control ---------------------------------------

type Rec = Record<string, unknown>

function record(value: unknown): Rec | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined
}
