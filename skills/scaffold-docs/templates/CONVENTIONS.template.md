# Conventions

Read the entries below, then the files relevant to the task. `AGENTS.md` explains when.

## What belongs in a convention file

Two things only:

1. **The way this project does something** — e.g. we write system tests rather than controller tests.
2. **Taste** — e.g. no custom controller actions; no business logic in templates.

State the rule, and the why only where the rule looks arbitrary without it. Keep each file to a screen.

**Never restate the implementation.** Signatures, argument lists, required attributes, and step-by-step walkthroughs belong in the code, which reads more easily and can't go stale. The same goes for anything a manifest, lockfile, or schema already states — version numbers above all. Name the file that holds the answer instead of copying the answer. A gotcha earns a line when it's a fact about the _world_ — how a library behaves, a database rule, an API that contradicts its own docs — that the code can't tell you on sight.

Each entry may carry a `<!-- paths: glob, glob -->` comment. The `surface_conventions.rb` PreToolUse hook reads these to surface a convention when a matching file is edited, so keep them accurate. Globs are matched with Ruby's `File.fnmatch?` in pathname mode against the repo-relative path: `**/` spans any number of directories including none, `{rb,erb}` alternates, and a bare `*` stops at a `/`.

## Index

Entries take the shape below. A real one begins with a literal `- [` at the start of the line and carries no backticks — this example is wrapped in them so the hook skips it, so write a fresh line rather than unwrapping this one. Delete the note once real entries land.

`- [Title](conventions/slug.md) — what it covers. <!-- paths: app/models/**/*.rb -->`

The hook reads the separator after the link — an em dash, or a hyphen — and skips any entry whose `conventions/<slug>.md` is missing, so a renamed or deleted file stops surfacing rather than surfacing wrongly.
