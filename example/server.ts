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
 * Bound to localhost, because that is the whole threat model (ADR-0001): a
 * single trusted user on their own machine. Do not put this behind a domain.
 */
const root = new URL('../', import.meta.url).pathname
const stylesheet = `${root}dist/styles.css`

// The stylesheet is a build artefact and is not committed. Building it here
// means `bun run dev` works from a fresh clone with no second command.
if (!(await Bun.file(stylesheet).exists())) {
  console.log('building the stylesheet…')
  const built = Bun.spawnSync(['bun', 'run', 'build:css'], { cwd: root })
  if (built.exitCode !== 0) {
    throw new Error(`build:css failed: ${built.stderr?.toString() ?? ''}`)
  }
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
  },
})

console.log(`playground  ${server.url}`)
console.log(`  replay    ${server.url}?mode=replay   — no credential, no network, no tokens`)
console.log(`  live      ${server.url}?mode=live     — a real agent, and a real bill`)
