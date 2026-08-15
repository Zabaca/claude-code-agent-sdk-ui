import { expect, test } from 'bun:test'

import type { ClassifyInput } from './core/classify.ts'
import { fakeQuery } from './server/fake.ts'
import { createAgentHandler } from './server/handler.ts'
import { liveRequested, sayHi } from '../test/canary.ts'

/**
 * The live canary's dress rehearsal, with the SDK stood in for.
 *
 * `test/live.canary.test.ts` costs money, so it is off by default — which makes
 * everything inside it code that nobody runs, and code nobody runs rots. The
 * drive it uses lives in `test/canary.ts` and is exercised here on every
 * `bun test src`, with no credential: if the SSE parsing, the prompt POST, the
 * settled-Frame reading or the failure paths break, this fails today rather
 * than the next time someone spends a dollar to find out.
 *
 * What this cannot rehearse is the SDK itself. That is exactly, and only, what
 * the live run adds.
 */

test('the canary drive reports a Turn that settled, and what was said', async () => {
  const fake = fakeQuery()
  const handler = createAgentHandler({ createQuery: fake.createQuery })

  const running = sayHi(handler, { text: 'say hi', within: 5_000 })
  await Promise.resolve()
  fake.say(init('sess-canary'))
  fake.say(says('Hi there'))
  fake.say(settled())

  const run = await running

  expect(run.settled.kind).toBe('settled')
  expect(run.said).toBe('Hi there')
  expect(run.frames.map((frame) => frame.kind)).toContain('session')
})

test('the canary drive raises a Turn that failed instead of reporting success', async () => {
  // The reading that matters: a `failed` Frame is an ending too, and a canary
  // that waited for `settled` while a failure went past would sit there until
  // the deadline and then report the wrong thing — "nothing arrived", when what
  // arrived was the runtime saying why it stopped.
  const fake = fakeQuery()
  const handler = createAgentHandler({ createQuery: fake.createQuery })

  const running = sayHi(handler, { text: 'say hi', within: 5_000 })
  await Promise.resolve()
  fake.say(init('sess-canary'))
  fake.say(broke())

  await expect(running).rejects.toThrow(/the Turn failed: .*credit balance/)
})

test('the canary drive gives up rather than hanging when nothing arrives', async () => {
  // The failure mode a live canary actually has: a stream that opens and then
  // says nothing. Without a deadline that is a hung CI job, not a red test.
  const fake = fakeQuery()
  const handler = createAgentHandler({ createQuery: fake.createQuery })

  await expect(sayHi(handler, { text: 'say hi', within: 250 })).rejects.toThrow(
    /no settled Frame within 250ms/,
  )
})

test('nothing but asking for it arms the live canary', async () => {
  // The gate, checked without obeying it. An environment that merely has a
  // credential in it must read as "no": that is the accident this is here to
  // make impossible, because a developer with `ANTHROPIC_API_KEY` exported for
  // other work would otherwise buy a Turn by typing `bun test`.
  expect(liveRequested({})).toBe(false)
  expect(liveRequested({ ANTHROPIC_API_KEY: 'sk-ant-whatever' })).toBe(false)
  expect(liveRequested({ CLAUDE_CODE_OAUTH_TOKEN: 'whatever' })).toBe(false)
  expect(liveRequested({ LIVE_CANARY: '0' })).toBe(false)
  expect(liveRequested({ LIVE_CANARY: 'true' })).toBe(false)
  expect(liveRequested({ LIVE_CANARY: '1' })).toBe(true)

  // And that the live test is actually wired to it. Reading the file is a weak
  // check and it is here for one strong reason: the assertion that cannot be
  // written is "run the canary and watch it skip", because a broken gate would
  // prove itself by spending money.
  const source = await Bun.file(`${import.meta.dir}/../test/live.canary.test.ts`).text()
  expect(source).toContain('test.skipIf(!liveRequested(process.env))(')

  // It also has to live where the suite cannot reach it: `bun test src`.
  expect(await Bun.file(`${import.meta.dir}/live.canary.test.ts`).exists()).toBe(false)
  const scripts = ((await Bun.file(`${import.meta.dir}/../package.json`).json()) as {
    scripts: Record<string, string>
  }).scripts
  // Named as a property rather than as a string, because the script grows a
  // directory whenever one is added and the thing that must stay true is not
  // its spelling: `bun test` with no target, or with `.` or `test` among them,
  // would walk into `test/` and arm the canary from an ordinary run.
  const targets = (scripts['test'] ?? '').replace(/^bun test/, '').trim().split(/\s+/)
  expect(targets.filter((one) => one !== '')).not.toHaveLength(0)
  expect(targets.filter((one) => one === '.' || one === 'test' || one.startsWith('test/'))).toEqual(
    [],
  )
  expect(scripts['canary']).toContain('LIVE_CANARY=1')
})

// --- what the runtime says ------------------------------------------------------

function init(sessionId: string): ClassifyInput {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-opus-4',
    cwd: '/work',
    permissionMode: 'bypassPermissions',
  }
}

function says(text: string): ClassifyInput {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }
}

function settled(): ClassifyInput {
  return { type: 'result', subtype: 'success', result: 'Hi there', num_turns: 1 }
}

/** What the runtime reports when the account cannot pay for the Turn. */
function broke(): ClassifyInput {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    num_turns: 1,
    errors: ['Your credit balance is too low'],
  }
}
