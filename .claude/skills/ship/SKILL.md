---
name: ship
description: Work a dependency-ordered ticket backlog to done — resolve the DAG frontier, dispatch implementer sub-agents, run an independent two-axis review, drive bounded fix rounds, merge, then start the next ticket. Use when the user says "ship the tickets", "work the backlog", "run the DAG", or asks for a set of tracker issues to be implemented and merged with minimal involvement.
---

# Ship

You orchestrate; sub-agents implement. You own the frontier, the review, the fix
rounds, the merge, and the decision to continue.

**Never write implementation code yourself.** If you are editing `src/`, stop —
that belongs to a sub-agent. Doing it inline fills the context this skill exists
to protect, and makes you the reviewer of your own work.

Read `docs/agents/issue-tracker.md` for tracker commands, and `CONTEXT.md` plus
`docs/adr/` for vocabulary and constraints. If the tracker doc is missing, run
`/setup-matt-pocock-skills` first.

## 1. Resolve the frontier

A ticket is **ready** when it is open, unassigned, and has zero open blockers.

```bash
gh api repos/<owner>/<repo>/issues/<n> --jq '.issue_dependencies_summary.blocked_by'
```

Zero means ready. Where a tracker has no native dependency edges, parse the
"Blocked by" section and treat a blocker as cleared only once that issue is
closed.

Report the frontier before acting. If it is empty while open tickets remain,
every one is blocked — say so and stop.

## 2. Claim

```bash
gh issue edit <n> --add-assignee @me
git switch -c ticket/<n>-<slug>
```

Record the merge-base. It is the fixed point step 4 reviews against.

## 3. Dispatch an implementer

Spawn one sub-agent per ticket using the implementer brief in
[BRIEFS.md](BRIEFS.md).

**`/implement` is not available to sub-agents, and must not be worked around.**
It sets `disable-model-invocation: true`. Calling it — bare or namespaced —
returns an error stating it is reserved for explicit user invocation and
instructing the caller *not to replicate its workflow by other means*. So the
brief carries this skill's own working agreement rather than a copy of
`/implement`'s, and tells the sub-agent not to go read that skill file either.

If you want `/implement`'s workflow specifically, **you** must run `/implement`
yourself — but that puts implementation in the orchestrator's context, which is
what this skill exists to prevent.

`/tdd` and `/code-review` are model-invocable and stay real calls.

**Parallelism.** When the frontier holds more than one ready ticket, fan out —
one sub-agent each, every one with `isolation: "worktree"`. Without worktree
isolation parallel implementers overwrite each other. Merging stays serial
regardless.

## 4. Review independently

When a sub-agent reports done, **you** run the review:

```
/code-review <merge-base>
```

The reviewer must not be the implementer. `/implement`'s contract ends by
telling the implementer to review its own work; that is the one line this skill
deliberately overrides, because a self-review inherits every assumption that
produced the bug.

`/code-review` locates the spec through issue references in commit messages. If
the implementer's commits do not say `Closes #<n>`, the Spec axis silently
degrades to "no spec available" — check for that before trusting a clean review.

## 5. Fix rounds — bounded

Send findings to the **same** sub-agent via `SendMessage`, so its context is
intact. Use the fix brief in [BRIEFS.md](BRIEFS.md).

**Maximum two fix rounds**, then stop and escalate with what remains. An
unbounded review-fix loop is how this burns a day.

Not every finding must be fixed. Standards-axis smells are judgement calls — you
may accept one, but say so in the merge commit. A Spec-axis finding is different:
something the ticket asked for and did not get is not acceptable.

## 6. Merge and close

Check the acceptance criteria in the ticket body yourself, merge, then:

```bash
gh issue close <n> --comment "<what shipped>"
```

## 7. Repeat

Recompute the frontier — closing a ticket unblocks its dependents — and
continue.

## Stop and ask the user

- The frontier is empty while open tickets remain
- Two fix rounds did not clear a Spec-axis finding
- A finding contradicts an ADR — surface it, never silently override
- Acceptance criteria cannot be met as written (the spec is wrong, not the code)
- **Anything outward-facing**: publishing a package, deploying, force-pushing,
  rotating a secret. Explicit approval each time — approval for one is never
  approval for the next.
