# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` and one `docs/adr/`, both at
the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If either is missing, **proceed silently**. Don't flag their absence; don't
suggest creating them upfront. The `/domain-modeling` skill creates them lazily
when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-localhost-single-user-threat-model.md
│   └── 0002-one-handler-one-session.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a
hypothesis, a test name — use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

This repo's glossary is unusually load-bearing, because two of its terms are a
deliberate split that is easy to collapse by accident:

- A **Frame** is observed; an **Event** is willed. Calling a Frame an "event"
  loses the distinction the whole data flow is built on.
- **Transcript**, not "timeline" or "feed".

If the concept you need isn't in the glossary yet, that's a signal — either
you're inventing language the project doesn't use (reconsider) or there's a real
gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0002 (one handler, one Session) — but worth reopening
> because…_
