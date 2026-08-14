import type { ClassifyInput } from '../core/classify.ts'
import type {
  AgentPromptMessage,
  AgentQuery,
  AgentQueryFactory,
  AgentQueryParams,
} from './handler.ts'
import { pushable } from './pushable.ts'

/**
 * A stand-in for the SDK's `query()`, so the `Request → Response` seam can be
 * driven end to end with no credential and no network. This is the reason
 * `createAgentHandler` takes a `createQuery` at all.
 */
export type FakeQuery = {
  /** Hands the factory to `createAgentHandler({ createQuery })`. */
  createQuery: AgentQueryFactory
  /** Every `query()` the handler asked for, with the options it asked with. */
  calls: AgentQueryParams[]
  /** The prompts the handler pushed into the input stream. */
  prompts: AgentPromptMessage[]
  /** Yields one SDK message to the handler. */
  say(message: ClassifyInput): void
  /** Ends the message stream, as a query that ran out of work does. */
  end(): void
  /** Ends the message stream by throwing, as a broken query does. */
  break(error: unknown): void
  /** How many times `interrupt()` was called. */
  interrupts: number
  /** What `interrupt()` does; by default it says nothing and waits. */
  onInterrupt?: (fake: FakeQuery) => void
}

export function fakeQuery(): FakeQuery {
  const messages = pushable<ClassifyInput>()

  const fake: FakeQuery = {
    calls: [],
    prompts: [],
    interrupts: 0,
    say: (message) => messages.push(message),
    end: () => messages.end(),
    break: (error) => messages.fail(error),
    createQuery: (params) => {
      fake.calls.push(params)
      void collect(params.prompt, fake.prompts)
      const query: AgentQuery = {
        [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
        interrupt: async () => {
          fake.interrupts += 1
          fake.onInterrupt?.(fake)
        },
        close: () => messages.end(),
      }
      return query
    },
  }

  return fake
}

async function collect(prompt: AsyncIterable<AgentPromptMessage>, into: AgentPromptMessage[]) {
  for await (const message of prompt) into.push(message)
}
