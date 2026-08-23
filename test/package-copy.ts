import { cpSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/**
 * A disposable copy of this package, somewhere else on disk, for anything that
 * builds it.
 *
 * **Why a copy rather than an ordering.** `build:js` opens with `rm -rf dist`
 * and `build:css` writes into the same directory, so every build here is a
 * destructive write to one shared path. Inside a single run that is harmless —
 * bun runs test files in sequence. Across two runs in one working tree it is a
 * race: one run's `rm -rf dist` lands between the other's build and the moment
 * `npm pack` collects the files it is about to ship, and a tarball goes out
 * without the build in it. Six tarball tests then fail in a tree whose diff
 * contains no cause.
 *
 * The alternatives were considered and are worse. A **lockfile** turns a
 * process race into a stale-lock problem, and clearing a stale lock needs a
 * timeout — a time dependency, which is the "fails under load, re-run" shape
 * rather than a fix. **Declaring concurrent runs unsupported** is a rule with
 * nothing enforcing it, so the next person pays the same diagnosis. Copying
 * removes the shared mutable path instead of scheduling access to it, and two
 * runs that share nothing cannot race whatever the interleaving.
 *
 * **What is left out, and why each is safe.** `node_modules` is symlinked
 * rather than copied — it is the largest thing here by far and nothing built
 * writes to it. `dist` is skipped because a build regenerates it, and copying a
 * stale one is how a build would appear to succeed having done nothing. `.git`
 * is skipped as pure weight.
 *
 * **The link is aimed by the resolver, not by joining a path to this
 * directory.** Node resolution walks *up*, so a package vendored inside a
 * larger repo — which this one is, in `agent-lab` — has no `node_modules` of
 * its own and its builds find `tailwindcss` and `tsc` in an ancestor's. A copy
 * under `/tmp` has no such ancestor, so a link to `<this package>/node_modules`
 * points at nothing and every build fails with `command not found`. Asking
 * `Bun.resolveSync` where a package the build actually needs ended up gives the
 * directory that answers for this checkout, wherever it is.
 *
 * **What must not be left out**: anything `package.json`'s `files` names, or a
 * tarball packed here would ship less than a tarball packed in the tree, and
 * the test that checks what ships would go on passing while checking less.
 * `src/package-copy.test.ts` holds that, so the filter cannot quietly outgrow
 * it — the suite only walks `src` and `scripts`, which is why the guard for a
 * helper in `test/` lives next door rather than beside it.
 */
const root = new URL('../', import.meta.url).pathname

/** Not copied. Everything else is. */
export const NOT_COPIED: ReadonlySet<string> = new Set(['node_modules', 'dist', '.git'])

export type PackageCopy = {
  /** The copy's root, outside this repo. */
  dir: string
  /** Removes it. Safe to call twice. */
  remove(): void
}

/**
 * `name` becomes part of the path, so a directory left behind by a killed run
 * says which helper made it.
 */
/**
 * The `node_modules` this checkout's builds actually resolve through.
 *
 * `typescript` because `build:js` runs `tsc` and every checkout that can build
 * has it; unscoped, so its directory's parent *is* `node_modules` with no
 * second level to strip.
 */
export function installedModules(): string {
  return dirname(dirname(Bun.resolveSync('typescript/package.json', root)))
}

export function packageCopy(name: string): PackageCopy {
  const dir = mkdtempSync(join(tmpdir(), `cc-agent-sdk-ui-${name}-`))
  cpSync(root, dir, {
    recursive: true,
    // The filter is asked about the copy's root too, which is not in the set
    // and must not be — refusing it would copy nothing at all.
    filter: (from) => !NOT_COPIED.has(basename(from)),
  })
  // Symlinked, not copied: `bun run` and `npm` both resolve `node_modules/.bin`
  // through it, and following a link is what they already do for a workspace.
  symlinkSync(installedModules(), join(dir, 'node_modules'), 'dir')
  return {
    dir,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * A copy with `bun run build:js` already run in it — `dist/` populated, in a
 * directory nothing else can see.
 *
 * The caller removes it. There is deliberately no per-process cache: a cache
 * here would have no `afterAll` to hang cleanup on across files, and a temp
 * directory nobody removes is how one repo reached 169,000 of them.
 */
export function buildPackage(name: string): PackageCopy {
  const copy = packageCopy(name)
  const build = Bun.spawnSync(['bun', 'run', 'build:js'], { cwd: copy.dir })
  if (build.exitCode !== 0) {
    copy.remove()
    throw new Error(`build:js failed: ${build.stderr.toString()}`)
  }
  return copy
}

/**
 * A fingerprint of the package's own `dist/`, for asserting that a build did
 * not touch it.
 *
 * **This is where the property lives, and it is asserted beside each of the
 * three builders rather than in a file of its own.** A standalone guard was
 * written first and measured at 4.0 seconds — a third of the whole suite —
 * because proving that three helpers do not write a path means running all
 * three, and all three already run elsewhere in the same suite. A guard costing
 * a third of every run is a guard someone eventually deletes, and the property
 * is not worth less when it is checked for free.
 *
 * A snapshot rather than "delete it first, then assert it is still gone": the
 * delete would itself be a write to the shared path, by a suite whose whole
 * complaint is that others write to it. Comparing before with after mutates
 * nothing and holds whether or not a human has run `bun run build` here.
 *
 * **It walks the contents, and the first version did not.** `statSync` on the
 * directory answers for the directory *inode*, whose mtime moves when an entry
 * is created or removed and **not** when an existing file is overwritten. So a
 * `build:css` writing over a `dist/styles.css` that was already there changed
 * nothing this could see: mutating `buildStylesheet` back to building in the
 * tree survived the whole suite. Caught by the mutation batch and not by
 * reading, which is the entire argument for running one.
 *
 * `absent` is a normal answer, not a failure — after this fix nothing in the
 * suite creates `dist/` at all, so a clean checkout that has only ever run the
 * tests has none.
 *
 * **Which is exactly why it takes a path.** The three assertions compare this
 * before against this after, so a version that always answered `absent` would
 * satisfy all three while recognising nothing — the guard would be vacuous and
 * every mutation aimed at it would survive. The parameter lets
 * `package-copy.test.ts` point it somewhere disposable and hold it to telling
 * a directory that is there from one that is not, without writing to the very
 * path this whole file exists to stop the suite writing to.
 */
export function sharedDistState(at: string = join(root, 'dist')): string {
  const entries: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const found = statSync(path)
      if (found.isDirectory()) walk(path, `${prefix}${name}/`)
      else entries.push(`${prefix}${name}:${found.mtimeMs}:${found.size}`)
    }
  }
  try {
    walk(at, '')
  } catch {
    return 'absent'
  }
  return entries.length === 0 ? 'empty' : entries.join('\n')
}
