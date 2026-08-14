import type { Frame } from './frame.ts'
import type {
  Message,
  PromptMessage,
  TextMessage,
  ToolCallMessage,
  Transcript,
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
      default:
        break
    }
  }

  return { messages }
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
