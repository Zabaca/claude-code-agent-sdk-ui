import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * **A hook that does real work has to declare how long it may take.**
 *
 * bun's default timeout for a lifecycle hook is 5000ms, and it is the right
 * default for a hook that assigns a variable. It is the wrong one for a hook
 * that spawns a build — and the failure is disproportionate, because a hook
 * that times out takes **every test in its file** with it and reports a single
 * `(fail) (unnamed)` with no name to look up.
 *
 * That is not hypothetical. `agent-lab/31`: `package.test.ts`'s `beforeAll`
 * calls `installPacked`, which runs `npm pack` → `prepack` → a full TypeScript
 * and Tailwind build. Measured at **1695ms** on a quiet box, against a 5000ms
 * default — a margin of 2.9x, which a contended box crosses. Its eight tests
 * vanished from four separate runs, twice taking a mutation batch's *control*
 * with them, and the arithmetic never quite added up because the suite reported
 * seven fewer rather than eight: the hook failure is itself counted as one.
 *
 * The tell was that **every test in that file already declared `180_000`**. The
 * author knew the work was slow and gave three minutes to the cheap half; the
 * expensive half kept the default nobody had thought about.
 *
 * So this is a source-shape guard and not a timing assertion — a timing
 * assertion would itself be load-sensitive, which is the disease. It asks only:
 * if a hook reaches for something that spawns a process, does it say how long
 * it may take?
 */
const SRC = join(import.meta.dir)

/** What makes a hook expensive: it starts a process, directly or through one of
 *  the helpers that does. */
const SPAWNS = /installPacked|buildStylesheet|buildPackage|packageCopy|spawnSync|Bun\.spawn/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/** Each `beforeAll(`/`afterAll(` in a file, with its body and its closing call. */
function hooksIn(source: string): { hook: string; body: string; closer: string }[] {
  const found: { hook: string; body: string; closer: string }[] = []
  for (const match of source.matchAll(/\b(beforeAll|afterAll)\(/g)) {
    const open = source.indexOf('{', match.index)
    if (open === -1) continue
    let depth = 1
    let at = open + 1
    while (at < source.length && depth > 0) {
      if (source[at] === '{') depth += 1
      else if (source[at] === '}') depth -= 1
      at += 1
    }
    found.push({
      hook: match[1] ?? '',
      body: source.slice(open, at),
      // Everything up to the end of the hook call: `})` or `}, 180_000)`.
      closer: source.slice(at - 1, source.indexOf(')', at) + 1),
    })
  }
  return found
}

describe('a hook that spawns declares its own timeout', () => {
  const files = sourceFiles(SRC)

  test('there are hooks to check, so this cannot pass by finding none', () => {
    // The control. A walker that matched nothing would satisfy every assertion
    // below, which is the vacuous shape this repo keeps catching.
    const hooks = files.flatMap((file) => hooksIn(readFileSync(file, 'utf8')))
    expect(files.length).toBeGreaterThan(10)
    expect(hooks.length).toBeGreaterThan(0)
  })

  test('and at least one of them spawns, so the rule has a subject', () => {
    const spawning = files.flatMap((file) =>
      hooksIn(readFileSync(file, 'utf8')).filter((one) => SPAWNS.test(one.body)),
    )
    expect(spawning.length).toBeGreaterThan(0)
  })

  test('every spawning hook says how long it may take', () => {
    const bare: string[] = []
    for (const file of files) {
      for (const one of hooksIn(readFileSync(file, 'utf8'))) {
        if (!SPAWNS.test(one.body)) continue
        if (!/,\s*[\d_]+\s*\)/.test(one.closer)) bare.push(`${file} — ${one.hook}`)
      }
    }
    expect(
      bare,
      'a spawning hook on bun\'s 5000ms default takes its whole file down as one unnamed failure',
    ).toEqual([])
  })
})
