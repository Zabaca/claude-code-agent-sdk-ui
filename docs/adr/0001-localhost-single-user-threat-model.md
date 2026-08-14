# Localhost, single trusted user — and the client may not name what runs

This package streams the Claude Agent SDK's `query()` to a browser, which is
remote code execution wearing a UI. We target a single trusted user on
localhost, and the server therefore **never** accepts `cwd`, `tools`,
`permissionMode` or `systemPrompt` from the client — there is no option to, so
the boundary is enforced by the API's shape rather than by documentation
somebody skips.

## Considered options

All three prior implementations run somewhere trusted — varnick is a desktop
app, forge is on a tailnet, cedarpad is behind auth — and forge's ADR-0004 is
blunt that its boundary *is* the tailnet. The alternative was a general-purpose
handler that takes its configuration from the request, which would be more
flexible and would make the package usable as a hosted multi-tenant service.

We rejected it because we cannot honour the promise it implies. The dangerous
failure mode is not a compromised server; it is a user who reads "npm package"
and believes it is safe to mount on a public route. A configuration surface the
client can reach is exactly what would make that belief plausible.

## Consequences

Multi-tenant use is not a v-next feature to be added later — it would require
re-deciding this. Anyone needing it should put their own trust boundary in
front, and own it.
