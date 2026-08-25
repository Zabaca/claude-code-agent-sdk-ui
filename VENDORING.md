# VENDORING — this library is **EDITED FREELY** by whoever vendors it

`Zabaca/claude-code-agent-sdk-ui` is meant to be taken as a **git subtree with
its full history**, not installed. This file travels with the code, so it is
here in the library's own repo and again inside every directory that vendors it.
It says the same thing in both places.

## Change files in it

That is the point. A consumer renders these components, and somebody who finds a
bug in one while building against it should fix it where it lives instead of
working around it in a wrapper. The library is unpublished at `0.0.0`; the repos
that vendor it are where it is developed.

Its own test files run inside the consuming repo's suite. A change that breaks
the library goes red there, which is the intended cost and the reason editing in
place is safe rather than reckless.

## It is consumed as source, and that is a fact rather than a preference

Consumers alias the package's public entry points onto `src/`, so an import
naming the package resolves to a file with no build step in between.

It is **not** a git dependency, and cannot casually become one: `dist/` is
gitignored and the package declares `prepack`, not `prepare` — and bun runs
`prepare` for git dependencies. A git dep therefore installs a package whose
`exports` map points at files that do not exist.

Two consequences worth knowing before reaching for a shortcut:

- A consumer whose bundler reads `tsconfig.json` paths gets this for free; one
  that does not — vite, for instance — has to be told the same aliases
  explicitly, or resolution fails in a way that looks like a missing dependency.
- Editing in place needs no publish, no version bump and no install.

## Sending a fix home

When a change is general rather than one consumer's taste:

    git subtree push --prefix=<the vendored path> git@github.com:Zabaca/claude-code-agent-sdk-ui.git <branch>

Consumers usually wrap that in a script. Push to a branch, open a pull request,
and merge it there like any other change. Taking the subtree with full history is
what lets that split produce real commits rather than one squashed blob.

**Do this often.** The route home is the only thing separating a subtree from a
permanent fork — and the cost of not doing it compounds quietly: the first trip
home from one consumer carried thirteen commits, because nobody had made one
since that repo was created.

## What does not belong in here

Anything true of one consumer and not of the library. A rule about *this*
directory's place in *that* repo, a path only that repo has, a sibling subtree
governed by the opposite rule — each is correct where it was written and
nonsense once the subtree pushes it to the library's own root. Whatever the
consuming repo needs to say about how it vendors this belongs in the consuming
repo, outside the vendored directory.
