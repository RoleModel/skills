# Data patterns

Find where the change stores, changes, or reads data in a way that will
corrupt it, lose it, or tell the user something false. Read the migrations,
models, and queries the change touches, and the generated schema snapshot.
The stack map's "Data" names them for this stack; its "Org defaults" are the
house rules, overridden by the Rule sources.

## Look for

- **Transactions**: multi-step writes outside a transaction, so a failure
  halfway leaves half the data.
- **Concurrency**: double submits, read-then-write races without a lock or a
  unique index, a job that isn't safe to run twice, a hook that runs before
  the transaction commits.
- **Migrations**: one that locks a big table, can't be reversed, or adds a
  not-null constraint without a default or backfill. An index missing for a
  new foreign key or uniqueness rule. An unreleased migration replaced under
  the same version: any database that ran the old one skips the new one. A
  deployed migration edited. A data migration or backfill that writes rows it
  doesn't own, such as overwriting values the app already set, or a rollback
  that undoes more than the migration did.
- **Schema snapshot**: changes beyond what this change's migrations add, such
  as reordered columns or tables from another branch.
- **Status from history**: "connected", "active", or "set up" worked out from
  something that once happened (a timestamp) instead of what holds now (an
  unrevoked token, a live record). Revoking or removing it leaves the UI
  claiming the old state.
- **Grouped series**: a `GROUP BY` period leaves out periods with no rows, so
  the last row isn't "this week", and the gap between two rows doesn't tell
  you the grain. Results relied on for order with no `ORDER BY`, such as a
  `UNION ALL`.
- **Hidden one-to-many**: columns on a record that hold "the" X when a user
  can have several, so a second X overwrites the first. That's a child table.
- **Branching on a kind**: `if kind == 'x'` in more than one place, or a
  lookup constant plus view branches for each variant. Each variant's data
  belongs in one object read from config, so the next variant is one entry,
  not a hunt.
- **Coded values**: a code stored as a bare integer, or accepted without
  validation, so a reorder or a bad write silently changes its meaning.

## Not this principle

Slow queries go to `make-it-fast`: tag them `fast:`. Who may read the data
goes to security.
