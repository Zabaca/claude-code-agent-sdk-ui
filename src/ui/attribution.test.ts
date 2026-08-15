import { expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

/**
 * The components under `src/ui/` are someone else's work, taken under MIT and
 * changed. The licence asks for the notice; keeping it accurate is what makes
 * re-syncing with upstream possible at all — a file that does not say which
 * commit it came from cannot be diffed against a newer one, and a file that
 * does not list what was changed locally cannot be re-vendored without silently
 * throwing those changes away.
 *
 * Attribution is exactly the kind of thing that is true on the day it is
 * written and quietly false a ticket later, because nothing executes it. This
 * does.
 */

const dir = import.meta.dir
const root = `${dir}/../..`

/** The upstream commit every vendored file was taken from. */
const UPSTREAM = '4c5d5ab65ff6cfa8dbb6f27cb8c88d9092a48deb'

/** Every vendored component: named for what upstream calls it, not listed here. */
async function vendored(): Promise<string[]> {
  const files = (await readdir(dir)).filter(
    (name) => name.startsWith('claude-') && name.endsWith('.tsx') && !name.includes('.test.'),
  )
  // A glob that matched nothing would make every assertion below vacuous.
  expect(files.length).toBeGreaterThan(6)
  return files.sort()
}

test('every vendored component records where it came from', async () => {
  for (const name of await vendored()) {
    const header = (await Bun.file(`${dir}/${name}`).text()).slice(0, 2500)

    expect(header).toContain('Vendored from Brainless')
    expect(header).toContain('https://github.com/theswerd/brainless')
    expect(header).toContain('(MIT)')
    // The upstream path, so the diff can be found without guessing at it.
    expect(header).toContain(`Upstream file: registry/brainless/claude/${name}`)
    expect(header).toContain(`Upstream commit: ${UPSTREAM}`)
  }
})

test('every vendored component says what was changed in it', async () => {
  // Not one file here is unmodified — the prefix alone rewrote every class
  // name — so a header with no local changes listed is a header that stopped
  // being maintained.
  for (const name of await vendored()) {
    const header = (await Bun.file(`${dir}/${name}`).text()).slice(0, 2500)
    const changes = header.split('Local changes:')[1] ?? ''
    const bullets = changes.split('\n').filter((line) => /^\s*\*\s+- /.test(line))

    expect(`${name}: ${bullets.length} local changes listed`).not.toBe(`${name}: 0 local changes listed`)
  }
})

test('the components changed during v0.1 say what changed in them', async () => {
  // Two files were edited after they were vendored, for reasons that are not
  // visible in a diff against upstream unless the header says so. Named
  // individually because a generic "has bullets" check cannot tell that a file
  // grew a behaviour its header never mentioned.
  const prompt = await Bun.file(`${dir}/claude-prompt.tsx`).text()
  // The callbacks that turned a drawing into a composer.
  expect(prompt.slice(0, 2500)).toContain('onSubmit')
  // The control chrome: real form controls in a stylesheet that ships no
  // Preflight, each neutralising the user agent on itself.
  expect(prompt.slice(0, 2500)).toMatch(/neutralise the user agent's (button|control)|user\s*\n\s*\*\s*agent's (button|control)/)
  // The field is a textarea, so shift+Enter opens a line — not an input.
  expect(prompt.slice(0, 2500)).toContain('textarea')

  const thinking = await Bun.file(`${dir}/claude-thinking.tsx`).text()
  // Tokens are drawn from a prop rather than upstream's invented `secs * 137`.
  expect(thinking.slice(0, 2500)).toContain('showTokens')
  expect(thinking.slice(0, 2500)).toContain('secs * 137')
  // And elapsed resets between Turns.
  expect(thinking.slice(0, 2500)).toContain('elapsed')
})

test('the LICENSE carries the Brainless notice', async () => {
  const licence = await Bun.file(`${root}/LICENSE`).text()

  expect(licence).toContain('MIT License')
  expect(licence).toContain('Copyright (c) 2026 Zabaca')
  expect(licence).toContain('Third-party notices')
  expect(licence).toContain('Brainless')
  expect(licence).toContain('Ben Swerdlow')
  expect(licence).toContain('https://github.com/theswerd/brainless')
  // Upstream's own copyright line, which is the part the licence requires.
  expect(licence).toContain('Copyright (c) Ben Swerdlow')

  // And it travels: the notice is worth nothing if it stays in the repo.
  const { files } = (await Bun.file(`${root}/package.json`).json()) as { files: string[] }
  expect(files).toContain('LICENSE')
})

test('the shipped build carries the attribution too', async () => {
  // `dist/` is what a consumer receives, and `tsc` keeps leading comments — so
  // the provenance travels with the code rather than only with the sources.
  // Built on demand: `dist/` is a build artefact and is not committed.
  const built = `${root}/dist/ui/claude-prompt.js`
  if (!(await Bun.file(built).exists())) {
    const build = Bun.spawnSync(['bun', 'run', 'build:js'], { cwd: root })
    if (build.exitCode !== 0) throw new Error(`build:js failed: ${build.stderr.toString()}`)
  }

  const shipped = await Bun.file(built).text()
  expect(shipped).toContain('Vendored from Brainless')
  expect(shipped).toContain(UPSTREAM)
}, 120_000)
