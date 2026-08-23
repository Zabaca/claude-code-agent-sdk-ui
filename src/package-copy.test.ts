import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { NOT_COPIED, installedModules, packageCopy, sharedDistState } from '../test/package-copy.ts'

/**
 * The copy that `build-css.ts` and `consumer.ts` build in — held to being a
 * copy of *this* package rather than of most of it.
 *
 * This is the guard that keeps the fix in `package-copy.ts` from becoming a
 * quieter version of the bug it fixed. A tarball packed from a copy is only
 * evidence about the real package while the copy carries everything the real
 * package ships; drop one of those files from the copy and `package.test.ts`
 * goes on passing while checking something smaller.
 */
const root = new URL('../', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  files: string[]
}

describe('the copy is a copy of the package', () => {
  test('everything `files` ships is in it, or is the one thing the build makes', () => {
    const copy = packageCopy('guard')
    try {
      // The control: `files` is read rather than assumed, so a manifest that
      // listed nothing would fail here instead of passing vacuously.
      expect(manifest.files.length).toBeGreaterThan(0)

      for (const shipped of manifest.files) {
        if (shipped === 'dist') {
          // Deliberately absent: `prepack` regenerates it, and copying a stale
          // one is how a build appears to succeed having done nothing.
          expect(NOT_COPIED.has('dist')).toBe(true)
          expect(existsSync(join(copy.dir, 'dist'))).toBe(false)
          continue
        }
        expect(existsSync(join(copy.dir, shipped)), `${shipped} is missing from the copy`).toBe(true)
      }
    } finally {
      copy.remove()
    }
  }, 60_000)

  test('nothing `files` ships is excluded by the filter, except the build output', () => {
    // The static half of the same rule, and the one that fires the moment
    // somebody adds a directory to `files` whose name is already in the set.
    for (const shipped of manifest.files) {
      if (shipped === 'dist') continue
      expect(NOT_COPIED.has(shipped), `${shipped} is shipped and would not be copied`).toBe(false)
    }
  })

  test('`node_modules` is a link to the one this checkout actually resolves through', () => {
    // Not `<package>/node_modules`, which does not exist when the package is
    // vendored inside a larger repo — resolution walks up, and a copy under
    // /tmp has nothing to walk up to. A dangling link fails every build with
    // `command not found`, which is what it did before this was resolver-aimed.
    const modules = installedModules()
    expect(existsSync(join(modules, '.bin', 'tsc'))).toBe(true)

    const copy = packageCopy('guard-modules')
    try {
      expect(existsSync(join(copy.dir, 'node_modules', '.bin', 'tsc'))).toBe(true)
    } finally {
      copy.remove()
    }
  }, 60_000)

  test('the copy goes away when it is removed', () => {
    const copy = packageCopy('guard-remove')
    expect(existsSync(copy.dir)).toBe(true)
    copy.remove()
    expect(existsSync(copy.dir)).toBe(false)
    // Twice, because every caller removes in a `finally` that may run after a
    // throw from a path that already removed it.
    expect(() => copy.remove()).not.toThrow()
  }, 60_000)
})

describe('sharedDistState recognises something', () => {
  // The three `leaves the dist/ alone` assertions compare this before against
  // this after. A version that always answered the same string would satisfy
  // every one of them while recognising nothing — the classic vacuous guard,
  // and one that no mutation aimed at the builders could ever kill. So it is
  // held to distinguishing, against a directory of its own.
  test('a directory that is not there reads as absent', () => {
    const copy = packageCopy('state-absent')
    const missing = join(copy.dir, 'no-such-directory')
    try {
      expect(sharedDistState(missing)).toBe('absent')
    } finally {
      copy.remove()
    }
  }, 60_000)

  test('a directory that is there does not', () => {
    const copy = packageCopy('state-present')
    try {
      expect(sharedDistState(copy.dir)).not.toBe('absent')
    } finally {
      copy.remove()
    }
  }, 60_000)

  test('a file overwritten in place changes the reading', () => {
    // The hole the mutation batch found, and the reason this walks the contents
    // rather than stat-ing the directory. A directory's own mtime moves when an
    // entry is created or removed and NOT when an existing file is written
    // over, so `build:css` rewriting a `styles.css` that was already there was
    // invisible — and `buildStylesheet` building in the tree survived the whole
    // suite. Nothing here is about `dist/` specifically; it is about whether
    // this function can see a write at all.
    const copy = packageCopy('state-overwrite')
    try {
      writeFileSync(join(copy.dir, 'probe.txt'), 'before')
      const before = sharedDistState(copy.dir)
      writeFileSync(join(copy.dir, 'probe.txt'), 'after, and longer')
      expect(sharedDistState(copy.dir)).not.toBe(before)
    } finally {
      copy.remove()
    }
  }, 60_000)

  test('and the two readings differ, which is the whole of what it is for', () => {
    const copy = packageCopy('state-differs')
    try {
      expect(sharedDistState(copy.dir)).not.toBe(sharedDistState(join(copy.dir, 'nope')))
    } finally {
      copy.remove()
    }
  }, 60_000)
})
