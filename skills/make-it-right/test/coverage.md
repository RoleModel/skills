# Coverage

Specs are what let a human trust this change without reading every line. Find
the behavior no spec would catch breaking, the specs written at the wrong
level, and the specs that only test the framework or a library.

The question for every behavior is whether a spec would **fail** if it
regressed. Line coverage doesn't answer that. Run the specs the change adds
(the Commands file says how); one that passes with the new branch disabled is
a weak assertion.

Follow the test conventions skill the stack map's "Leans on" names, if you
were given it, for test data, shared setup, and browser driving. The levels
below take precedence over it.

## The right level

| Seam | How many | What belongs there |
|---|---|---|
| **User-facing flow** | One happy path per flow | The user does the main job start to finish, in the browser, and sees it worked. Not every branch. The UI/UX principle walks the branches. |
| **Boundary with no UI** | Very few | Only what neither a flow spec nor a unit spec can reach: JSON and API responses, webhooks, status codes and redirects with no UI, an authorization denial that has no screen. |
| **Domain unit** | Most of the suite | Every rule the change adds to a domain object: each branch of each method, custom validations, scopes with logic, hooks with effects, calculations, state transitions, and their edges (nil, empty, zero, boundaries, duplicates). |

The stack map's "Test levels" gives each seam its local name and directory;
use those names in findings.

Push behavior down. A branch tested at the flow or boundary seam that a unit
spec could cover should move to a unit spec. If the logic can't be reached
from a unit spec because it lives in the request or presentation layer, say
so: that's a `move:` for maintainable, and the verifier merges it.

## Not framework or library tests

A spec that asserts a framework or library does what its docs say, with no
app logic in between, is `delete:` (no name search needed; it's a spec).
The stack map's "Framework tests to delete" lists the usual ones: declared
relations and plain built-in validations with no condition, that an auth or
permission library does its documented job, that a route exists or a template
renders or a factory is valid when nothing else would break, and stubbing a
method then asserting the stub was called.

Test the app's **use** of those tools: a conditional validation, the
permission rules the app writes, a query's filter, and the job the app gives
the library.

## Look for

- **Untested behavior**: each branch the change adds with no spec that fails
  without it. Name the object, method, and case.
- **Missing happy path**: a new or changed user-facing flow with no flow spec.
- **Wrong level**: as above. Name where the spec should move.
- **Boundary-spec creep**: a boundary spec that repeats what a flow or unit
  spec already shows.
- **Weak assertions**: asserting a method was called instead of what happened,
  asserting text that renders regardless, and specs that pass with the
  feature removed. For a write with side effects (pruning, conditional
  updates, cascades), assert the state afterwards, not only the return value.
- **Fragility**: `sleep`, order dependence, hard-coded ids or dates, the wall
  clock read without freezing. A spec that creates a record "a minute ago" and
  expects today's date fails just after midnight. Freeze the clock at midday
  so no offset crosses a day boundary.

For each missing spec, give the file, the group and case, and the assertion
that would catch the regression.

## Severity

An untested branch in money, permissions, or data integrity is `high`. Any
other untested branch is `medium`. A wrong-level spec or a framework test is
`low`, unless it hides a gap.

## Not this principle

Bugs in the code go to acceptance. Specs this change weakened go to blast
radius. Slow specs go to `make-it-fast`: tag them `fast:`.
