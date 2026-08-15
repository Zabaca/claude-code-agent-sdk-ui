import { afterAll, beforeAll, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { installPacked, type Consumer } from '../test/consumer.ts'
import { reachableFrom } from '../test/imports.ts'

/**
 * What a consumer actually receives.
 *
 * The package installed cleanly and failed on the first import for the whole of
 * v0.1: `files` listed `dist`, and every entry point in `exports` pointed into
 * `src/`, which was not in the tarball. Every test in the suite passed the
 * entire time, because every one of them reads the working tree — where those
 * files obviously exist. So these tests leave the tree: `npm pack`, extract into
 * a project somewhere else on disk, and import by package specifier, which is
 * the only reading of "it installs and works" that is evidence rather than
 * assertion.
 *
 * `npm pack` runs `prepack`, so the `dist/` under test is built by the same
 * step `npm publish` would run. No registry is contacted.
 */

const root = new URL('../', import.meta.url).pathname

let consumer: Consumer

beforeAll(async () => {
  consumer = await installPacked()
})

afterAll(async () => {
  await consumer?.remove()
})

type Manifest = { exports: Record<string, string | Record<string, string>> }

/** Every file `exports` names, flattened across its condition objects. */
async function targets(): Promise<Record<string, string[]>> {
  const { exports } = (await Bun.file(`${root}package.json`).json()) as Manifest
  return Object.fromEntries(
    Object.entries(exports).map(([name, target]) => [
      name,
      (typeof target === 'string' ? [target] : Object.values(target)).map((path) =>
        path.replace(/^\.\//, ''),
      ),
    ]),
  )
}

test('every entry point in `exports` is a file the tarball contains', async () => {
  // The defect itself, stated as a test: five export targets, one of which
  // shipped. A consumer reaching for any of the other four got
  // ERR_MODULE_NOT_FOUND on the import the README opens with.
  const named = await targets()
  expect(Object.keys(named).sort()).toEqual([
    './core',
    './react',
    './server',
    './styles.css',
    './ui',
  ])

  const missing = Object.entries(named).flatMap(([name, paths]) =>
    paths.filter((path) => !consumer.ships.has(path)).map((path) => `${name} → ${path}`),
  )
  expect(missing).toEqual([])
}, 180_000)

test('every module the entry points import is in the tarball too', async () => {
  // An entry point that ships while something it imports does not is the same
  // failure one import deeper — and it is the failure a build exclusion causes,
  // since `tsconfig.build.json` deliberately leaves the tests and the
  // playground out of `dist`. Walked from the built entry points, JavaScript
  // and declarations both: a `.d.ts` that references a file which did not ship
  // breaks a consumer's typecheck rather than their runtime, which is quieter
  // and no less broken.
  const named = await targets()
  const entries = Object.values(named)
    .flat()
    .filter((path) => path.endsWith('.js') || path.endsWith('.d.ts'))
  expect(entries.length).toBe(8)

  const reached = new Set<string>()
  for (const entry of entries) {
    for (const path of await reachableFrom(resolve(root, entry))) {
      reached.add(relative(root, path))
    }
  }

  // A walk that found the four entry points and stopped is a walk that proves
  // nothing, and it is what a specifier regex that matches nothing produces.
  expect(reached.size).toBeGreaterThan(20)
  expect([...reached].filter((path) => !consumer.ships.has(path)).sort()).toEqual([])
}, 180_000)

test('the tarball ships the build and nothing from the workbench', async () => {
  const ships = [...consumer.ships].sort()

  expect(ships.filter((path) => /\.test\.[jt]sx?$/.test(path))).toEqual([])
  expect(ships.filter((path) => path.startsWith('src/'))).toEqual([])
  expect(ships.filter((path) => path.includes('playground'))).toEqual([])
  expect(ships).toContain('dist/styles.css')
  expect(ships).toContain('README.md')
  expect(ships).toContain('LICENSE')
}, 180_000)

test('a fresh project imports all four entry points and runs a Session', async () => {
  // The acceptance criterion, executed rather than described. Everything below
  // resolves through the export map from a directory that has never heard of
  // this repo, with the SDK never imported: the handler is driven through its
  // documented `createQuery` seam, so this costs no credential.
  await consumer.write(
    'consume.tsx',
    `
    import { classify, reduce } from '@zabaca/claude-code-agent-sdk-ui/core'
    import { useAgentSession } from '@zabaca/claude-code-agent-sdk-ui/react'
    import { createAgentHandler } from '@zabaca/claude-code-agent-sdk-ui/server'
    import { ClaudeSession, ClaudeToolCall } from '@zabaca/claude-code-agent-sdk-ui/ui'
    import { renderToStaticMarkup } from 'react-dom/server'

    const said = [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-4', cwd: '/w' },
      { type: 'assistant', parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } },
      { type: 'result', subtype: 'success', result: 'hi there', num_turns: 1 },
    ]

    // core: fixture messages in, a Transcript out.
    const frames = said.flatMap((message) => classify(message))
    const transcript = reduce(frames)
    if (!frames.some((frame) => frame.kind === 'settled')) throw new Error('no settled Frame')
    if (!JSON.stringify(transcript).includes('hi there')) throw new Error('no words on screen')

    // server: a real handler, a real POST, a real SSE stream.
    const handler = createAgentHandler({
      createQuery: () => ({
        async *[Symbol.asyncIterator]() {
          for (const message of said) yield message
          await new Promise(() => {})
        },
        interrupt: async () => {},
        supportedCommands: async () => [],
      }),
    })
    const stream = await handler(new Request('http://localhost/api/agent'))
    if (stream.headers.get('content-type') !== 'text/event-stream') throw new Error('not SSE')
    await handler(new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', text: 'say hi' }),
    }))

    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let settled = false
    const deadline = Date.now() + 10_000
    while (!settled && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const line of buffer.split('\\n')) {
        if (!line.startsWith('data:')) continue
        if (JSON.parse(line.slice(5).trim()).kind === 'settled') settled = true
      }
    }
    await reader.cancel()
    if (!settled) throw new Error('the handler streamed no settled Frame')

    // react + ui: the two imports the README opens with, on a page.
    function App() {
      const session = useAgentSession({ endpoint: '/api/agent' })
      return <ClaudeSession session={session} placeholder="ask the agent" />
    }
    const html = renderToStaticMarkup(<App />)
    if (!html.includes('ask the agent')) throw new Error('the Session drew nothing')
    if (!renderToStaticMarkup(<ClaudeToolCall tool="Read" arg="p.json" result="ok" />).includes('Read')) {
      throw new Error('a component on its own drew nothing')
    }

    // the stylesheet, resolved through the same export map.
    const css = await Bun.file(
      Bun.resolveSync('@zabaca/claude-code-agent-sdk-ui/styles.css', import.meta.dir),
    ).text()
    if (!css.includes('--cc-')) throw new Error('the stylesheet is not the stylesheet')

    console.log('CONSUMER OK')
    `,
  )

  const ran = consumer.run(['bun', 'run', 'consume.tsx'])
  expect(`${ran.stdout}${ran.stderr}`).toContain('CONSUMER OK')
  expect(ran.code).toBe(0)
}, 180_000)

test("a fresh project's own typecheck passes against the shipped types", async () => {
  // Shipping the TypeScript sources was the simpler fix and it was tried first:
  // it runs fine, and then every consumer with a `tsc` gets twenty errors
  // inside their own `node_modules` — `TS5097: An import path can only end with
  // a '.ts' extension when 'allowImportingTsExtensions' is enabled` — for files
  // they did not write and cannot edit. That is why `dist/` carries declarations
  // instead, and this is the test that says so: an ordinary consumer tsconfig,
  // no flags of ours in it.
  await consumer.write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        target: 'ESNext',
        module: 'Preserve',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['app.tsx'],
    }),
  )
  await consumer.write(
    'app.tsx',
    `
    import { classify, reduce, type Frame } from '@zabaca/claude-code-agent-sdk-ui/core'
    import { useAgentSession } from '@zabaca/claude-code-agent-sdk-ui/react'
    import { createAgentHandler } from '@zabaca/claude-code-agent-sdk-ui/server'
    import { ClaudeSession } from '@zabaca/claude-code-agent-sdk-ui/ui'

    export const agent = createAgentHandler({ cwd: '.' })
    export function App() {
      const session = useAgentSession({ endpoint: '/api/agent' })
      return <ClaudeSession session={session} />
    }
    export const roundTrip = (frames: Frame[]) => reduce(frames)
    export { classify }
    `,
  )

  const ran = consumer.run(['./node_modules/typescript/bin/tsc', '--noEmit'])
  expect(`${ran.stdout}${ran.stderr}`.trim()).toBe('')
  expect(ran.code).toBe(0)
}, 180_000)

