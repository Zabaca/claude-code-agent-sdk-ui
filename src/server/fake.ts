import type { ClassifyInput } from '../core/classify.ts'
import type {
  AgentContextUsage,
  AgentPromptMessage,
  AgentQuery,
  AgentQueryFactory,
  AgentQueryParams,
  AgentSlashCommand,
  AgentUsage,
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
  /** How many times `supportedCommands()` was asked, and never answered twice. */
  describeCalls: number
  /**
   * Answers whatever `supportedCommands()` is outstanding — and answers it
   * where the runtime answers it: **on the message stream**, behind everything
   * already queued on it.
   *
   * That is the whole hazard, made reproducible. The reply is only delivered
   * once the reader pulls it, so a handler that awaits `supportedCommands()`
   * from inside its own message loop stops pulling, never reaches this reply,
   * and waits forever for something only it can deliver. Answering out of band
   * would make the fake unable to fail on the defect it exists to catch.
   */
  describes(commands: AgentSlashCommand[]): void
  /** Answers it by throwing, as a runtime that could not describe itself does. */
  describeBreaks(error: unknown): void
  /** How many times the meters were asked for. */
  meterCalls: number
  /**
   * Answers whatever meter questions are outstanding, on the message stream —
   * for the reason `describes` answers there. Both readings are control
   * requests, so both are behind the messages already queued, and a handler
   * that awaited either from inside its own loop would deadlock on it.
   */
  meters(context: AgentContextUsage, usage: AgentUsage): void
}

/** A control reply riding the message stream. Never yielded as a Message. */
type Reply = { answer(): void }

export function fakeQuery(): FakeQuery {
  const stream = pushable<ClassifyInput | Reply>()
  let asked: ((commands: AgentSlashCommand[]) => void)[] = []
  let refused: ((error: unknown) => void)[] = []
  let context: ((usage: AgentContextUsage) => void)[] = []
  let limits: ((usage: AgentUsage) => void)[] = []

  /** Everything on the stream except the control replies, which are consumed. */
  async function* messages(): AsyncGenerator<ClassifyInput> {
    for await (const item of stream) {
      if (isReply(item)) {
        item.answer()
        continue
      }
      yield item
    }
  }

  const fake: FakeQuery = {
    calls: [],
    prompts: [],
    interrupts: 0,
    describeCalls: 0,
    meterCalls: 0,
    say: (message) => stream.push(message),
    end: () => stream.end(),
    break: (error) => stream.fail(error),
    describes: (commands) => {
      stream.push({
        answer: () => {
          const waiting = asked
          asked = []
          refused = []
          for (const resolve of waiting) resolve(commands)
        },
      })
    },
    describeBreaks: (error) => {
      stream.push({
        answer: () => {
          const waiting = refused
          asked = []
          refused = []
          for (const reject of waiting) reject(error)
        },
      })
    },
    meters: (usage, limit) => {
      stream.push({
        answer: () => {
          const [windows, subscriptions] = [context, limits]
          context = []
          limits = []
          for (const resolve of windows) resolve(usage)
          for (const resolve of subscriptions) resolve(limit)
        },
      })
    },
    createQuery: (params) => {
      fake.calls.push(params)
      void collect(params.prompt, fake.prompts)
      const query: AgentQuery = {
        [Symbol.asyncIterator]: () => messages(),
        interrupt: async () => {
          fake.interrupts += 1
          fake.onInterrupt?.(fake)
        },
        close: () => stream.end(),
        supportedCommands: () => {
          fake.describeCalls += 1
          return new Promise<AgentSlashCommand[]>((resolve, reject) => {
            asked.push(resolve)
            refused.push(reject)
          })
        },
        getContextUsage: () => {
          fake.meterCalls += 1
          return new Promise<AgentContextUsage>((resolve) => context.push(resolve))
        },
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          new Promise<AgentUsage>((resolve) => limits.push(resolve)),
      }
      return query
    },
  }

  return fake
}

function isReply(item: ClassifyInput | Reply): item is Reply {
  return typeof (item as Reply).answer === 'function'
}

async function collect(prompt: AsyncIterable<AgentPromptMessage>, into: AgentPromptMessage[]) {
  for await (const message of prompt) into.push(message)
}
