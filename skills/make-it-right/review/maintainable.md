# Maintainable

Find code that doesn't need to exist, and code in the wrong place, so the next
change is harder than it should be. Deleting comes first: the best line is the
one never written. The ladder is inspired by
[ponytail](https://github.com/DietrichGebert/ponytail)'s YAGNI review.

If `<SKILL_DIR>/../rails-audit/references/poro_patterns.md` and
`code_smells.md` are installed, they are rule sources too.

## The ladder

For every new method, class, file, dependency, option, and branch, climb until
a rung holds:

1. **Does it need to exist?** Is it called, by anything the intent needs? If
   not, it's `delete:`.
2. **Ruby or ActiveSupport does it?** `stdlib:`
3. **Rails, HTML, CSS, Turbo, or Stimulus does it?** Associations,
   validations, `delegate`, `normalizes`, enums, `has_secure_token`,
   `<dialog>`, `<details>`, `required` / `pattern`, CSS `:has()`, Turbo frames,
   and Stimulus values / outlets / classes. `native:`
4. **Already in the project?** The app's own concerns, helpers, components,
   design-system classes, and factories, plus gems it already has. `reuse:`
   Search by what the code does, not what it's called. For each new
   mechanism (a cache key, a retry, a formatter, a permission check, a
   background notice), grep for the tables, columns, and calls it uses, such
   as `maximum(:updated_at)`, `cache_key`, or `broadcast_`. An existing module
   that touches the same data may already solve the same problem. Read it
   before writing a new one.
5. **Can it be one line?** `shrink:`
6. **Only then**: the smallest thing that works. An abstraction with one
   implementation, a config option nobody sets, or a parameter every caller
   passes the same is `yagni:`.

| Tag | Means |
|---|---|
| `delete:` | Dead code, unused flexibility, speculative features. |
| `stdlib:` | Hand-rolled what Ruby or JS core already provides. |
| `native:` | A dependency or code that duplicates the framework or the platform. |
| `reuse:` | Something that already exists in the repo. Name it with `path:line`. |
| `yagni:` | Abstraction, indirection, or configuration with one user. |
| `move:` | Right code, wrong owner. See below. |

Put the tag first in the finding's "what". For each `delete:`, `stdlib:`,
`native:`, `reuse:`, or `yagni:` finding, add the lines it saves, as `(-N)`.
After the findings, add `net: -<N> lines possible`, or `Lean already.` if
there is nothing to cut.

## Before you call something unused

Rails finds code by name. Before a `delete:`, grep for the name as a string,
symbol, and path fragment: `data-controller` / `data-action` values, partial
and template names, `send` / `public_send` / `constantize`, route helpers,
i18n keys, callbacks, job class names, and factory names. Put what you
searched in the evidence.

## Where code lives (`move:`)

- **Layering**: business rules in controllers, views, helpers, or Stimulus
  controllers, when they belong on the model or a PORO. Queries built in
  views. Persistence in presenters.
- **Domain or display**: a new model method whose only callers are views and
  that returns labels, formatted or rounded values, or the data shape a chart
  or widget wants, belongs in a helper or the app's presenter. Grep its
  callers before you accept it on the model. `thin-callers` means keep
  domain rules out of views, not move display code into models.
- **Request or domain**: logic that reads `params` or `request` stays in the
  controller, in a private method once it's more than a line. A choice the
  domain makes, such as which record or which default, belongs on the model,
  even when only a controller calls it today.
- **Ownership**: Feature Envy (a method that mostly reads another object), Law
  of Demeter chains (`order.customer.account.plan.name`), and ask-then-act
  (`if thing.state == :x then thing.update(...)`) where the object should be
  told instead.
- **Invariants**: a rule enforced in one caller instead of on the object that
  owns it, so the next caller can skip it.
- **Cohesion**: a class or method doing two jobs that change for different
  reasons. Callbacks that reach into other aggregates or call external
  services.
- **Boundaries**: external services called without a seam, and framework
  objects (`params`, `request`, `current_user`) leaking into models.
- **Workarounds for your own code**: a second declaration that exists only to
  undo the first, such as a broad `rescue` or `retry_on StandardError` that
  then needs another handler to give a framework's own error back. Narrow the
  first one instead.

Propose a new class, module, concern, or layer only when **at least two places
in the code already need it**. One future caller you can imagine is not
enough. Prefer moving code to the object that owns it over wrapping it in a
new one.

## Never cut

Validation, authorization, error handling users rely on, accessibility
attributes, logging the team monitors, or specs. Which specs shouldn't exist
is the coverage principle's call.

## Not this principle

Names, comments, and small rewrites for clarity go to readability. Data shape
goes to data patterns. Written project rules go to conventions.
