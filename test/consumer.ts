import { mkdtempSync, symlinkSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
 */

const root = new URL('../', import.meta.url).pathname

export type Consumer = {
  /** The project directory, outside the repo. */
  dir: string
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
  const pack = Bun.spawnSync(['npm', 'pack', '--pack-destination', dir, '--json'], { cwd: root })
  if (pack.exitCode !== 0) throw new Error(`npm pack failed: ${pack.stderr.toString()}`)
  const [packed] = JSON.parse(pack.stdout.toString()) as [
    { filename: string; files: { path: string }[] },
  ]

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
