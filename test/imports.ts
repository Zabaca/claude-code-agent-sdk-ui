import { dirname, resolve } from 'node:path'

/**
 * Walking a module's own imports, for the guards that ask what an entry point
 * drags in: what `react` may reach, what `core` may reach, and what the tarball
 * has to contain for either of them to load at all.
 *
 * Written once and shared, because a walker that quietly matches nothing is the
 * worst possible shape for a guard — it passes. The first version of this lived
 * inline in `react/session.test.tsx` and matched only single-quoted `from '…'`;
 * `src/ui/` is written in double quotes, so the same walk pointed at `ui` would
 * have reported a module that imports nothing and reached the end happily.
 */

/**
 * Every relative specifier a source file names, in any of the three forms that
 * load a module: `from "…"`, a bare side-effect `import "…"`, and a dynamic
 * `import("…")` — in either quote.
 *
 * Bare package specifiers are deliberately not returned: this answers "which of
 * our files does this file pull in", and a dependency is not one of our files.
 */
export function specifiersIn(source: string): string[] {
  const found: string[] = []
  for (const [, , specifier] of source.matchAll(
    /(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.[^'"]+)\1/g,
  )) {
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

/** Extensions worth reading for imports of their own. */
const CODE = /\.(?:tsx?|jsx?|mts|cts)$/

/**
 * Where a specifier actually lands.
 *
 * Declarations emitted under `rewriteRelativeImportExtensions` keep the source's
 * `./x.ts` specifier — TypeScript resolves that to the sibling `./x.d.ts`, and a
 * walk that took the path literally would call a shipped file missing.
 */
async function landsOn(path: string): Promise<string | undefined> {
  const candidates = [path, path.replace(/\.tsx?$/, '.d.ts')]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}

/**
 * Every file reachable from `entry` by following relative imports, `entry`
 * included, as absolute paths.
 *
 * A specifier that resolves to nothing throws rather than being skipped. Every
 * import in this repo carries its extension (`allowImportingTsExtensions`), so
 * a miss means a typo or a moved file — and a walk that shrugs at those is a
 * walk that under-reports for the guards built on it.
 */
export async function reachableFrom(entry: string): Promise<Set<string>> {
  const reached = new Set<string>()
  const queue = [resolve(entry)]

  while (queue.length > 0) {
    const path = queue.pop()
    if (path === undefined || reached.has(path)) continue

    const lands = await landsOn(path)
    if (lands === undefined) {
      throw new Error(`import does not resolve to a file: ${path}`)
    }
    if (reached.has(lands)) continue
    reached.add(lands)
    if (!CODE.test(lands)) continue

    const source = await Bun.file(lands).text()
    for (const specifier of specifiersIn(source)) {
      queue.push(resolve(dirname(path), specifier))
    }
  }

  return reached
}
