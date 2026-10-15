# Data patterns

Find where the change stores, changes, or reads data in a way that will
corrupt it, lose it, or tell the user something false. Read the migrations,
models, and queries the change touches, and `db/schema.rb`.

`<SKILL_DIR>/references/rails-standards.md` holds RoleModel's defaults for
enums, migrations, and per-variant data. Cite it as
`rails-standards: <heading>`.

## Look for

- **Transactions**: multi-step writes outside a transaction, so a failure
  halfway leaves half the data.
- **Concurrency**: double submits, read-then-write races without a lock or a
  unique index, a job that isn't safe to run twice, a callback that fires
  before commit.
- **Migrations**: one that locks a big table, can't be reversed, or adds
  `null: false` without a default or backfill. An index missing for a new
  foreign key or uniqueness rule. An unreleased migration replaced under the
  same version: any database that ran the old one skips the new one. A data
  migration or backfill that writes rows it doesn't own, such as overwriting
  values the app already set, or a `down` that undoes more than its `up` did.
- **`db/schema.rb`**: changes beyond what this change's migrations add, such
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
  can have several, so a second X overwrites the first. That's a `has_many`
  table.
- **Branching on a kind**: `if kind == 'x'` in more than one place, or a hash
  constant plus view branches for each variant. Each variant's data belongs
  in one object read from config, so the next variant is one entry, not a
  hunt.
- **Enums**: integer-backed, or missing `validate: true`.

## Not this principle

Slow queries go to `make-it-fast`. Who may read the data goes to security.
