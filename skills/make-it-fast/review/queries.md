# Queries

Find database work the change makes slower or larger than it needs to be.
Count the queries a request or job runs, from the log or with
`ActiveSupport::Notifications`, rather than timing them on dev-sized data.

## Look for

- **N+1s**: a query per row, from an association read in a loop or a view
  without `includes` / `preload`. Show the repeated log lines.
- **Filtering in Ruby**: whole tables loaded to `select`, `sort_by`, or `sum`
  in Ruby when SQL could do it.
- **Counts**: `count` in a loop, or `.count` on a loaded association where
  `size` would use what's in memory. A count shown on every row of a list
  wants a counter cache.
- **Missing indexes**: a new foreign key, uniqueness rule, or column the
  change filters or sorts by with no index. For a new scope on a big table,
  read `EXPLAIN` and report a sequential scan.
- **Unbounded lists**: a query with no `limit` behind a page that lists
  records. Paginate it.
- **Big loops**: `each` over a relation that can hold thousands of rows. Use
  `find_each` / `in_batches`.
- **Existence checks**: `present?` or `any?` on an unloaded relation, which
  loads rows to answer yes or no. Use `exists?`.
- **`pluck`**: suggest it only when the code clearly needs one or two columns,
  such as `:id, :name` for a select box. Loading whole records is fine
  otherwise.

## Not this principle

Request time spent outside the database goes to requests. Data that's wrong,
not slow, goes to `make-it-right`.
