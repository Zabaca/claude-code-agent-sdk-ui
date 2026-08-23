# vendor/agent-sdk-ui — EDITED FREELY

This directory is a git subtree of **`Zabaca/claude-code-agent-sdk-ui`**, taken
from `main` with its full history.

**Change files in here.** That is the point. agent-lab renders these components,
and an agent that finds a bug in one while building a Pane should fix it where
it lives instead of working around it in a wrapper. The library is unpublished
at `0.0.0`, and this repo is where it is developed against.

It is consumed as **source**, through a path alias in `tsconfig.json` that maps
the package's public entry points onto `vendor/agent-sdk-ui/src/`. An import
naming the package resolves to the file, with no build step in between. It is
not a git dependency, and that is a fact rather than a preference: the library's
`dist/` is gitignored and it declares `prepack`, not `prepare` — and bun runs
`prepare` for git dependencies, so a git dep installs a package whose `exports`
map points at files that do not exist.

Its own ~36 test files run in this repo's suite. A change here that breaks the
library goes red, which is the intended cost.

## Sending a fix home

When a change is general rather than agent-lab's own taste:

    bun run upstream:ui <branch>

which is `git subtree push --prefix=vendor/agent-sdk-ui` to the library's
remote. Added with full history precisely so that split can produce real
commits. Push to a branch and merge it there like any other change.

Do this often. The route home is the only thing separating a subtree from a
permanent fork.

## The other subtree does not work like this

`vendor/zbc/` is governed by the opposite rule — read
[its own VENDORING.md](../zbc/VENDORING.md) before touching anything in it.
`docs/adr/0002-two-vendored-subtrees-with-opposite-rules.md` is the decision.
