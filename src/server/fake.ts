import type { ClassifyInput } from '../core/classify.ts'
import type { AgentPromptMessage, AgentQuery, AgentQueryFactory, AgentQueryParams } from './handler.ts'

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

type Pushable<T> = AsyncIterable<T> & {
  push(item: T): void
  end(): void
  fail(error: unknown): void
}

/** A queue read as an async iterable — the shape streaming input takes. */
export function pushable<T>(): Pushable<T> {
  const items: T[] = []
  let wake: (() => void) | undefined
  let done = false
  let failure: { error: unknown } | undefined

  const stir = () => {
    const resume = wake
    wake = undefined
    resume?.()
  }

  return {
    push: (item) => {
      items.push(item)
      stir()
    },
    end: () => {
      done = true
      stir()
    },
    fail: (error) => {
      failure = { error }
      stir()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = items.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (failure) throw failure.error
        if (done) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
