# @zabaca/claude-code-agent-sdk-ui

A fully-wired Claude Code UI for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

[Brainless](https://brainless.swerdlow.dev) gives you Claude Code's interface as
React components. The Agent SDK gives you a stream of messages. Neither knows
about the other. This package is the layer in between — the classifier, the
transcript reducer, the transport, and the components with real state behind
them.

> **Status: v0.1.** Everything on this page runs. Permission prompts do not
> exist yet and are v0.2 — see below and [ADR-0003](./docs/adr/0003-bypass-permissions-by-default.md).
> The architecture is written down in [`DESIGN.md`](./DESIGN.md).

## Install

```sh
bun add @zabaca/claude-code-agent-sdk-ui @anthropic-ai/claude-agent-sdk react react-dom
```

The Agent SDK is a peer dependency — it is your credential and your bill, so it
is yours to install and pin. `react` and `react-dom` are peers too, and are only
needed for the `react` and `ui` entry points; a host that uses `core` and
`server` alone can leave them out.

The package ships compiled JavaScript with type declarations, so there is
nothing to build and no TypeScript compiler option to adopt. It runs on Bun and
on Node, and bundles under Vite, esbuild, webpack, or anything that reads an
`exports` map.

## What you get

```tsx
import { useAgentSession } from "@zabaca/claude-code-agent-sdk-ui/react"
import { ClaudeSession } from "@zabaca/claude-code-agent-sdk-ui/ui"
import "@zabaca/claude-code-agent-sdk-ui/styles.css"

export function App() {
  const session = useAgentSession({ endpoint: "/api/agent" })
  return <ClaudeSession session={session} />
}
```

```ts
// server.ts
import { createAgentHandler } from "@zabaca/claude-code-agent-sdk-ui/server"

const agent = createAgentHandler({ cwd: process.cwd() })

Bun.serve({
  port: 3000,
  routes: { "/api/agent": agent },
})
```

That is a working Claude Code session in a browser: streaming text, live tool
calls, diffs, todo lists, slash commands, interrupt, and session resume.

**Permission prompts are not in v0.1.** The handler runs
`permissionMode: 'bypassPermissions'` — tools execute without asking, and
`ClaudePermission` is not part of the `ui` surface. Wiring the SDK's
`canUseTool` to a real approval UI is v0.2. See [`DESIGN.md`](./DESIGN.md) for
why.

## Playground

```sh
bun install
bun run dev          # http://127.0.0.1:5173  (PORT overrides)
```

It runs in two modes off the same Frame log.

**Replay** (`?mode=replay`, the default) plays a scripted Frame log through the
hook's own injectable transport. No credential, no network, no tokens — the
whole surface in seconds. Type into the composer and it answers; press esc and
it stops.

**Live** (`?mode=live`) opens the handler's SSE stream and talks to a real
agent. It needs a credential and it spends money.

They are one code path: the same `useAgentSession`, the same `reduce`, the same
components. Only where the Frames come from differs — which is why replay
proves something about live.

### Reaching it from another machine

```sh
bun run tailnet      # once — declares and serves the route
bun run dev
```

`tailscale serve` points tailscaled at port 5173; the process keeps its
`127.0.0.1` bind. The playground is then at
`https://<node>.<tailnet>.ts.net:8805` for everything on your tailnet.

> **This shares more than a UI.** `/agent` runs the Agent SDK with
> `permissionMode: 'bypassPermissions'` and `cwd` set to the checkout, so every
> device on the tailnet can run commands as you, without being asked. The
> tailnet is the whole boundary — read
> [ADR-0004](./docs/adr/0004-the-tailnet-is-the-playground-boundary.md) before
> running it, and `tailscale serve --https=8805 off` to stop.
>
> This is the playground, not the package. `createAgentHandler` is unchanged and
> [ADR-0001](./docs/adr/0001-localhost-single-user-threat-model.md) still governs
> it.

> **If an edit does not show up, restart `bun run dev`.** The dev server
> rebundles on change and the stylesheet is rebuilt whenever a component is
> newer than it — but a long-lived `--hot` process can lose track of a file that
> was *replaced* rather than written in place (which is what `perl -i`, `cp` and
> some editors' atomic saves do). The page then keeps serving the last good
> bundle, which looks exactly like a change that did not work. `curl -s
> localhost:5173 | grep -o '/_bun/client/[^"]*'` and grepping that bundle for
> your change settles it in a second.

## Entry points

Four, plus the stylesheet. Each is importable on its own.

| Import                                       | What it is                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `@zabaca/claude-code-agent-sdk-ui/core`       | `classify(SDKMessage) → Frame[]` and `reduce(Frame[]) → Transcript`. Pure. |
| `@zabaca/claude-code-agent-sdk-ui/server`     | The `query()` host — SSE transport, interrupt, held images.               |
| `@zabaca/claude-code-agent-sdk-ui/react`      | `useAgentSession()` and its transport types.                              |
| `@zabaca/claude-code-agent-sdk-ui/ui`         | Vendored, wired Brainless components, and `ClaudeSession`.                |
| `@zabaca/claude-code-agent-sdk-ui/styles.css` | The precompiled stylesheet.                                               |

`core` imports no SDK code at run time — the SDK appears in it as types only,
which compile away — so it has no clock, no socket, and nothing to authenticate.
A recorded Frame log replays through it in a test with no credential. `server`
loads the SDK lazily, inside the first Turn, so constructing a handler costs
nothing either.

## Styling

`styles.css` is precompiled. You do not need Tailwind, a config file, or a
PostCSS step — importing it is the whole setup. Every class it defines carries a
`cc:` prefix, and it does not reset your page.

The components draw with `--cc-*` custom properties, defaulted to tokyo-night.
Redefine any of them on an ancestor to re-theme:

```css
.my-app {
  --cc-fg: #1a1a1a;
  --cc-accent: #7c3aed;
  --cc-success: #15803d;
}
```

The sources under `src/ui/` stay written in Tailwind so they remain diffable
against upstream Brainless; `bun run build:css` is what turns them into the
shipped stylesheet.

## Tests

```sh
bun test src scripts # the whole suite. No credential, no network, no tokens.
bun run typecheck
```

Nothing in that suite needs an API key, including the test that packs the
tarball and imports it back from a temp directory.

**The live canary is the one exception, and it does not run unless you say so.**

```sh
LIVE_CANARY=1 bun run canary
```

It boots a real handler against the real Agent SDK, sends "say hi", and asserts
a `settled` Frame comes back — the one test that would notice the SDK
integration breaking under a version bump. It spends money, so it is off by
default: without `LIVE_CANARY=1` it is skipped, and `bun test` alone can never
trigger it. Credentials come from wherever the Agent SDK looks for them
(`ANTHROPIC_API_KEY`, or the Claude Code CLI's stored credential).

## Credits

The components under `src/ui/` are derived from
[**Brainless**](https://github.com/theswerd/brainless) by Ben Swerdlow, MIT
licensed. They have been modified to accept live session state — see the gap
table in [`DESIGN.md`](./DESIGN.md) for what changed and why. Go star the
original.

## License

MIT — see [`LICENSE`](./LICENSE), which includes the Brainless notice.
