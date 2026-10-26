# Acceptance

Find where the change doesn't do what it was meant to, or does something
nobody asked for. Read the change, then enough of each touched file and its
callers to know what the code is handed and what it promises. Run specs or the
app to confirm a suspicion when reading can't settle it; the Commands file
says how.

## Criteria

If you were given acceptance criteria, check each one. For each, report met
(with the spec, line, or run that shows it) or not met. A criterion with no
evidence either way is not met.

## Look for

- **Intent gaps**: part of the intent that isn't built, or behavior the intent
  didn't ask for. Check the intent against the codebase, not only the diff:
  search for every place the concept the intent names already lives, such as
  a sibling class with the same constant or a second screen that shows the same
  value. A place the diff skipped is a gap unless the intent excludes it. When
  the intent mentions scale, ask when the data stops changing: computing a
  value once at that point may meet the intent where caching can't.
- **Unhandled inputs and states**: nil, empty collection, blank string, zero,
  negative, duplicate, a record that's gone, a time zone boundary, a role that
  sees less.
- **Wrong conditions**: inverted or off-by-one checks, `&&` / `||` mix-ups, a
  blank check where a nil check was meant, a missing `else`.
- **Silent failures**: a write whose failure return is ignored, an exception
  swallowed, a fallback that hides a bug, a rejected promise that only logs,
  a client-side action that fails without telling the user.
- **Failure that looks like success**: an error path that still returns 200,
  such as a download that sends an empty file when its query fails.

Trace a suspected bug to a concrete trigger: the input, the path, and what
breaks. If you can't name the trigger, report it anyway, say so in the
evidence, and let the verifier settle it.

## Output

The criteria list first (`met` / `not met` and the evidence), then findings in
the `findings.md` format. An unmet criterion is also a finding.

## Not this principle

Missing specs go to coverage. Callers the change might break go to blast
radius. Data integrity goes to data patterns.
