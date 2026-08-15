# Design

Why this package exists, what it is made of, and what was learned building the
same thing three times before it.

## The problem

[Brainless](https://brainless.swerdlow.dev) is a shadcn/ui registry that
replicates the Claude Code, Codex and Grok terminal interfaces as React
components. It is very good, and it is **entirely presentational**. There is no
state, no data model, and no SDK anywhere in it. Its `claude-session` block —
advertised as "a complete Claude Code screen" — is a demo with every prop
written inline as a literal:

```tsx
<ClaudeToolCall tool="Bash" arg="bun test" result="12 passed, 0 failed in 1.4s" />
<ClaudePermission title="Bash command" command="git commit -am '…'" question="Do you want to proceed?" />
```

The [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
is the other half: a `query()` that yields an async stream of `SDKMessage`, and
no opinion whatsoever about pixels.

Between them is a layer nobody ships. This package is that layer.

## Prior art: the same layer, built three times

Three Zabaca projects each integrated the Agent SDK and each built their own UI.
They were written independently, months apart, by different-shaped teams, and
they converged on the same architecture:

> **SDK message → flat frame stream → transcript reducer → renderer**

|                 | cedarpad                   | varnick                | forge                       |
| --------------- | -------------------------- | ---------------------- | --------------------------- |
| SDK             | `0.3.178`                  | `0.3.220`              | `0.3.220`                   |
| classifier      | `server/classify.ts` (190) | `turn.ts` (1964)       | `classify.ts` (347)         |
| shell           | tldraw canvas + Mantine    | Tauri webview          | Hono + React SPA            |

That convergence is the strongest evidence available that the seam is real and
in the right place. Forge's `classify.ts` is the cleanest expression of it — a
pure function with no clock, no socket, and no runtime SDK import, so the entire
translation is testable without a credential or a network. This package lifts
that shape.

### What all three learned the hard way

Each of these cost someone a debugging session, and none of them is expressible
in Brainless as it stands:

- **Sub-agent attribution.** `parent_tool_use_id` is on every assistant message
  and is easy to not read. Without it, three background agents' tool calls land
  in the transcript indistinguishable from the main thread's. Forge's ADR-0018
  exists for exactly this.
- **A sub-agent says nothing unless you ask.** `forwardSubagentText` is off by
  default, and with it off the SDK emits only a sub-agent's `tool_use` and
  `tool_result` blocks — "enough for a heartbeat counter", in its own words. So
  every Thread surface shows what a sub-agent *did* and never what it was doing
  it for, and nothing fails: the transcript simply has a hole in it shaped like
  the reason. Forge hit this. Turning it on is only safe **after** attribution
  works, because forwarding puts three sub-agents' prose and thinking on the
  same path as the agent's own — and a block identified by its index alone then
  grows whichever bubble was last opened, landing a background agent's words
  inside the answer to the person. A block must be keyed by its Thread as well
  as its index, on the server and again in the hook.
- **A pasted picture needs a name in the sentence.** The pictures travel in an
  array and the words travel beside it, so a prompt carrying three screenshots
  has no way to say which is which — every one of them is "the image". Varnick
  writes `[Image #1]` into the draft at the cursor as each picture is pasted,
  which is Claude Code's own format and therefore one a person and an agent both
  already read. Two consequences that are easy to miss: the caret has to be read
  *before* the bytes, because reading a file is asynchronous and the cursor has
  moved by the time it resolves; and taking a picture back has to renumber the
  markers left behind, or the words describe a picture that is no longer in the
  request.
- **Compaction boundaries.** When context is compacted the transcript looks
  identical before and after, while what the agent can actually *see* has been
  replaced by a summary. A divergence that arrives through normal operation is
  worse than one that arrives through a crash, because nothing prompts anyone to
  check.
- **Configured is not loaded.** Forge set `plugins` on a profile, every file in
  the repo said the agent had two plugins, and the options object handed to the
  SDK had never heard of them. Nothing failed. The `init` message is the only
  account of what the runtime *actually* has, and it is worth surfacing.
- **Two different meters.** Context tokens ("how full is this conversation")
  and subscription rate limits ("how much of my week is left") move on different
  clocks and neither substitutes for the other.
- **An interrupt is not a failure.** Aborting a turn is what the person asked
  for. Rendering it as an error overwrites an idle turn with a problem nobody
  had.

## The gap, concretely

What the SDK emits against what Brainless can accept:

| SDK reality                                       | Brainless                                    | Gap                                       |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `tool_use` arrives *before* any result            | `ClaudeToolCall.result: string` — required    | cannot render an in-flight call            |
| `Edit` returns `structuredPatch` hunks             | `ClaudeDiff.lines: DiffLine[]`                | shape mismatch only — mechanical           |
| `canUseTool` → `{behavior, updatedInput}`         | `onChoose(index)`                             | no async resolve, no input editing         |
| streaming text deltas                             | `ClaudeMessage` takes children                | no accumulation                            |
| `parent_tool_use_id`                              | —                                             | nothing                                    |
| `compact_boundary`, `rate_limit_event`, context   | —                                             | nothing                                    |
| shift+tab modes, effort chips                     | display-only props                            | no `onModeChange` / `onEffortChange`       |
| `ClaudeThinking` is a working line, not reasoning  | verbs rotate on a `setInterval`               | not driven by real Turn state              |
| `result.subtype !== 'success'`                    | —                                             | no failed-turn rendering                   |

Closing these requires editing the components, which is why they are vendored
here (MIT, attribution in `LICENSE`) rather than installed via `shadcn add`.

## Shape

Four entry points, one package.

```
src/core     classify(SDKMessage) → Frame[]   ·   reduce(Frame[]) → Transcript
             Pure. No SDK import at run time, no clock, no socket.

src/server   The query() host: SSE transport, canUseTool bridge, interrupt.
             Bun-first — Bun.serve and Hono.

src/react    useAgentSession() → { transcript, send, interrupt, resolvePermission, … }

src/ui       Brainless components, vendored and wired.
```

The target the whole design is aimed at:

```tsx
const session = useAgentSession({ endpoint: "/api/agent" })
return <ClaudeSession session={session} />
```

### Why the frame stream is a separate stage from the transcript

`classify` answers "what happened", once per SDK message, with no memory.
`reduce` answers "what is on screen now", accumulating deltas into bubbles,
matching `tool_result` back to the `tool_use` that opened it, and threading
sub-agent work under the `Task` call that spawned it.

Keeping them apart is what makes the hard parts testable: replaying a recorded
frame log through `reduce` reproduces any transcript bug without an API key, and
`classify` can be exercised against fixture `SDKMessage`s with no state to set
up. Fusing them — which is the tempting shortcut, since both run in the same
loop — is how you end up unable to test either.

## Decisions

- **npm, not a shadcn registry.** Brainless's copy-in ethos is right for
  chrome you want to restyle; it is wrong for a runtime you want to receive
  fixes for. The components are vendored so the required-prop and
  missing-callback holes above can actually be closed.
- **Claude skin only.** Codex and Grok are reskins of a data model this package
  does not produce. They can follow once the Claude path genuinely works
  end to end.
- **Bun-first.** All three prior implementations are Bun. The handler is written
  against Web-standard `Request`/`Response` so it is not *hostile* to other
  runtimes, but Bun.serve and Hono are what get tested.
- **Only the agent's own words get the whole screen.** Prose, a person's
  prompt, thinking — those are the conversation, and they are drawn in full.
  Everything else in a Transcript is somebody else's output about the
  conversation: tool results, hook stdout and stderr, recalled memories. Those
  are drawn collapsed, behind a real `<details>` disclosure, and never cut —
  the whole of the text stays in the DOM, so what the screen holds back is a
  click away and the Transcript still holds everything that was said. Two
  limits, because output arrives shaped two ways: a line count (a hook that
  printed 200 lines) and a character count (a JSON payload with its newlines
  escaped, which is one physical line thousands of characters wide and which a
  line count calls short). Output short enough to read draws no disclosure at
  all. A hook's preview is its tail — a process says how it ended at the end —
  while a tool's collapsed line keeps its head, which is where an answer says
  what it is. `Spill` and `clip` in `src/ui/session.tsx`.
- **Ship the build, not the sources.** Bun-first is how it is developed, not
  what it may demand of a consumer. `dist/` carries compiled JavaScript and
  declarations, emitted by `prepack`. Publishing `src/` was tried and works
  under Bun — and hands every consumer running `tsc` twenty `TS5097` errors
  inside their own `node_modules`, for files they cannot edit, unless they
  adopt `allowImportingTsExtensions`. A published package has no business
  setting compiler options for the projects that install it. Verified by
  packing, installing into a project elsewhere on disk, and importing it back:
  `src/package.test.ts`.
