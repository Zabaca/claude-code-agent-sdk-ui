# @zabaca/claude-code-agent-sdk-ui

A fully-wired Claude Code UI for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

[Brainless](https://brainless.swerdlow.dev) gives you Claude Code's interface as
React components. The Agent SDK gives you a stream of messages. Neither knows
about the other. This package is the layer in between — the classifier, the
transcript reducer, the transport, and the components with real state behind
them.

> **Status: early.** The design is settled and written down in
> [`DESIGN.md`](./DESIGN.md); the implementation is in progress.

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
calls, diffs, todo lists, permission prompts you can actually answer, slash
commands, interrupt, and session resume.

## Entry points

| Import                  | What it is                                                              |
| ----------------------- | ----------------------------------------------------------------------- |
| `.../core`              | `classify(SDKMessage) → Frame[]` and `reduce(Frame[]) → Timeline`. Pure. |
| `.../server`            | The `query()` host — SSE transport, `canUseTool` bridge, interrupt.     |
| `.../react`             | `useAgentSession()` and friends.                                        |
| `.../ui`                | Vendored, wired Brainless components.                                   |

`core` has no runtime dependency on the SDK, no clock and no socket, so a
recorded frame log replays through it in a test with no credential.

## Credits

The components under `src/ui/` are derived from
[**Brainless**](https://github.com/theswerd/brainless) by Ben Swerdlow, MIT
licensed. They have been modified to accept live session state — see the gap
table in [`DESIGN.md`](./DESIGN.md) for what changed and why. Go star the
original.

## License

MIT — see [`LICENSE`](./LICENSE), which includes the Brainless notice.
