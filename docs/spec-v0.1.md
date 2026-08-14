# Spec — v0.1: a Claude Code chat UI that works out of the box

## Problem Statement

Every project that wants a Claude Code interface on the web has to build the
same layer from scratch, and it is not a small one. The Claude Agent SDK yields
a stream of `SDKMessage` and has no opinion about pixels. Brainless gives you
Claude Code's chrome as React components and has no state, no data model and no
SDK — its `claude-session` "block" is a demo with every prop written inline as a
literal.

Three projects have now each built the missing middle independently — cedarpad,
varnick and forge — and each rediscovered the same handful of traps the hard
way: sub-agent work landing in the Transcript indistinguishable from the main
thread's; a compaction that leaves the screen silently lying about what the
agent can see; plugins that were configured and never loaded; an interrupt
rendered as a failure.

The cost is not just the initial build. It is that every one of those lessons
has to be re-learned per project, and none of them are visible until they bite.

## Solution

One npm package that is the missing middle: the classifier, the Transcript
reducer, the transport, and Claude Code's components with real state behind
them. Two imports and a route handler give you a working Claude Code session in
a browser.

Alongside it ships a **playground** that runs in two modes off the same Frame
log — *replay*, which drives every surface from a synthetic log so you can see
compaction, failure, three concurrent Threads and a rate limit in seconds
without burning tokens; and *live*, which talks to a real agent.

## User Stories

1. As a developer starting a new project, I want to install one package and get
   a working Claude Code chat, so that I do not rebuild the same layer again.
2. As a developer, I want the agent's prose to stream in token by token, so that
   the interface feels alive rather than arriving in blocks.
3. As a developer, I want to see each tool call as it starts, so that I know what
   the agent is doing before it has finished doing it.
4. As a developer, I want a tool call to show its status — pending, success,
   error — so that a failure is visible without expanding anything.
5. As a developer, I want a long-running tool to show elapsed seconds, so that I
   can tell "working" from "hung".
6. As a developer, I want to expand a tool call to read its full output, so that
   the Transcript stays scannable by default.
7. As a developer, I want file edits rendered as a real diff with line numbers,
   so that I can review a change without opening the file.
8. As a developer, I want the agent's todo list rendered as a list with states,
   so that I can see the plan and its progress.
9. As a developer, I want sub-agent work attributed to the Thread that spawned
   it, so that three background agents' tool calls are not mistaken for the main
   agent's.
10. As a developer, I want a live meter per running Thread showing tokens, tool
    calls and elapsed time, so that I can tell which background agent is doing
    the work.
11. As a developer, I want a marker when context is compacted, so that the screen
    does not silently misrepresent what the agent can still see.
12. As a developer, I want a marker when the conversation is reset, so that I can
    tell "memory summarised" from "memory gone".
13. As a developer, I want a marker when memory is recalled from outside this
    conversation, so that the agent knowing something I never said is accounted
    for.
14. As a developer, I want a failed Turn rendered as a failure with its reason,
    so that an answer that stops does not look like an answer that finished.
15. As a developer, I want interrupting a Turn to render as idle rather than as
    an error, so that a stop I asked for is not reported as a problem I have.
16. As a developer, I want to interrupt a running Turn from the composer, so that
    I can stop the agent going down a wrong path.
17. As a developer, I want to type a slash command, so that I can reach the
    runtime's own commands.
18. As a developer, I want a slash menu that filters as I type, so that I can
    discover commands rather than recall them.
19. As a developer, I want slash commands to show their argument hints and
    aliases, so that I know what a command takes before running it.
20. As a developer, I want the slash menu to update mid-Session, so that a skill
    discovered while the agent works in a subdirectory becomes reachable.
21. As a developer, I want to paste a screenshot into the composer, so that I can
    show the agent something rather than describe it.
22. As a developer, I want a pasted image to appear as a marker in my own
    Message, so that the Transcript records what I actually sent.
23. As a developer, I want the agent to be able to put an image into the
    Transcript, so that it can show me a screenshot it captured.
24. As a developer, I want a working line while the agent thinks, showing elapsed
    time and how to interrupt, so that silence is never ambiguous.
25. As a developer, I want the agent's reasoning text kept out of the Transcript
    by default, so that I read conclusions rather than deliberation.
26. As a developer, I want to opt reasoning text back in with a flag, so that I
    can watch the thinking when I am debugging a prompt.
27. As a developer, I want context-window usage surfaced, so that I can see a
    compaction coming rather than discover it afterwards.
28. As a developer, I want subscription rate-limit information surfaced
    separately from context usage, so that two different meters on two different
    clocks are not confused.
29. As a developer, I want the cost of a Turn available, so that I can see what a
    conversation is spending.
