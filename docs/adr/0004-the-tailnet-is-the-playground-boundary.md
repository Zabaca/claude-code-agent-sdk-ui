# The tailnet is the playground's boundary, and the playground is not the package

The playground — `bun run dev`, `example/server.ts` — is served on the tailnet
at `https://ryzen-9.tail18440.ts.net:8805`, declared in `scripts/tailnet.ts` and
converged by `bun run tailnet`. The process still binds `127.0.0.1`; what
changed is that tailscaled proxies to it.

This re-decides [ADR-0001](./0001-localhost-single-user-threat-model.md), which
said localhost and said the dangerous failure mode is someone believing it is
safe to mount further out. It re-decides it **for the playground only**.
`createAgentHandler` is unchanged, still accepts no `cwd`, `tools`,
`permissionMode` or `systemPrompt` from a client, and ADR-0001 still governs the
published package in full.

## What it costs, stated plainly

The playground's `/agent` route runs the Agent SDK with
`permissionMode: 'bypassPermissions'` ([ADR-0003](./0003-bypass-permissions-by-default.md))
and `cwd` set to this repo. There is no permission bridge in v0.1 — that is the
whole of ADR-0003. So **every device on the tailnet can run arbitrary commands
as the operator user, in this checkout, without anything asking first.**

The tailnet is therefore the entire authentication boundary. There is no second
login behind it. That is the same position forge reached in its ADR-0004, and it
holds exactly as well as the tailnet's membership does — which on this tailnet
includes tagged devices rather than only people: `agent-vm` and `vultr`, the
latter a public VPS offering an exit node. Tagging a machine into the tailnet is
now a decision about who can run commands here.

## Considered options

**Leave it on localhost and forward a port over SSH.** The status quo, and it
costs nothing to keep. Rejected because it is a per-session ritual on every
device, and the thing being asked for is to open the playground on a phone or a
second machine without one — a boundary people route around is a boundary that
stops describing what happens.

**Serve the page but not `/agent`,** so `?mode=replay` works and live mode 404s.
Genuinely appealing: replay drives the whole surface off a Frame log with no
credential, no SDK and no command execution, so it makes the UI shareable at
zero risk. Rejected because the point of reaching it from a phone is to use it,
and a demo that cannot run a Turn is a demo of the components — which is what
Brainless already was.

**Funnel instead of Serve.** Rejected outright, and the tooling refuses it rather
than leaving it to discipline: Funnel publishes the same handler to the whole
internet, and it is one flag away in the same subcommand. Given what `/agent`
does, that flag is the difference between a stated boundary and none.

## Consequences

The route is declared rather than remembered. `tailscale serve` config lives in
tailscaled's state and outlives reboots, so a route created by hand is a surface
nothing in the repo accounts for — foundry's ADR-0016 exists because exactly
that happened to another service. `scripts/tailnet.ts` owns this one port,
leaves every other route alone, and its test names what is declared.

**Narrowing the ACL is the outstanding half of this.** The tailnet is the
boundary, and today that means every device on it. The policy file lives in
foundry, not here, so the follow-up is a grant scoping `:8805` on this node to
the operator's own devices rather than to `tagged-devices`. Until that lands,
this ADR's boundary is wider than it should be, and it is written down here so
that is a known state rather than a discovered one.

Turning the sharing off is one command and does not need this ADR revisited:
`tailscale serve --https=8805 off`. Revisiting is for changing what is behind
it — a permission bridge (ADR-0003's v0.2) would make this a much smaller
decision, and is the thing that would let the boundary be something other than
"everyone who can reach the node".
