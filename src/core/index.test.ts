import { expect, test } from 'bun:test'
import { relative } from 'node:path'

import { bareSpecifiersIn, reachableFrom } from '../../test/imports.ts'

/**
 * What `core` costs to import.
 *
 * The promise the whole design rests on is that `classify` and `reduce` are
 * pure: no SDK at run time, no clock, no socket, so a recorded Frame log
 * replays through them with no credential and a browser bundle that only wants
 * the reducer does not swallow an agent runtime.
 *
 * `react/session.test.tsx` has guarded its own entry point since ticket #6, and
 * it looked like it covered this one too — it walks into `core` and asserts no
 * file it reaches mentions the SDK. It does not: it only ever reaches the four
 * `core` modules that `react` happens to import, and `core/index.ts` is not one
 * of them. The module it never reaches is `classify.ts`, which is the one
 * module in `core` that names the SDK at all. The guard that reads as covering
 * `core` is the guard that stops one import short of the only file that could
 * fail it.
 */

const dir = import.meta.dir

test('core names the SDK in types only, and ships none of it', async () => {
  // The distinction that matters is not "does the string appear" — it does, in
  // `classify.ts`, and it should, because `classify(SDKMessage)` is the whole
  // contract. It is whether anything survives compilation. So this asks the
  // compiler: bundle the entry point, keep the SDK external so a real import
  // would still be named in the output, and look.
  const built = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    target: 'node',
    external: ['@anthropic-ai/claude-agent-sdk'],
  })
  expect(built.success).toBe(true)

  const code = await (built.outputs[0] as { text(): Promise<string> }).text()
  expect(code).not.toContain('@anthropic-ai/claude-agent-sdk')
  // A bundle of nothing would also contain no SDK.
  expect(code).toContain('classify')
  expect(code).toContain('reduce')
})

test('core reaches nothing outside core', async () => {
  // Purity stated the other way round: the entry point's own import graph. A
  // `core` that reached `server` would import the handler's SDK types; one that
  // reached `ui` or `react` would need React to classify a message.
  const reached = await reachableFrom(`${dir}/index.ts`)

  const outside = [...reached]
    .map((path) => relative(`${dir}/..`, path))
    .filter((path) => !path.startsWith('core/'))
    .sort()

  expect(outside).toEqual([])
  // Every module in `core` bar the fixtures, so this is the whole surface and
  // not the first file that happened to import nothing.
  expect(reached.size).toBe(9)
})

test('core imports no runtime at all — no react, no bun, no node', async () => {
  // The other half of "no clock and no socket": `core` is meant to run in a
  // browser, in a test, and in a server process alike, so anything it reaches
  // for beyond the language is a dependency a consumer did not ask for.
  const reached = await reachableFrom(`${dir}/index.ts`)

  const imported: string[] = []
  for (const path of reached) {
    const source = await Bun.file(path).text()
    for (const specifier of bareSpecifiersIn(source)) {
      imported.push(`${relative(dir, path)} → ${specifier}`)
    }
    expect(source).not.toContain('Bun.')
    expect(source).not.toContain('Date.now()')
  }

  // The SDK is the one name `core` may say, and only `classify` may say it:
  // `classify(SDKMessage) → Frame[]` is the contract, and the test above is
  // what holds it to types.
  expect(imported).toEqual(['classify.ts → @anthropic-ai/claude-agent-sdk'])
})
