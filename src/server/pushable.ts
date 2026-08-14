/**
 * A queue read as an async iterable — the shape the SDK's streaming input
 * takes, and the shape a fake query yields its messages through.
 */
export type Pushable<T> = AsyncIterable<T> & {
  push(item: T): void
  /** Nothing more is coming: the iterable returns. */
  end(): void
  /** Nothing more is coming, and the reader learns why: the iterable throws. */
  fail(error: unknown): void
}

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
