/**
 * The playground's tailnet route, declared instead of remembered.
 *
 * `tailscale serve` puts a loopback port on the tailnet: tailscaled terminates
 * TLS with the node's MagicDNS certificate and proxies to the local address.
 * The server itself keeps its `127.0.0.1` bind and knows nothing about any of
 * this — what changes is who can reach tailscaled, not what the process listens
 * on.
 *
 * The config lives in tailscaled's own state and survives reboots, which is
 * exactly what makes it easy to run once by hand and never write down. A route
 * that exists only in a shell history is a surface the repo cannot account for.
 * So it is declared here, checked by a test, and converged by `bun run tailnet`.
 *
 * **Scope: this one port, and nothing else.** The serve config is a per-node
 * aggregate that unrelated services write into — this box already serves 8801
 * and 8803 for other things — so an authoritative version would have to delete
 * every route it does not declare. This converges the port it owns and reports
 * nothing about the rest. The honest consequence is that a route nobody
 * declares is invisible here; closing that means declaring more routes, not
 * widening this.
 *
 * **Serve, never Funnel.** Serve is tailnet-only. Funnel publishes the same
 * handler to the internet, and the two are one flag apart in the same
 * subcommand. The tailnet is this route's entire authentication boundary
 * (ADR-0004) — there is no second login behind it, and the handler runs
 * `bypassPermissions` — so this refuses to converge a port Funnel has opened
 * rather than quietly re-serving over it.
 *
 * Why this exists at all, and what it costs: `docs/adr/0004-the-tailnet-is-the-playground-boundary.md`.
 */

/** What `tailscale serve status --json` says, narrowed to what is read here. */
export type ServeStatus = {
  TCP?: Record<string, { HTTPS?: boolean } | undefined>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string } | undefined> } | undefined>
  AllowFunnel?: Record<string, boolean>
}

/** A tailnet HTTPS port, and the local thing behind it. */
export type Route = {
  port: number
  target: string
  path: string
}

/**
 * The declared route. 8805 because 8801 and 8803 are this node's already, and
 * 5173 because that is what `bun run dev` listens on.
 */
export const PLAYGROUND: Route = {
  port: 8805,
  target: 'http://127.0.0.1:5173',
  path: '/',
}

/** What converging this route would do, given what is already served. */
export type Verdict =
  /** The port is free, or points somewhere else. */
  | 'serve'
  /** Already exactly this route. Nothing to do. */
  | 'already'
  /** Funnel has made this port public. Refused rather than re-served over. */
  | 'funnel'

/**
 * `tailscale serve status --json` to a config.
 *
 * An unserved node prints `{}`, and some versions print `null`; neither is an
 * error. Unparseable output is, because reading it as "nothing is served" would
 * make every run re-serve and report a change that never happened.
 */
export function parseServeStatus(json: string): ServeStatus {
  const text = json.trim()
  if (text === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object') return {}
  return parsed as ServeStatus
}

/** What to do about one route, reading only that route's own entries. */
export function decide(status: ServeStatus, route: Route, host: string): Verdict {
  const at = `${host}:${route.port}`
  if (status.AllowFunnel?.[at] === true) return 'funnel'
  const proxy = status.Web?.[at]?.Handlers?.[route.path]?.Proxy
  return proxy === route.target ? 'already' : 'serve'
}

/** The node's own MagicDNS name, which is what serve keys its entries by. */
function host(): string {
  const status = JSON.parse(run(['tailscale', 'status', '--json'])) as {
    Self?: { DNSName?: string }
  }
  const name = status.Self?.DNSName?.replace(/\.$/, '')
  if (name === undefined || name === '') throw new Error('tailscale did not name this node')
  return name
}

function run(command: string[]): string {
  const done = Bun.spawnSync(command)
  if (done.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${done.stderr.toString().trim()}`)
  }
  return done.stdout.toString()
}

if (import.meta.main) {
  const node = host()
  const verdict = decide(parseServeStatus(run(['tailscale', 'serve', 'status', '--json'])), PLAYGROUND, node)
  const url = `https://${node}:${PLAYGROUND.port}`

  if (verdict === 'funnel') {
    console.error(
      `refused: Funnel has ${node}:${PLAYGROUND.port} open to the internet.\n` +
        `The tailnet is this route's whole boundary and the handler runs bypassPermissions,\n` +
        `so serving over a Funnel would publish unprompted command execution.\n` +
        `Close it first: tailscale funnel --https=${PLAYGROUND.port} off`,
    )
    process.exit(1)
  }

  if (verdict === 'already') {
    console.log(`already served: ${url} → ${PLAYGROUND.target}`)
  } else {
    run(['tailscale', 'serve', '--bg', `--https=${PLAYGROUND.port}`, PLAYGROUND.target])
    console.log(`served: ${url} → ${PLAYGROUND.target}`)
  }

  console.log(`\nRun the playground with \`bun run dev\`; it stays bound to 127.0.0.1.`)
  console.log(`Everyone on the tailnet can reach it, and /agent runs commands without asking.`)
  console.log(`Stop sharing it: tailscale serve --https=${PLAYGROUND.port} off`)
}
