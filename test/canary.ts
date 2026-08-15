import type { Frame, SettledFrame } from '../src/core/frame.ts'
import type { AgentHandler } from '../src/server/handler.ts'

/**
 * The canary's drive, kept apart from the canary itself.
 *
 * The live canary is the one test in this repo that costs money, so it is off
 * unless someone deliberately turns it on — which means the code inside it is
 * code nobody runs. Everything that could break without the SDK's help lives
 * here instead, and `src/canary.test.ts` rehearses it against the fake query on
 * every `bun test src`. What the live run adds is the SDK, and only the SDK.
 */

/**
 * Whether someone asked for the live run — the whole gate, as a function of the
 * environment so that it can be tested without being obeyed.
 *
 * Deliberately not "is a credential present". A machine with `ANTHROPIC_API_KEY`
 * exported for unrelated work is an ordinary machine, and on one of those a
 * credential-shaped gate turns `bun test` into a purchase. The only thing that
 * arms this is someone typing it.
 */
export function liveRequested(env: Record<string, string | undefined>): boolean {
  return env['LIVE_CANARY'] === '1'
}

export type CanaryRun = {
  /** Every Frame the handler streamed, in order. */
  frames: Frame[]
  /** The Frame that ended the Turn. */
  settled: SettledFrame
  /** What the agent actually said, joined. */
  said: string
}

/**
 * Sends one prompt through a handler and waits for the Turn to end.
 *
 * Throws rather than returning on the two endings that are not a settled Turn —
 * a `failed` Frame, and a stream that says nothing before the deadline — because
 * a canary that returns "nothing arrived" as data is a canary whose caller can
 * forget to look.
 */
export async function sayHi(
  handler: AgentHandler,
  { text = 'say hi', within = 120_000 }: { text?: string; within?: number } = {},
): Promise<CanaryRun> {
  const endpoint = 'http://localhost/agent'
  const stream = await handler(new Request(endpoint))
  const body = stream.body
  if (!body) throw new Error('the handler opened a stream with no body')

  const posted = await handler(
    new Request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', text }),
    }),
  )
  if (!posted.ok) throw new Error(`the handler refused the prompt: ${posted.status}`)

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const frames: Frame[] = []
  let buffered = ''
  const deadline = Date.now() + within

  try {
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) {
        throw new Error(
          `no settled Frame within ${within}ms; saw [${frames.map((f) => f.kind).join(', ')}]`,
        )
      }

      const read = await Promise.race([
        reader.read(),
        new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), left)),
      ])
      if (read === 'late') continue
      if (read.done) {
        throw new Error(`the stream ended with no settled Frame; saw [${kinds(frames)}]`)
      }

      buffered += decoder.decode(read.value, { stream: true })
      let split = buffered.indexOf('\n\n')
      while (split !== -1) {
        const frame = frameIn(buffered.slice(0, split))
        buffered = buffered.slice(split + 2)
        split = buffered.indexOf('\n\n')
        if (!frame) continue
        frames.push(frame)

        if (frame.kind === 'failed') {
          throw new Error(`the Turn failed: ${frame.reason ?? 'no reason given'}`)
        }
        if (frame.kind === 'settled') {
          return { frames, settled: frame, said: said(frames) }
        }
      }
    }
  } finally {
    await reader.cancel()
  }
}

function kinds(frames: Frame[]): string {
  return frames.map((frame) => frame.kind).join(', ')
}

/** The words on screen, which is what "the agent answered" actually means. */
function said(frames: Frame[]): string {
  return frames
    .filter((frame) => frame.kind === 'text')
    .map((frame) => frame.text)
    .join('')
}

/** One SSE event, as the Frame it carried — `partial` events are not Frames. */
function frameIn(raw: string): Frame | undefined {
  let name = 'message'
  let data = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (name !== 'frame' || data === '') return undefined
  return JSON.parse(data) as Frame
}
