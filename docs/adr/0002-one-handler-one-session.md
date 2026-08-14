# One handler, one Session

`createAgentHandler()` serves exactly one Session. It takes `resume: sessionId`
in and emits a `session` Frame out the instant `init` arrives; persisting that
id and routing between Sessions is the host application's job. There is no
session manager, no store, and no persistence seam.

## Considered options

The rejected alternative was a keyed session manager owning a set of Sessions,
which is what you would reach for given that resume is a headline feature. The
argument for it is real: the session id must reach durable storage *before*
anything can interrupt the Turn, and forge learned that the hard way — a crash
before the first Turn ended left `sessionId: null` on disk and the conversation
came back with a transcript the agent had no memory of. A manager would let the
package solve that once for everybody.

We chose the smaller surface anyway. A manager makes this a framework — it has
to own storage, eviction, and concurrency, and every consumer inherits opinions
about all three. One-handler-one-Session makes it a library: the host already
has a database and a router, and handing it an id to store is a smaller ask than
handing it a lifecycle to adopt.

## Consequences

The `session` Frame becomes load-bearing rather than informational — it is now
the *only* channel by which a host learns the id it must persist, so it must be
emitted at `init` and never deferred to the `result` message. Multi-Session
applications construct multiple handlers and route between them themselves.
