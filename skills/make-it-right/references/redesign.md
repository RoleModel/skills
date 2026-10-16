# Redesign gate

A `redesign:` finding proposes a different data model or flow that makes a
class of bugs impossible. Maintainable raises it; the verifier passes it when
it makes at least two findings moot and fits the code (it skips the score).
Handle a passed one before fixing anything else:

- `redesign=ask` (default): stop and ask the user. Give the simpler shape, its
  cost, and the kept findings it makes moot. On no, fix the rest and report it
  as `Redesign: declined`. This is the only place the run waits on the user.
  Under `report-only`, don't ask: put it under "Look here".
- `redesign=apply`, or a yes: with the step 4 snapshot already taken, make
  the redesign first, as its own pass, with
  specs at the levels `test/coverage.md` sets. Drop the findings it made moot,
  launch the verifier again on the rest against the new code, then fix the
  rest. Round 2 covers the redesign's hunks. Report it as `Redesign: applied`,
  with what it replaced.