30. As a developer, I want what the runtime *actually* loaded — tools, skills,
    plugins, MCP servers — available as data, so that "configured" and "loaded"
    can be told apart.
31. As a developer, I want hook output surfaced, so that a hook firing is visible
    rather than mysterious.
32. As a developer, I want to know why a Turn started that I did not start, so
    that unprompted work is accountable.
33. As a developer reloading the page, I want my Transcript back, so that a
    refresh does not lose the conversation.
34. As a developer whose connection drops briefly, I want the stream to resume
    where it left off, so that I do not lose Frames in the gap.
35. As a host application, I want the Session id emitted as soon as it exists, so
    that I can persist it before anything can interrupt the Turn.
36. As a host application, I want to resume a prior Session by passing its id, so
    that a conversation survives a server restart.
37. As a developer, I want the whole thing themeable through CSS custom
    properties, so that it does not have to look like tokyo-night.
38. As a developer, I want the stylesheet to work without me configuring
    Tailwind, so that installing the package is enough.
39. As a developer, I want to see every surface the package can draw without
    talking to a real agent, so that I can evaluate it in seconds and for free.
40. As a developer, I want to point the playground at a real agent, so that I can
    confirm it works end to end.
41. As a maintainer, I want the Transcript layer regression-tested without a
    credential, so that the test suite runs in CI and in milliseconds.
42. As a maintainer, I want one live test that proves the SDK integration still
    works, so that a version bump breaking it is caught.
43. As a maintainer, I want the vendored components to stay close to upstream
    Brainless, so that taking an upstream fix stays possible.

## Implementation Decisions

### Domain vocabulary

Defined in `CONTEXT.md` and used throughout. A **Frame** is observed — something
that happened agent-side, that nobody proposed. An **Event** is willed —
something a person or the runtime proposed. The **Transcript** is the ordered
list of **Message**s a viewer sees. A **Session** is one resumable conversation,
identified by the SDK's `session_id`. A **Turn** is one prompt-to-result cycle.
A **Thread** is the line of work opened by a `Task` call, identified by that
call's `tool_use` id.

### Four entry points, one package

- `core` — `classify(SDKMessage) → Frame[]` and `reduce(Frame[]) → Transcript`.
  Pure: no clock, no socket, no runtime SDK import. This is what lets the whole
  translation be tested without a credential or a network.
- `server` — the `query()` host, SSE transport, interrupt. Bun-first.
- `react` — `useAgentSession()`.
- `ui` — vendored Brainless components plus the additions below.

### `core` emits the complete Frame vocabulary, losslessly

The governing rule, and the reason the package is reusable: **a missing Frame
forces a consumer to fork the package; a missing component only makes them write
a component.** Those costs are wildly asymmetric. So `classify` emits everything
the SDK says — including harness introspection, rate limits, context tokens,
cost and memory recall — even where v0.1 ships no chrome for it.

### SDK coupling

`core` imports `SDKMessage` as a **type only**, and treats every field as
optional on the way in. A panel must never fail a Turn because the SDK grew a
field. This mirrors forge's `harnessFrom`.

### The Transcript is flat

