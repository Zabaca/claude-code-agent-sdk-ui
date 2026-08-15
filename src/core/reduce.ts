import type { Frame } from './frame.ts'
import type {
  CompactedMessage,
  ContextUsage,
  HookMessage,
  ImageMessage,
  Message,
  OutcomeMessage,
  PromptMessage,
  ReasoningMessage,
  RecallMessage,
  TextMessage,
  ToolCallMessage,
  Transcript,
  Turn,
} from './transcript.ts'

/**
 * `reduce(Frame[]) → Transcript` — what is on screen now, from what happened.
 *
 * Pure: no clock, no socket, no runtime SDK import. Replaying the same Frame
 * log twice produces an identical Transcript, and the log itself is never
 * mutated — which is what lets an SSE reconnect replay from a Frame index.
 *
 * Every Frame kind lands somewhere. Prose, the person's words, tool calls,
 * images, compaction, reset, recall, hooks and how each Turn ended are
 * Messages; the Session id, the harness, the slash commands and the three
 * meters are Session-wide state, because they are the latest word on a fact
 * rather than an entry in the Transcript. Two things are held back, both on
 * purpose and both said again where they happen: the agent's deliberation,
 * unless `options.reasoning` asks for it, and a tool result's own Thread, which
 * is the Thread its call already names.
 */
export function reduce(frames: readonly Frame[], options: ReduceOptions = {}): Transcript {
  const messages: Message[] = []
  const state: SessionState = { commands: [] }
  /** Where each open call sits, so its answer patches it rather than appends. */
  const calls = new Map<string, number>()
  /** Where each identified hook sits, so its later Frames patch one Message. */
  const hooks = new Map<string, number>()
  /** Each Thread's own context window, kept off the Session's meter. */
  const threadContext: Record<string, ContextUsage> = {}
  let turn: Turn = { status: 'idle' }

  for (const frame of frames) {
    switch (frame.kind) {
      case 'text': {
        const tail = messages.at(-1)
        if (tail?.kind === 'text' && tail.thread === frame.thread) {
          messages[messages.length - 1] = { ...tail, text: tail.text + frame.text }
          break
        }
        messages.push(compact<TextMessage>({ kind: 'text', text: frame.text, thread: frame.thread }))
        break
      }
      case 'prompt':
        turn = { status: 'working' }
        messages.push(
          compact<PromptMessage>({
            kind: 'prompt',
            text: frame.text,
            thread: frame.thread,
            synthetic: frame.synthetic,
            origin: frame.origin,
          }),
        )
        break
      case 'tool-call':
        calls.set(frame.id, messages.length)
        messages.push(
          compact<ToolCallMessage>({
            kind: 'tool-call',
            id: frame.id,
            name: frame.name,
            input: frame.input,
            status: 'pending',
            thread: frame.thread,
            opens: frame.opens,
          }),
        )
        break
      case 'tool-progress': {
        // Patches the call it is about, exactly as a result does, and for the
        // same reason: progress is more said about one call, not a second
        // entry in the Transcript. A progress Frame whose call is absent has
        // nothing to attach to — a log truncated before the call — and is
        // dropped rather than conjuring one.
        const at = calls.get(frame.id)
        const call = at === undefined ? undefined : messages[at]
        if (at === undefined || call?.kind !== 'tool-call') break
        messages[at] = { ...call, elapsedSeconds: frame.elapsedSeconds }
        break
      }
      case 'tool-result': {
        const at = calls.get(frame.id)
        const call = at === undefined ? undefined : messages[at]
        // A result whose call is absent has no Message to attach to. It can
        // only reach here on a log truncated before the call — a resumed
        // stream — where there is nothing on screen for it to answer.
        if (at === undefined || call?.kind !== 'tool-call') break
        // The result's own `thread` is not copied across: an answer belongs to
        // the call it answers, and the call already names that Thread. Every
        // other field of the Frame lands on the Message.
        messages[at] = compact<ToolCallMessage>({
          ...call,
          status: frame.isError ? 'error' : 'success',
          output: frame.output,
          structured: frame.structured,
        })
        break
      }
      case 'reasoning': {
        // Kept out of the Transcript unless asked for: thinking is not an
        // answer. Nothing else in the Frame vocabulary is withheld.
        if (options.reasoning !== true) break
        const tail = messages.at(-1)
        if (tail?.kind === 'reasoning' && tail.thread === frame.thread) {
          messages[messages.length - 1] = { ...tail, text: tail.text + frame.text }
          break
        }
        messages.push(
          compact<ReasoningMessage>({ kind: 'reasoning', text: frame.text, thread: frame.thread }),
        )
        break
      }
      case 'session':
        state.sessionId = frame.sessionId
        break
      case 'harness': {
        const { kind, ...harness } = frame
        // A later init says more about the harness; it does not unsay the rest.
        state.harness = { ...state.harness, ...harness }
        break
      }
      case 'commands':
        state.commands = frame.commands
        break
      case 'context': {
        const { kind, ...context } = frame
        // Whose window this is decides which meter it lands on. A Thread's
        // reading written to the Session's meter is the screen reporting a
        // number that is not about the thing it is drawn next to (#17).
        if (context.thread === undefined) state.context = context
        else threadContext[context.thread] = context
        break
      }
      case 'rate-limit': {
        const { kind, ...rateLimit } = frame
        state.rateLimit = rateLimit
        break
      }
      case 'cost': {
        const { kind, ...cost } = frame
        state.cost = cost
        break
      }
      case 'image':
        messages.push(
          compact<ImageMessage>({
            kind: 'image',
            mediaType: frame.mediaType,
            data: frame.data,
            url: frame.url,
            toolCallId: frame.toolCallId,
            thread: frame.thread,
          }),
        )
        break
      case 'compacted':
        messages.push(
          compact<CompactedMessage>({
            kind: 'compacted',
            trigger: frame.trigger,
            preTokens: frame.preTokens,
            postTokens: frame.postTokens,
            durationMs: frame.durationMs,
          }),
        )
        break
      case 'reset':
        messages.push({ kind: 'reset', transcriptId: frame.transcriptId })
        break
      case 'recall':
        messages.push(
          compact<RecallMessage>({
            kind: 'recall',
            mode: frame.mode,
            memories: frame.memories,
          }),
        )
        break
      case 'hook': {
        const hook = compact<HookMessage>({
          kind: 'hook',
          id: frame.id,
          name: frame.name,
          hookEvent: frame.hookEvent,
          status: frame.status,
          output: frame.output,
          stdout: frame.stdout,
          stderr: frame.stderr,
          exitCode: frame.exitCode,
        })
        // One hook is one Message: later Frames say more about the same run.
        // A hook the runtime did not identify cannot be recognised again, so
        // each of its Frames stands on its own.
        const at = frame.id === undefined ? undefined : hooks.get(frame.id)
        if (at === undefined) {
          if (frame.id !== undefined) hooks.set(frame.id, messages.length)
          messages.push(hook)
          break
        }
        messages[at] = { ...(messages[at] as HookMessage), ...hook }
        break
      }
      case 'settled':
        turn = { status: 'idle' }
        messages.push(
          compact<OutcomeMessage>({
            kind: 'outcome',
            // An interrupt reaches the log as a settled Frame: the handler
            // retains it that way because a stop the person asked for is not a
            // failure, and emitting nothing would leave the working line
            // spinning for a Turn that had stopped. But `settled` on its own
            // would then say the Turn ran to the end, so the runtime's own
            // reason for stopping still decides which ending this is — the
            // same predicate the failed branch uses, which until now was wired
            // to only one of the two places a stop can arrive.
            outcome: interrupted(frame) ? 'interrupted' : 'settled',
            result: frame.result,
            turns: frame.turns,
            durationMs: frame.durationMs,
            stopReason: frame.stopReason,
            terminalReason: frame.terminalReason,
          }),
        )
        break
      case 'failed': {
        const stopped = interrupted(frame)
        turn = stopped
          ? { status: 'idle' }
          : compact<Turn>({ status: 'failed', subtype: frame.subtype, reason: frame.reason })
        messages.push(
          compact<OutcomeMessage>({
            kind: 'outcome',
            outcome: stopped ? 'interrupted' : 'failed',
            subtype: frame.subtype,
            // Said even for an interrupt: the runtime's account of the abort is
            // worth keeping. It is `turn` that stays clean, because an idle
            // Turn has no problem to report.
            reason: frame.reason,
            turns: frame.turns,
            durationMs: frame.durationMs,
            stopReason: frame.stopReason,
            terminalReason: frame.terminalReason,
          }),
        )
        break
      }
      default:
        // Unreachable. A Frame kind added to the vocabulary and left unhandled
        // fails this assignment at typecheck rather than falling through here
        // and reaching no viewer — which is how a kind once went missing.
        frame satisfies never
        break
    }
  }

  return { ...compact<SessionState>(state), messages, turn, threadContext }
}

