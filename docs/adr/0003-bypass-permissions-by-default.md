# `bypassPermissions` is the default, and the permission bridge is deferred

The handler defaults to `permissionMode: 'bypassPermissions'` — tools execute
without asking. `ClaudePermission` is not vendored, and the SDK's `canUseTool`
is not bridged to any UI in v0.1.

This is surprising for a published package, so: the sole user of v0.1 runs
`bypassPermissions` in every project already, and a default nobody uses is a
default that lies about how the thing is actually operated. ADR-0001 is what
makes it defensible — a single trusted user on localhost is exactly the setting
in which forge reached the same conclusion, for the same reason.

Note these are two different boundaries and conflating them would be the
mistake. ADR-0001 governs *who can reach the server*. This governs *whether a
human sees `rm -rf` before it runs*. Answering the first does not answer the
second; we are answering the second on operator preference, not on security
grounds.

## Considered options

Building the bridge with the option defaulted off was the obvious middle
ground, and it was rejected on rot: a path the only user never exercises by
hand breaks silently, and then "turn permissions on" does not work six months
later when it is wanted. Shipping a bridge nobody has watched work is worse than
shipping none, because it reads as a supported feature.

## Consequences

Adding permissions in v0.2 must come with an integration test that drives a real
approval — that test is the entry price, not a nice-to-have. Until then the
docs must say plainly that permission prompts do not exist, rather than
describing a flag, because "why is my permission UI never showing" is otherwise
a nasty afternoon.
