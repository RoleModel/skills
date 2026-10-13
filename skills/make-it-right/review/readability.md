# Readability

Find what makes the next reader slow down. The code should say what and how on
its own.

## Look for

- **Names**: names that say how instead of what, jokes or shorthand
  (`_can_cant`), or names that no longer match the behavior after this change.
- **Comments**: a comment earns its place only by saying what the code can't:
  why a non-obvious choice was made, a constraint from outside the code, or a
  link to the issue behind a workaround. Report as `low`:
  - Comments that restate the code, or explain what reading it already shows.
  - Comments that narrate the change ("now uses X", "added for Y", "fixed").
    Agent-written code is full of these.
  - Commented-out code.
  - Section dividers and banners in short files.

  Report a comment that is **wrong** about the code as `medium`.
- **Shape**: an empty branch (`- if !ai` with nothing under it, then
  `- elsif`). Nest the rest under one positive `if`. Double negatives, and
  conditions that need a truth table to read.
- **Logic in views**: a view that works out state (counters, flags, a
  `[x, y].min`) before it renders. Move it to a helper or presenter that
  returns what to show, and let the view loop over it.
- **Same thing, fewer lines**: a rewrite that keeps behavior and reads faster.
  Tag it `shrink:` with the lines saved.

## Not this principle

Code that shouldn't exist, or belongs on another object, goes to maintainable.
Style a linter enforces isn't a finding.
