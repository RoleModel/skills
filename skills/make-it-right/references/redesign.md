# Redesign gate

A `redesign:` finding proposes a different data model or flow that makes a
class of bugs impossible. Maintainable raises it; the verifier passes it when
it makes at least two findings moot and fits the code (it skips the 80 bar).
Handle a passed one before fixing anything else:

- `redesign=ask` (default): stop and ask the user. Give the simpler shape, its
  cost, and the kept findings it makes moot. On no, fix the rest and list the
  redesign under "Not fixed". This is the only place the run waits on the user.
- `redesign=apply`, or a yes: make the redesign first, as its own pass with
  specs written to `test/coverage.md`. Drop the findings it made moot,
  re-verify the rest against the new code, then fix the rest. Round 2 covers
  the redesign's hunks. Report it first, with what it replaced.
