import type { FailedFrame, Frame } from './frame.ts'
import type {
  CompactedMessage,
  HookMessage,
  ImageMessage,
  Message,
  OutcomeMessage,
  PromptMessage,
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
 * mutated.
 */
export function reduce(frames: readonly Frame[]): Transcript {
  const messages: Message[] = []
  /** Where each open call sits, so its answer patches it rather than appends. */
  const calls = new Map<string, number>()
  /** Where each identified hook sits, so its later Frames patch one Message. */
  const hooks = new Map<string, number>()
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
      case 'tool-result': {
        const at = calls.get(frame.id)
        const call = at === undefined ? undefined : messages[at]
        // A result whose call is absent has no Message to attach to. It can
        // only reach here on a log truncated before the call — a resumed
        // stream — where there is nothing on screen for it to answer.
        if (at === undefined || call?.kind !== 'tool-call') break
        messages[at] = compact<ToolCallMessage>({
          ...call,
          status: frame.isError ? 'error' : 'success',
          output: frame.output,
          structured: frame.structured,
        })
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
            outcome: 'settled',
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
            reason: stopped ? undefined : frame.reason,
            turns: frame.turns,
            durationMs: frame.durationMs,
            stopReason: frame.stopReason,
            terminalReason: frame.terminalReason,
          }),
        )
        break
      }
      default:
        break
    }
  }

  return { messages, turn }
}

/**
 * The runtime's two terminal reasons for an abort. A Turn that ends this way
 * was stopped because someone asked for it to stop, so it reduces to idle —
 * rendering it as an error would report a stop the person wanted as a problem
 * they have.
 */
const ABORTED = new Set(['aborted_streaming', 'aborted_tools'])

function interrupted(frame: FailedFrame): boolean {
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
