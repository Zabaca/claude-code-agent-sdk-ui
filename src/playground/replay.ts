import type { Frame, SlashCommandInfo } from '../core/frame.ts'
import type { PartialText } from '../core/partial.ts'
import type { AgentEventSource, AgentEventSourceFactory, AgentFetch } from '../react/session.ts'

/**
 * Replay — the playground's other half, and the fourth job the Frame log does.
 *
 * The Frame log is already the wire format, the test fixture and the reconnect
 * mechanism. Here it is a driver: a scripted log played into
 * `useAgentSession`'s own injectable transport, so the whole surface runs with
 * no credential, no network and no SDK. A reviewer sees the UI in seconds and
 * for free.
 *
 * It stands in for the transport and for nothing else. `useAgentSession`,
 * `reduce` and the components are the same ones live mode runs — if replay and
 * live diverged in code, replay would stop proving anything about live. What
 * replay substitutes is exactly what the handler substitutes when it is given
 * a `createQuery`: where the Frames come from.
 */

/** One thing the script does: a Frame, live text, or a pause before either. */
export type Beat = {
  /** How long after the previous beat this one lands. */
  after?: number
  /** Retained, and delivered with its index as `id:` — as the handler does. */
  frame?: Frame
  /** Live text. No `id:`, so it never moves the resume cursor. */
  partial?: PartialText
}

export type ReplayOptions = {
  /**
   * How the script waits between beats. The seam a test drives it at: one that
   * does not wait makes the whole script land in microtasks, with no timers.
   */
  wait?: (ms: number) => Promise<void>
  /** Played as soon as the stream opens, so the screen is never empty. */
  opening?: Beat[]
  /** What a prompt Event is answered with. */
  answer?: (text: string) => Beat[]
}

export type ReplayTransport = {
  /** For `useAgentSession({ createEventSource })`. */
  createEventSource: AgentEventSourceFactory
  /** For `useAgentSession({ fetch })` — where a willed Event arrives. */
  fetch: AgentFetch
  /** The retained log, as the handler keeps it. Index is the `id:`. */
  log: Frame[]
  /** Resolves once nothing is being played. */
  quiet(): Promise<void>
}

export function replayTransport(options: ReplayOptions = {}): ReplayTransport {
  const wait = options.wait ?? sleep
  const opening = options.opening ?? OPENING
  const answer = options.answer ?? reply

  const log: Frame[] = []
  const listeners = new Map<string, ((event: { data: string; lastEventId: string }) => void)[]>()
  let started = false
  let playing: Promise<void> = Promise.resolve()
  /** Bumped by an interrupt, which is how a script in flight is cut short. */
  let epoch = 0

  const emit = (name: string, data: string, id: string): void => {
    for (const listener of listeners.get(name) ?? []) listener({ data, lastEventId: id })
  }

  const retain = (frame: Frame): void => {
    log.push(frame)
    emit('frame', JSON.stringify(frame), String(log.length - 1))
  }

  const play = async (beats: Beat[]): Promise<void> => {
    const mine = epoch
    for (const beat of beats) {
      await wait(beat.after ?? 0)
      // An interrupt landed while this beat was waiting. What the runtime was
      // about to say is not said, exactly as a real abort would have it.
      if (epoch !== mine) return
      if (beat.frame) retain(beat.frame)
      if (beat.partial) emit('partial', JSON.stringify(beat.partial), '')
    }
  }

  /** Queues a script behind whatever is already playing, and reports quiet. */
  const start = (beats: Beat[]): void => {
    playing = playing.then(() => play(beats))
  }

  const createEventSource: AgentEventSourceFactory = () => {
    const source: AgentEventSource = {
      addEventListener: (name, listener) => {
        const registered = listeners.get(name) ?? []
        registered.push(listener)
        listeners.set(name, registered)
      },
      close: () => listeners.clear(),
    }
    // A source the browser opens sends no `Last-Event-ID`, so the whole log
    // comes down it — which is what a cold reload gets, and what makes a
    // reload of the playground show the Session it already had.
    queueMicrotask(() => {
      for (const [index, frame] of log.entries()) {
        emit('frame', JSON.stringify(frame), String(index))
      }
      if (started) return
      started = true
      start(opening)
    })
    return source
  }

  const fetch: AgentFetch = async (_endpoint, init) => {
    const event = parse(init.body)
    if (event?.type === 'prompt' && typeof event.text === 'string') {
      // The person's words are retained first, so the Message the hook put on
      // screen optimistically is settled by a Frame rather than left beside
      // one — the same order the handler produces.
      const text = event.text
      start([{ frame: { kind: 'prompt', text } }, ...answer(text)])
      return { ok: true, status: 202 }
    }
    if (event?.type === 'interrupt') {
      epoch += 1
      // A stop the person asked for is not a failure. The handler retains an
      // interrupted Turn as settled and keeps `terminalReason`, so replay does
      // the same rather than inventing a failure nobody had.
      retain({ kind: 'settled', terminalReason: 'aborted_streaming' })
      return { ok: true, status: 202 }
    }
    return { ok: false, status: 400 }
  }

  return { createEventSource, fetch, log, quiet: () => playing }
}

