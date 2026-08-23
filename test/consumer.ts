import { mkdtempSync, symlinkSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { packageCopy } from './package-copy.ts'

/**
 * A fresh project, somewhere else on disk, that has installed the tarball.
 *
 * The reason this exists rather than a test that reads `package.json` and
 * reasons about it: every other test in this suite runs inside the working
 * tree, where every file trivially exists. The package shipped four files for
 * the whole of v0.1 — `LICENSE`, `README.md`, `dist/styles.css`,
 * `package.json` — and no test could see it, because no test ever left the
 * tree. So this one leaves: `npm pack`, extract, resolve by package specifier.
 *
 * No registry is contacted. `npm pack` writes a local tarball and runs
 * `prepack`, which is the same build `npm publish` would run.
 *
 * That build is why the pack happens in a **copy** of the package rather than
 * in the tree: `prepack` is `bun run build`, and `build:js` opens with
 * `rm -rf dist`. Run beside a second suite in the same working tree, that
 * deletion lands inside the other run's window and a tarball ships without its
 * build. See `package-copy.ts` for why the fix is to stop sharing the path
 * rather than to order the writes.
 */

const root = new URL('../', import.meta.url).pathname

export type Consumer = {
  /** The project directory, outside the repo. */
  dir: string
  /**
   * The extracted package inside it — the shipped bytes, on disk.
   *
   * Exposed so a guard about the tarball's *contents* can read the tarball
   * rather than the working tree's `dist/`. Reading the tree was an
   * approximation that held only because `npm pack` used to build the tree's
   * `dist/` on its way past; once the pack moved into a copy it stopped
   * holding, which is the same shared-path defect one layer on.
   */
  installed: string
  /** Everything in the tarball, as paths relative to the package root. */
  ships: Set<string>
  /** Writes a file into the project. */
  write(name: string, content: string): Promise<void>
  /** Runs a command in the project and returns what happened. */
  run(command: string[]): { code: number; stdout: string; stderr: string }
  remove(): Promise<void>
}

/** The peers a consumer would have installed, linked from this repo's copies. */
const PEERS = [
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  '@anthropic-ai/claude-agent-sdk',
  'typescript',
]

/** Where a package actually lives, asked of the resolver rather than guessed. */
function packageDir(name: string): string {
  return dirname(Bun.resolveSync(`${name}/package.json`, root))
}

/** Packs the repo and installs the tarball into a temp project. */
export async function installPacked(): Promise<Consumer> {
  const dir = mkdtempSync(join(tmpdir(), 'cc-agent-sdk-ui-consumer-'))
  const source = packageCopy('pack')
  let packed: { filename: string; files: { path: string }[] }
  try {
    const pack = Bun.spawnSync(['npm', 'pack', '--pack-destination', dir, '--json'], {
      cwd: source.dir,
    })
    if (pack.exitCode !== 0) throw new Error(`npm pack failed: ${pack.stderr.toString()}`)
    ;[packed] = JSON.parse(pack.stdout.toString()) as [
      { filename: string; files: { path: string }[] },
    ]
  } finally {
    source.remove()
  }

  const installed = join(dir, 'node_modules', '@zabaca', 'claude-code-agent-sdk-ui')
  await mkdir(installed, { recursive: true })
  const extract = Bun.spawnSync(
    ['tar', '-xzf', join(dir, packed.filename), '-C', installed, '--strip-components=1'],
    { cwd: dir },
  )
  if (extract.exitCode !== 0) throw new Error(`extract failed: ${extract.stderr.toString()}`)

  for (const peer of PEERS) {
    const at = join(dir, 'node_modules', peer)
    await mkdir(dirname(at), { recursive: true })
    symlinkSync(packageDir(peer), at, 'dir')
  }

  return {
    dir,
    installed,
    ships: new Set(packed.files.map((file) => file.path)),
    write: (name, content) => Bun.write(join(dir, name), content).then(() => undefined),
    run: (command) => {
      const ran = Bun.spawnSync(command, { cwd: dir })
      return {
        code: ran.exitCode ?? -1,
        stdout: ran.stdout.toString(),
        stderr: ran.stderr.toString(),
      }
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  }
}
