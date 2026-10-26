---
applyTo: "<globs over the trees agents edit — e.g. app/**/*,spec/**/*,db/migrate/**/*,lib/**/*,config/**/*>"
---

# <Project Name> conventions

<AGENTS.md's opening sentence, plus what ignoring it costs — e.g. "Multi-tenant:
an unscoped read or write is a tenant-isolation bug, not a style nit.">

`docs/CONVENTIONS.md` is the source of truth for this repo's conventions. Each entry
carries a `<!-- paths: ... -->` comment naming the files it applies to. Read the
convention files whose paths match what you're changing, and follow what they say —
not the one-line index summary.

The branch name or PR title carries a ticket ID like `ABC-123`. Whenever the `linear`
MCP server is connected, fetch that issue with `linear-get_issue` and read its
description and acceptance criteria before writing or reviewing code — every time,
not only when something looks off. Flag changes that contradict the ticket and
requirements the diff doesn't address. No ID, or no server: work against these
conventions alone and don't block on it.

Prefer minimal, focused changes. Speculative refactors, new abstractions, and
defensive handling for cases that can't occur are not improvements.