`reduce` produces a flat list of Messages, each carrying an optional `thread`
(the `Task` call's `tool_use` id); the `Task` Message itself carries what the
Thread is called. Nesting is a rendering decision and is left to the renderer —
a chat can filter Threads out, an activity view can attribute them, and
`ClaudeToolCall`'s existing children slot can nest them. Flat keeps `reduce` to
append-and-patch-the-tail and keeps the log index-addressable, which replay
depends on.

### Streaming is partial on the wire and coalesced in the log

`includePartialMessages` is on, so deltas stream live. The server folds a
block's deltas into one text Frame when the block closes, so the retained log
holds whole Messages. This bounds the log and makes it a deterministic test
fixture rather than a timing-dependent recording.

### The client owns `reduce`

The server ships Frames and keeps an append-only coalesced Frame log; the
browser runs `reduce`. Rejected: forge's server-authoritative Transcript with
suffix patches — that machinery exists to serve multiple simultaneous viewers
over a tailnet, a pressure ADR-0001 and ADR-0002 remove. The chosen shape makes
the Frame log serve four jobs at once: wire format, test fixture, reconnect
mechanism, and playground driver.

### Replay uses SSE's own mechanism

Every SSE event carries `id:` set to the Frame index. A transient drop makes the
browser reconnect with `Last-Event-ID` and resume mid-stream with no client
bookkeeping; a cold reload sends no such header and replays from 0, which is
what a fresh page wants. An explicit `?from=N` is deliberately not built until
Session length makes full replay hurt.

### Diffs come from the SDK

`FileEditOutput` and `FileWriteOutput` already carry `structuredPatch`
(`oldStart`/`oldLines`/`newStart`/`newLines`/`lines`) plus `originalFile` and a
ready-made `gitDiff.patch`. Mapping those hunks onto `ClaudeDiff`'s
`{ type, n?, text }` is mechanical. No file reads, no diff algorithm, and no
race between reading a file and the edit landing.

### The working line is not a reasoning renderer

`ClaudeThinking` is Claude Code's *working line* — sparkle, rotating verb,
elapsed/interrupt hint. It is driven by real Turn state (running, elapsed,
context tokens via its existing `showTokens`). Reasoning **text** is a separate
concern and is kept out of the Transcript by default, opt-in behind a flag,
following varnick: "Thinking is not an answer."

### Vendored components stay presentational

The eight vendored Brainless components keep upstream's contract — props in,
callbacks out, no knowledge of a Session — so re-sync stays possible. The
convenience wrapper `<ClaudeSession session={…} />` is a thin container we
wrote, is not vendored, and therefore carries no drift cost. Each vendored file
records the upstream commit it was taken from. Uncontroversial fixes (optional
`result`, an `onSubmit` prop) are offered upstream so the fork shrinks.

### Styling

Sources stay in Tailwind so they stay diffable against upstream. The package
ships a **precompiled, prefixed** stylesheet, so no consumer Tailwind
configuration is required. Hardcoded tokyo-night hex is lifted into CSS custom
properties.

### Surfaces added beyond Brainless

Thread attribution; a Thread progress meter (description, subagent type, tokens,
tool uses, elapsed); tool elapsed time; tool status; compaction, reset, recall
and failed-Turn markers; pasted-image and agent-shown-image markers; slash hints
with argument hints and aliases; hook output; unprompted-Turn cause.

### Governed by ADRs

ADR-0001 (localhost, single trusted user; the client may not name what runs),
ADR-0002 (one handler, one Session), ADR-0003 (`bypassPermissions` default,
permission bridge deferred).

## Testing Decisions

A good test here asserts **external behaviour at a seam** — given these SDK
messages, this Transcript — and never reaches into how `classify` or `reduce`
got there. Frame kinds and Message shapes are the contract; the accumulation
strategy inside `reduce` is not.

**Primary seam — `SDKMessage[] → Transcript`.** One pure composition, the
highest seam available, and the one carrying most of the weight. Fixture SDK
messages in, expected Transcript out, no credential and no network. The
coalesced Frame log is snapshotted as a golden file *within* this seam, so a
regression localises to "classify changed" or "reduce changed" without being a
second seam anyone writes tests against directly.

**Second seam — `Request → Response` on the handler.** Unavoidably separate,
because SSE framing, per-event `id:` and `Last-Event-ID` resumption cannot be
reached through the pure path. Driven with a fake SDK stream, so still no
credential.

**Third seam — `Transcript → DOM`.** Deliberately thin: render the golden log
through the container and assert every Frame kind produces something. The
components are presentational, so this guards wiring, not appearance.

**One live canary.** Boot the handler, send "say hi", assert a `settled` Frame
arrives. Enough to catch the SDK integration breaking under a version bump,
cheap enough that nobody disables it.

Prior art: forge's `classify.test.ts` and varnick's `turn.test.ts` both drive
fixture `SDKMessage`s through a pure classifier with no network — the same shape
this seam takes.

## Out of Scope

- **Permission prompts.** `canUseTool` bridging and `ClaudePermission` are v0.2,
  and land with an integration test that drives a real approval (ADR-0003).
- **Multi-tenancy and hosted use.** Re-deciding ADR-0001, not a later feature.
- **Session management.** No store, no eviction, no router (ADR-0002).
- **Codex and Grok skins.** Reskins of a data model this package does not
  produce.
- **Chrome for harness, usage and cost.** The Frames ship; the panels do not. The
  harness panel is the highest-value v0.2 item.
- **Agent-driven UI.** forge's MCP `ask` tool, where the agent renders a closed
  block vocabulary with `options` and a marked `recommended`, is the most
  ambitious thing in the prior art and is not v0.1.
- **The quiet/hush filter**, `?from=N` replay, and porting an existing project
  onto the package.

## Further Notes

Brainless is MIT (`theswerd/brainless`, 485★, actively maintained). Vendoring is
attributed in `LICENSE` and per-file.

The known accepted cost: the Frame log is in memory and unbounded across a very
long Session. Coalescing bounds it far better than a verbatim log would, and at
one-Session-localhost scale this is acceptable for v0.1.

The one part of v0.1 carrying a genuine concurrency hazard is the slash menu.
`stream.supportedCommands()` must be *started* when `init` arrives but *awaited
after the stream closes* — awaiting it inside the loop stops messages being
pulled while waiting for a reply on the same transport. Forge hit this; it is
the part most likely to need a second pass.
