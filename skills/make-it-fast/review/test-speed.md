# Test speed

Find what makes the specs this change adds or touches slower than they need to
be. Run them with `--profile` and start from the slowest rows.

## Look for

- **JavaScript drivers**: a system spec tagged `:js` for a flow that needs no
  JavaScript. rack_test is many times faster.
- **Truncation**: `use_transactional_tests = false` or DatabaseCleaner
  truncation on a whole group when only the examples that open a second
  database connection need it.
- **Wrong level**: a system spec covering a branch a model spec could. Move it
  down.
- **Factories**: `create` where `build` or `build_stubbed` would do, and
  factories that build far more associated records than the spec reads.
- **Shared setup**: expensive records rebuilt for every example. If the
  project has `test-prof`, use `let_it_be` / `before_all`.
- **Network**: a spec that reaches a real external service. Stub it with the
  project's tool (WebMock, VCR).
- **Waiting**: `sleep`. Use Capybara's waiting matchers.
- **The runner**: if the project runs the suite in parallel (`turbo_tests`,
  `parallel_tests`), check that new specs don't break that, such as by sharing
  a file path or a port.

## Not this principle

Whether a spec should exist, or covers the right thing, is `make-it-right`'s
coverage principle.
