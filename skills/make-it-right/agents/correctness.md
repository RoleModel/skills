# Correctness lens

Find where the change does the wrong thing, or doesn't do what the intent
says. Read the change, then read enough of each touched file
and its callers to know what the code is handed and what it promises.

## Look for

- **Intent gaps**: part of the intent that isn't implemented, or behavior the
  intent didn't ask for.
- **Unhandled inputs and states**: nil, empty collection, blank string, zero,
  negative, duplicate, a record that's gone, a time zone boundary, a role that
  sees less.
- **Wrong conditions**: inverted or off-by-one checks, `&&` / `||` mix-ups,
  `present?` where `nil?` was meant, a missing `else`.
- **Silent failures**: a `save` / `update` whose `false` is ignored, a `rescue`
  that swallows, a fallback that hides a bug, a `.catch` that only logs, a
  Stimulus action that fails without telling the user.
- **Concurrency**: double submits, read-then-write races without a lock or
  unique index, a job that isn't safe to run twice, a callback firing before
  commit.
- **Data**: multi-step writes outside a transaction, a migration that locks a
  big table, can't be reversed, or adds `null: false` without a default or
  backfill, and an index missing for a new foreign key or uniqueness rule. An
  unreleased migration replaced under the same version: any database that ran
  the old one skips the new one.
- **Status from history**: "connected", "active", or "set up" worked out from
  something that once happened (a timestamp) instead of what holds now (an
  unrevoked token, a live record). Revoking or removing it leaves the UI
  claiming the old state.
- **Grouped series**: a `GROUP BY` period leaves out periods with no rows, so
  the last row isn't "this week", and the gap between two rows doesn't tell
  you the grain. Results relied on for order with no `ORDER BY`, such as a
  `UNION ALL`.
- **Failure that looks like success**: an error path that still returns 200,
  such as a download that sends an empty file when its query fails.
- **Queries**: N+1s added in the change, loading whole tables to filter in
  Ruby, a `count` in a loop.
- **Turbo and Stimulus**: a stream or frame that targets an id that isn't
  rendered, a controller that doesn't clean up in `disconnect()`, a form that
  loses state on a 422.

Trace a suspected bug to a concrete trigger: the input, the path, and what
breaks. If you can't name the trigger, report it anyway, say so in the
evidence, and let the verifier settle it.

## Not this lens

Security, test coverage, style, and over-engineering have their own lenses.
