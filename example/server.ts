import { createAgentHandler } from '../src/server/handler.ts'
import index from './index.html'

/**
 * The playground's server: the page, the stylesheet, and one agent handler.
 *
 * One handler for the life of the process, which is one Session (ADR-0002).
 * It is constructed eagerly and costs nothing until a Turn starts — the SDK is
 * imported lazily inside it, so a run that only ever uses replay never reaches
 * for a credential.
 *
 * Bound to localhost, and it stays that way. `bun run tailnet` puts it on the
 * tailnet by pointing tailscaled at this port (ADR-0004) — the process never
 * listens on anything but `127.0.0.1`, so nothing here decides who can reach
 * it. Do not put it behind a domain: ADR-0004 is a tailnet, which is a
 * membership list, and Funnel is one flag away from being neither.
 */
const root = new URL('../', import.meta.url).pathname
const stylesheet = `${root}dist/styles.css`

/** Newest mtime among the files `build:css` reads, or 0 if none are there. */
async function sources(): Promise<number> {
  let newest = 0
  for await (const file of new Bun.Glob('src/ui/**/*.{tsx,css}').scan(root)) {
    if (file.endsWith('.test.tsx')) continue
    newest = Math.max(newest, Bun.file(`${root}${file}`).lastModified)
  }
  return newest
}

// The stylesheet is a build artefact and is not committed. Building it here
// means `bun run dev` works from a fresh clone with no second command.
//
// Rebuilt whenever a component is newer than it, because `--hot` reloads the
// modules and not the stylesheet: editing a class name and reloading would
// otherwise serve yesterday's CSS, and the component would render with a
// utility that exists in the source and in no rule — which reads as the
// change not having worked rather than as a stale build.
const built = await Bun.file(stylesheet).exists()
  ? Bun.file(stylesheet).lastModified
  : 0
if (built < (await sources())) {
  console.log('building the stylesheet…')
  const build = Bun.spawnSync(['bun', 'run', 'build:css'], { cwd: root })
  if (build.exitCode !== 0) {
    throw new Error(`build:css failed: ${build.stderr?.toString() ?? ''}`)
  }
}

/** The checked-out branch, or nothing at all outside a git working tree. */
function branch(): string | undefined {
  const read = Bun.spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
  if (read.exitCode !== 0) return undefined
  const name = read.stdout.toString().trim()
  // `HEAD` is what a detached checkout answers, and it names no branch.
  return name === '' || name === 'HEAD' ? undefined : name
}

const agent = createAgentHandler({
  cwd: root,
  // Nothing else is named here on purpose. What runs is the host's to decide
  // and the client's never to name (ADR-0001); the handler's own default
  // permission mode is `bypassPermissions` (ADR-0003).
})

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env['PORT'] ?? 5173),
  routes: {
    '/': index,
    '/agent': (request) => agent(request),
    // The status line's `git:(branch)`, which no Frame carries: the SDK
    // reports a `cwd` and knows nothing about VCS. The playground knows
    // because it is running inside the checkout, so it is the playground that
    // says — the package still cannot invent one.
    '/branch': () => Response.json({ branch: branch() }),
  },
})

console.log(`playground  ${server.url}`)
console.log(`  replay    ${server.url}?mode=replay   — no credential, no network, no tokens`)
console.log(`  live      ${server.url}?mode=live     — a real agent, and a real bill`)
