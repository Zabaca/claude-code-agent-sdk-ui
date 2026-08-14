# Sub-agent briefs

Pass verbatim, placeholders filled. Both go to `subagent_type: "general-purpose"`.

## Implementer

Spawn with a name you can address later — `impl-<ticket-number>` — so fix rounds
reach the same agent with its context intact. Add `isolation: "worktree"` when
running more than one implementer at a time.

```
You are implementing ticket #<n> in <repo-name>.

Workspace: <abs-worktree-path>
Branch: <branch-name> (already created and checked out — do not create another)

## cwd handling
Sub-agent Bash sessions do NOT persist cwd across calls. For every Bash call,
either prefix with `cd <abs-worktree-path> && ...` or use absolute paths. Never
rely on a prior `cd` having stuck.

## Read first
- `CONTEXT.md` — the domain glossary. Use its vocabulary in names, tests and
  commit messages. Where it lists a term under `_Avoid_`, do not use that term.
- `docs/adr/` — read any ADR touching what you are about to change. If your work
  would contradict one, STOP and report it rather than proceeding.
- The ticket body below.

## The ticket
<paste the full issue body: What to build, Acceptance criteria, Blocked by>

## How to work
Build what the ticket's acceptance criteria describe, and stop there.

Invoke `/tdd` and work test-first at the seams the spec already names. Those
seams are pre-agreed — prefer them to new ones. If you need a seam that does not
exist, propose it in your report rather than inventing one silently.

Typecheck as you go. Run the single test file you are working on as you go, and
the full suite once before you report.

Commit to the current branch as you complete coherent pieces of work. Do not
leave everything for one commit at the end — the review reads your commits.

## Do not reach for /implement
`/implement` is `disable-model-invocation: true`. Calling it returns an error
telling you it is reserved for explicit user invocation, and instructing you not
to reproduce its workflow by other means. Do not call it, and do not go read its
skill file to follow it indirectly. The paragraph above is this skill's own
working agreement and is all you need.

## Commit discipline
Every commit message must reference the ticket: end the body with `Closes #<n>`.
The review step finds the originating spec through this reference; without it,
the review silently reports "no spec available" and the spec axis is lost.

## Do NOT
- Push, open a PR, merge, publish, deploy, or touch secrets. The orchestrator
  owns everything that leaves this machine.
- Review your own work or call /code-review. An independent review runs after
  you report.
- Start or kill long-lived dev servers. One-shot commands (build, typecheck,
  test) are yours; anything that binds a port and stays up belongs to the
  orchestrator.
- Work on any ticket but this one, however tempting an adjacent fix looks.

## Reporting
When done or blocked, report TERSELY: done / blocked / what you changed at a
file-and-purpose level / anything the orchestrator must decide. No raw logs, no
file dumps, no tool transcripts. If the orchestrator wants an excerpt it will
ask.
```

## Fix round

Send to the existing implementer via `SendMessage(to: "impl-<n>", ...)`. Do not
spawn a new agent — a fresh one would re-read everything the first already knows.

```
Review findings on your work for ticket #<n>. Round <k> of a maximum 2.

## Must fix — Spec axis
<findings: the ticket asked for it and it is missing, partial, or wrong>

## Consider — Standards axis
<findings: judgement calls. Fix what you agree with; push back in your report on
what you do not, with a reason.>

## Accepted, do not change
<any finding the orchestrator has decided to accept as-is>

Re-run typecheck and the full suite before reporting. Commit with `Closes #<n>`
as before. Report terse: what you fixed, what you pushed back on and why.
```