test('the shipped core loads no SDK, and the shipped server loads it lazily', async () => {
  // Both claims are made about the build a consumer installs rather than about
  // the sources, because the sources are allowed to name the SDK — in types,
  // which compile away — and only the emitted JavaScript can say whether they
  // did. `src/core/index.test.ts` holds the same line one layer earlier.
  const sdk = '@anthropic-ai/claude-agent-sdk'
  const dist = join(consumer.dir, 'node_modules/@zabaca/claude-code-agent-sdk-ui/dist')

  for (const file of await readdir(join(dist, 'core'))) {
    if (!file.endsWith('.js')) continue
    expect(await Bun.file(join(dist, 'core', file)).text()).not.toContain(sdk)
  }

  // The handler names it exactly once, inside an `await import(…)`, so
  // constructing a handler costs no credential and no module load.
  const handler = await Bun.file(join(dist, 'server/handler.js')).text()
  expect(handler.match(new RegExp(sdk, 'g'))?.length).toBe(1)
  expect(handler).toMatch(new RegExp(`await import\\(['"]${sdk}['"]\\)`))
  expect(handler).not.toMatch(new RegExp(`^import .*${sdk}`, 'm'))
}, 180_000)

test('the README the tarball carries names every entry point it ships', async () => {
  // The criterion is a working Session "following the README alone", and the
  // README travels inside the tarball.
  const named = await targets()
  const readme = await Bun.file(`${root}README.md`).text()
  for (const name of Object.keys(named)) {
    expect(readme).toContain(`@zabaca/claude-code-agent-sdk-ui/${name.slice(2)}`)
  }
}, 180_000)