function parse(body: string): { type?: string; text?: unknown } | undefined {
  try {
    return JSON.parse(body) as { type?: string; text?: unknown }
  } catch {
    return undefined
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- the script ------------------------------------------------------------------

/**
 * A block of prose arriving word by word, then the Frame the handler retains
 * once the block closes — the same two-step live mode makes, so what replay
 * shows of streaming is what live does.
 */
export function prose(text: string, options: { block?: number; thread?: string } = {}): Beat[] {
  const block = options.block ?? 0
  const thread = options.thread
  const words = text.split(' ')
  const beats: Beat[] = []
  let written = ''
  for (const word of words) {
    written = written === '' ? word : `${written} ${word}`
    beats.push({
      after: 34,
      partial: compact<PartialText>({ block, kind: 'text', text: written, thread }),
    })
  }
  beats.push({ partial: compact<PartialText>({ block, kind: 'text', text, done: true, thread }) })
  beats.push({ frame: compact<Frame>({ kind: 'text', text, thread }) })
  return beats
}

/** A tool call, the pause while it runs, and what it answered. */
export function tool(call: {
  id: string
  name: string
  input: Record<string, unknown>
  output: string
  failed?: boolean
  takes?: number
  /** The Thread that ran it; absent for the agent's own work. */
  thread?: string
}): Beat[] {
  return [
    {
      after: 260,
      frame: compact<Frame>({
        kind: 'tool-call',
        id: call.id,
        name: call.name,
        input: call.input,
        thread: call.thread,
      }),
    },
    {
      after: call.takes ?? 700,
      frame: compact<Frame>({
        kind: 'tool-result',
        id: call.id,
        output: call.output,
        isError: call.failed === true,
        thread: call.thread,
      }),
    },
  ]
}

/**
 * What the runtime advertises at `init`, described rather than merely named —
 * which is what `supportedCommands()` adds and what the menu is for. `/usage`
 * carries both an argument hint and aliases, because those are the two things a
 * bare name cannot say and the two a reviewer should be able to see.
 */
const COMMANDS: SlashCommandInfo[] = [
  { name: 'commit', description: 'Commit the working tree', argumentHint: '[message]' },
  { name: 'effort', description: 'Change how hard the model thinks', argumentHint: '<level>' },
  {
    name: 'usage',
    description: 'Show what this Session has spent',
    argumentHint: '[window]',
    aliases: ['cost', 'stats'],
  },
]

/**
 * The `Task` call that opens a Thread. Kept apart from `tool` because a Thread
 * is only interesting while it is open: the three run at once, so their calls
 * all stand pending while their work arrives, and each is answered by
 * `threadEnded` in its own time rather than paired with its own call.
 */
export function opensThread(open: {
  thread: string
  description: string
  subagentType: string
}): Beat {
  return {
    after: 200,
    frame: {
      kind: 'tool-call',
      id: open.thread,
      name: 'Task',
      input: {
        description: open.description,
        subagent_type: open.subagentType,
        prompt: `${open.description}, and report what you find`,
      },
      opens: {
        thread: open.thread,
        description: open.description,
        subagentType: open.subagentType,
      },
    },
  }
}

/** A Thread reporting back, which is what stops its meter. */
export function threadEnded(thread: string, report: string, failed = false): Beat {
  return {
    after: 600,
    frame: { kind: 'tool-result', id: thread, output: report, isError: failed },
  }
}

/**
 * The Thread case: three Threads open at once, their work arriving
 * interleaved, and each finishing in its own time.
 *
 * One Thread would demonstrate nothing. The whole trap is that three
 * background agents' tool calls land in the Transcript indistinguishable from
 * the main agent's — so the case has to be three of them, running over each
 * other, with the main agent still doing work of its own in the middle of it.
 * The third fails, because a Thread that came back empty-handed reading like
 * one that succeeded is the same lie in a smaller place.
 */
const THREE_THREADS: Beat[] = [
  { after: 900, frame: { kind: 'prompt', text: 'audit the three packages in parallel' } },
  ...prose('Opening a Thread per package.', { block: 7 }),
  opensThread({ thread: 'toolu_task_core', description: 'audit core', subagentType: 'Explore' }),
  opensThread({ thread: 'toolu_task_ui', description: 'audit ui', subagentType: 'Explore' }),
  opensThread({
    thread: 'toolu_task_server',
    description: 'audit server',
    subagentType: 'general-purpose',
  }),
  // A Thread saying what it is doing, which only arrives at all because the
  // handler asks for it (#19). Block 0 — the same index the main agent's own
  // prose uses, because the index counts blocks within a message and each
  // agent is writing its own. Two blocks share an index here and stay apart,
  // which is the thing that made forwarding safe to turn on.
  ...prose('Checking whether reduce touches a clock.', { block: 0, thread: 'toolu_task_core' }),
  // Interleaved on purpose: read down the Transcript and these four calls
  // arrive in an order no single agent could have produced.
  ...tool({
    id: 'toolu_core_read',
    name: 'Read',
    input: { file_path: '/repo/src/core/reduce.ts' },
    output: 'export function reduce(frames, options = {}) {',
    thread: 'toolu_task_core',
    takes: 500,
  }),
  ...tool({
    id: 'toolu_ui_grep',
    name: 'Grep',
    input: { pattern: '#[0-9a-f]{6}' },
    output: 'no matches',
    thread: 'toolu_task_ui',
    takes: 400,
  }),
  ...tool({
    id: 'toolu_server_bash',
    name: 'Bash',
    input: { command: 'bun test src/server' },
    output: '31 pass\n0 fail',
    thread: 'toolu_task_server',
    takes: 700,
  }),
  ...tool({
    id: 'toolu_core_grep',
    name: 'Grep',
    input: { pattern: 'Date.now' },
    output: 'no matches — core has no clock',
    thread: 'toolu_task_core',
    takes: 450,
  }),
  // Two windows reported in the same breath, and the whole of #17 on screen:
  // the Thread's 7.4k is drawn on the Thread's meter and the main agent's 186k
  // is not, where before either would have overwritten the other.
  { after: 200, frame: { kind: 'context', thread: 'toolu_task_core', totalTokens: 7400 } },
  { frame: { kind: 'context', totalTokens: 186000, maxTokens: 200000, percentage: 93 } },
  // The main agent is still working while they run, which is what makes
  // attribution worth anything: this line is nobody's Thread.
  ...prose('Two are back; the third is still reading.', { block: 8 }),
  threadEnded('toolu_task_ui', 'ui: no hardcoded hex left.'),
  threadEnded('toolu_task_core', 'core: pure, no clock, no socket.'),
  ...tool({
    id: 'toolu_server_read',
    name: 'Read',
    input: { file_path: '/repo/src/server/handler.ts' },
    output: 'Error: file was moved',
    failed: true,
    thread: 'toolu_task_server',
    takes: 600,
  }),
  threadEnded('toolu_task_server', 'server: could not finish — the handler moved.', true),
  ...prose('Two clean, one came back empty-handed.', { block: 9 }),
  { frame: { kind: 'settled', result: 'Two packages audited; the third could not finish.' } },
]

/**
 * The opening script. Scoped to what is drawn end to end — a replay log that
 * showed a surface nothing draws yet would be a demo of an absence — and each
 * ticket adds its own case as it earns one.
 *
 * The first Turn is prose and tool calls in all three of a tool's states. What
 * follows it is the divergences: the points where the Transcript reads exactly
 * the same before and after while what the agent can actually see has changed.
 * They are the hardest thing here to believe without seeing, because the
 * failure they exist to stop looks like nothing at all — so the playground
 * plays them rather than describing them. Last comes the Thread case, for the
 * failure that looks like nothing at all in the other direction: three
 * background agents' work landing in the Transcript as though the main agent
 * had done all of it.
 */
export const OPENING: Beat[] = [
  { frame: { kind: 'session', sessionId: 'replay-0001' } },
  {
    frame: {
      kind: 'harness',
      model: 'claude-opus-4',
      cwd: '/repo',
      permissionMode: 'bypassPermissions',
      version: '2.1.206',
      tools: ['Read', 'Edit', 'Bash'],
    },
  },
  {
    frame: {
      kind: 'commands',
      commands: COMMANDS,
    },
  },
  { after: 260, frame: { kind: 'prompt', text: 'the suite is flaky — find out why' } },
  ...prose('Reading the test first.'),
  ...tool({
    id: 'toolu_read',
    name: 'Read',
    input: { file_path: '/repo/src/core/reduce.test.ts' },
    output: "import { test } from 'bun:test'\n\ntest('reduce keeps order', () => {\n  …\n})",
    takes: 520,
  }),
  ...prose('It shells out for the fixture, so it depends on the clock. Running it.', {
    block: 1,
  }),
  ...tool({
    id: 'toolu_bash_1',
    name: 'Bash',
    input: { command: 'bun test src/core/reduce.test.ts' },
    output: '1 fail\nreduce keeps order — expected 3, got 2',
    failed: true,
    takes: 900,
  }),
  // The agent has worked its way into a subdirectory and the runtime has found
  // a skill there, so it pushes the whole list again — REPLACE semantics, which
  // is why everything that survives has to be restated. Scripted here rather
  // than only in a test, because "the menu updates mid-Session" is a claim a
  // reviewer should be able to watch happen.
  {
    frame: {
      kind: 'commands',
      commands: [
        ...COMMANDS,
        { name: 'flake', description: 'Re-run a test until it fails', argumentHint: '<test>' },
      ],
    },
  },
  ...prose('There it is. The fixture is regenerated per run; pinning it.', { block: 2 }),
  ...tool({
    id: 'toolu_edit',
    name: 'Edit',
    input: { file_path: '/repo/src/core/reduce.test.ts' },
    output: 'Applied 1 edit to /repo/src/core/reduce.test.ts',
    takes: 420,
  }),
  ...tool({
    id: 'toolu_bash_2',
    name: 'Bash',
    input: { command: 'bun test src/core/reduce.test.ts' },
    output: '3 pass\n0 fail',
    takes: 800,
  }),
  ...prose('Pinned, and the suite is green.', { block: 3 }),
  { frame: { kind: 'settled', result: 'Pinned the fixture; the suite is green.', turns: 1 } },
  { frame: { kind: 'cost', usd: 0.0412, turns: 1, durationMs: 8400 } },

  // --- the divergences ---------------------------------------------------------

  { after: 900, frame: { kind: 'prompt', text: 'now do the same across the whole suite' } },
  {
    after: 300,
    frame: {
      kind: 'recall',
      mode: 'select',
      memories: [
        { path: '/memories/testing.md', scope: 'team', content: 'Pin fixtures; never sleep.' },
      ],
    },
  },
  // A second recall that surfaced nothing. It draws nothing, and that is the
  // point of playing it: the silence a viewer sees here is the honest one, and
  // it is only distinguishable from a missing marker because the recall above
  // did draw.
  { frame: { kind: 'recall', mode: 'select', memories: [] } },
  {
    after: 240,
    frame: {
      kind: 'hook',
      id: 'hook-guard',
      name: 'block-secrets',
      hookEvent: 'PreToolUse',
      status: 'error',
      stderr: 'refused: .env is not readable',
      exitCode: 2,
    },
  },
  ...prose('Blocked on that one. Widening the search instead.', { block: 4 }),
  {
    after: 400,
    frame: {
      kind: 'compacted',
      trigger: 'auto',
      preTokens: 180000,
      postTokens: 42000,
      durationMs: 3100,
    },
  },
  ...prose('Working from the summary now.', { block: 5 }),
  {
    after: 300,
    frame: {
      kind: 'failed',
      subtype: 'error_max_turns',
      reason: 'Reached the maximum number of turns',
      turns: 40,
      durationMs: 90000,
      stopReason: 'max_turns',
      terminalReason: 'max_turns',
    },
  },
  // Memory gone rather than summarised — the harder loss, and the one that
  // must not read like the compaction two lines above it.
  { after: 700, frame: { kind: 'reset', transcriptId: 'conv-2' } },
  { after: 400, frame: { kind: 'prompt', text: 'start again from the failing test' } },
  ...prose('Fresh context. Reading the failing test.', { block: 6 }),
  { frame: { kind: 'settled', result: 'Read it.', turns: 1 } },

  // --- the Threads -------------------------------------------------------------

  ...THREE_THREADS,
]

/**
 * What a prompt typed into the replaying playground is answered with. It quotes
 * the words back, because the point being demonstrated is that the composer
 * reaches the runtime — not that the runtime is clever.
 */
export function reply(text: string): Beat[] {
  return [
    ...prose(`Replaying an answer to “${text}”. Nothing here talks to a model.`),
    ...tool({
      id: `toolu_replay_${counter()}`,
      name: 'Read',
      input: { file_path: '/repo/README.md' },
      output: '# claude-code-agent-sdk-ui\n\nThe layer between the SDK and a rendered UI.',
      takes: 600,
    }),
    ...prose('That is the whole of replay: a Frame log, played.', { block: 1 }),
    { frame: { kind: 'settled', result: 'Replayed.', turns: 1 } },
  ]
}

let replies = 0
/** Keeps two answers' tool calls from sharing a `tool_use` id. */
function counter(): number {
  replies += 1
  return replies
}

/** Drops keys whose value is missing, which `exactOptionalPropertyTypes` wants. */
function compact<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}
