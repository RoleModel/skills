# Readability

Find what makes the next reader slow down. The code should say what and how on
its own.

## Read each file whole first

Before going line by line, read each new or heavily changed file once, top to
bottom. Report it as a finding when you can't say what the file does in one
sentence, or when it mixes kinds of logic a reader has to hold at once, such as
job flow, retry policy, and view rendering in one class. Name what should move
out and where.

## Look for

- **Names**: names that say how instead of what, jokes or shorthand, or names
  that no longer match the behavior after this change.
- **Comments**: a comment earns its place only by saying what the code can't:
  why a non-obvious choice was made, a constraint from outside the code, or a
  link to the issue behind a workaround. Report as `low`:
  - Comments that restate the code, or explain what reading it already shows.
  - Comments that narrate the change ("now uses X", "added for Y", "fixed").
    Agent-written code is full of these.
  - Commented-out code.
  - Section dividers and banners in short files.

  Report a comment that is **wrong** about the code as `medium`.
- **Shape**: an empty branch (`if !x` with nothing under it, then an
  `else if`). Nest the rest under one positive `if`. Double negatives, and
  conditions that need a truth table to read.
- **Logic in views**: a view that works out state (counters, flags, the
  smaller of two values) before it renders. Move it to whatever the project
  uses to prepare view data, so the view only loops and prints.
- **Same thing, fewer lines**: a rewrite that keeps behavior and reads faster.
  Tag it `shrink:` with the lines saved.

## Not this principle

Code that shouldn't exist, or belongs on another object, goes to maintainable.