/** What `reduce` reads besides the Frames. */
export type ReduceOptions = {
  /**
   * Put the agent's deliberation in the Transcript. Off by default, following
   * "thinking is not an answer" — turn it on to watch a prompt being debugged.
   */
  reasoning?: boolean
}

/**
 * The parts of a Transcript that are Session-wide facts, not Messages.
 * `threadContext` is built alongside rather than here, because it is always
 * present — an empty record is "no Thread reported a window", which a viewer
 * can read without a null check.
 */
type SessionState = Omit<Transcript, 'messages' | 'turn' | 'threadContext'>

/**
 * The runtime's two terminal reasons for an abort. A Turn that ends this way
 * was stopped because someone asked for it to stop, so it reduces to idle —
 * rendering it as an error would report a stop the person wanted as a problem
 * they have.
 */
const ABORTED = new Set(['aborted_streaming', 'aborted_tools'])

function interrupted(frame: { terminalReason?: string }): boolean {
  return frame.terminalReason !== undefined && ABORTED.has(frame.terminalReason)
}

/** Every property optional, so a Message can be built before it is complete. */
type Loose<T> = { [K in keyof T]: T[K] | undefined }

/** Drops keys whose value is missing, which `exactOptionalPropertyTypes` wants. */
function compact<T extends object>(value: Loose<T>): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}
