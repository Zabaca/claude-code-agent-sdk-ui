import { expect, test } from 'bun:test'

import { createAgentHandler } from '../src/server/handler.ts'
import { liveRequested, sayHi } from './canary.ts'

/**
 * The live canary. It talks to a real agent, and it spends real money.
 *
 * Running it is a decision, never a side effect:
 *
 *   - it lives outside `src/`, so `bun test src` — the suite, and what CI runs
 *     — never loads it;
 *   - and it is skipped unless `LIVE_CANARY=1` is set, so `bun test` with no
 *     arguments does not run it either. Gating on the presence of a credential
 *     would not be enough: plenty of machines have `ANTHROPIC_API_KEY` exported
 *     for unrelated reasons, and on those the bill would arrive as a surprise.
 *
 * To run it deliberately:
 *
 *     LIVE_CANARY=1 bun run canary
 *
 * The credential itself comes from wherever the Agent SDK looks for one —
 * `ANTHROPIC_API_KEY`, or the Claude Code CLI's stored credential. This test
 * names none of that, which is the point: it asserts the integration, not the
 * authentication.
 *
 * What it is for: every other test in this repo stands in for the SDK with
 * `createQuery`. That is what makes them free, and it is also what makes them
 * blind to the SDK changing under a version bump — a renamed message type, a
 * `result` that stopped carrying `subtype`, a stream that no longer terminates.
 * This is the one test that would notice.
 */

test.skipIf(!liveRequested(process.env))(
  'a real Turn through the real SDK ends in a settled Frame',
  async () => {
    // Nothing is named but `cwd`: the handler's own defaults are what a host
    // gets (ADR-0003), and the canary should exercise those rather than a
    // configuration nobody ships with.
    const handler = createAgentHandler({ cwd: new URL('../', import.meta.url).pathname })

    const run = await sayHi(handler, { text: 'say hi', within: 120_000 })

    expect(run.settled.kind).toBe('settled')
    // A Turn that settles having said nothing is not the integration working.
    expect(run.said.length).toBeGreaterThan(0)
    // And the Session announced itself, which is where a Session id comes from.
    expect(run.frames.map((frame) => frame.kind)).toContain('session')

    console.log(`canary: the agent said ${JSON.stringify(run.said.slice(0, 120))}`)
  },
  180_000,
)
