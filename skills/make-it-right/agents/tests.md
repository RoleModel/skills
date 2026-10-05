# Tests lens

Tests are what let a human trust this change without reading every line, so
this lens carries the most weight. Find the behavior no spec would catch
breaking, the specs written at the wrong level, and the specs that only test
Rails or a gem.

The question for every behavior is whether a spec would **fail** if it
regressed. Line coverage doesn't answer that.

If `<SKILL_DIR>/../tdd/SKILL.md` is installed, follow its FactoryBot, `let`,
and Capybara conventions. The levels below take precedence over it.

## The right level

| Level | How many | What belongs there |
|---|---|---|
| **System** | One happy path per user-facing flow | The user does the main job start to finish, in the browser, and sees it worked. Not every branch. The UX lens walks the branches. |
| **Request** | Very few | Only what neither a system spec nor a model spec can reach: JSON and API responses, webhooks, status codes and redirects with no UI, an authorization denial that has no screen. |
| **Model** | Most of the suite | Every rule the change adds to a model or PORO: each branch of each method, custom validations, scopes with logic, callbacks with effects, calculations, state transitions, and their edges (nil, empty, zero, boundaries, duplicates). |

Push behavior down. A branch tested in a system or request spec that a model
spec could cover should move to a model spec. If the logic can't be reached
from a model spec because it lives in a controller or view, that's a design
finding too: hand it to the design lens.

## Not framework or library tests

Report specs that test Rails or a gem instead of this app's code as
`delete:`, and delete them:

- Declared associations (`it { is_expected.to belong_to(:account) }`) and
  plain `presence` / `uniqueness` / `length` validations with no condition.
- That `has_secure_password`, Devise, Pundit's DSL, `enum`, or `normalizes`
  does what its documentation says.
- That a route exists, a controller renders a template, or a factory is
  valid, when nothing else would break if it stopped.
- Stubbing a method and then asserting the stub was called.

Test the app's **use** of those tools: a conditional validation, a policy's
actual rules, a scope's filter, and the job the app gives the gem.

## Look for

- **Untested behavior**: each branch the change adds with no spec that fails
  without it. Name the model, method, and case.
- **Missing happy path**: a new or changed user-facing flow with no system
  spec.
- **Wrong level**: as above. Name where the spec should move.
- **Request-spec creep**: a request spec that repeats what a system or model
  spec already shows.
- **Weak assertions**: asserting a method was called instead of what happened,
  `have_content` on text that appears regardless, and specs that pass with
  the feature removed.
- **Weakened specs**: assertions deleted, `skip` / `pending` / `xit` added, or
  expectations loosened in this change without a reason given.
- **Fragility**: `sleep`, order dependence, hard-coded ids or dates,
  `Time.now` without freezing, and factories that build far more than the
  spec needs.

For each missing spec, give the file, the `describe` / `context`, and the
assertion that would catch the regression.

## Severity

An untested branch in money, permissions, or data integrity is `high`. Any
other untested branch is `medium`. A wrong-level spec or a framework test is
`low`, unless it's slowing the suite or hiding a gap.

## Not this lens

Bugs in the implementation go to correctness. You report what is missing,
misplaced, or unnecessary in the specs, not what is wrong with the code.
