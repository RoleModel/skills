# Maintainable

Find code that doesn't need to exist, and code in the wrong place, so the next
change is harder than it should be. Deleting comes first: the best line is the
one never written. The ladder is inspired by
[ponytail](https://github.com/DietrichGebert/ponytail)'s YAGNI review.

Any `Also read` guides you were given are reading guides: cite the code, not
the guide, as evidence.

## The ladder

For every new method, class, file, dependency, option, and branch, climb until
a rung holds:

1. **Does it need to exist?** Is it called, by anything the intent needs? If
   not, it's `delete:`.
2. **The language or its standard library does it?** `stdlib:` The stack
   map's "Stdlib does it" lists the usual suspects.
3. **The framework or the platform does it?** HTML (`<dialog>`, `<details>`,
   `required` / `pattern`), CSS (`:has()`), the browser, or the framework's
   own features, listed under the stack map's "Framework does it". `native:`
4. **Already in the project?** The app's own shared modules, helpers,
   components, design-system classes, and test data builders, plus dependencies
   it already has (the stack map's "Already in the project"). `reuse:`
   Search by what the code does, not what it's called. For each new
   mechanism (a cache key, a retry, a formatter, a permission check, a
   background notice), grep for the tables, columns, and calls it uses. An
   existing module that touches the same data may already solve the same
   problem. Read it before writing a new one. Look sideways too, not only at
   what the new code calls: find sibling code of the same kind (other tools,
   endpoints, jobs, components) and check how they handle the same concern,
   such as paging, params, errors, or response shape. When siblings share a
   module for it, new code that hand-rolls that concern is `reuse:`, even if
   the call underneath is new. When you find one, ask whether
   the whole change could be built on it, not just one piece borrowed from
   it: a change that rebuilds a mechanism the project already uses elsewhere
   (lazy loading, stored results, snapshots) is a `reuse:` finding even when
   the new copy works. Don't drop it because reusing looks costlier, such as
   more requests or a bigger diff: report the finding with that cost, and let
   the verifier weigh it.
5. **Only then**: the smallest thing that works. An abstraction with one
   implementation, a config option nobody sets, or a parameter every caller
   passes the same is `yagni:`.

| Tag | Means |
|---|---|
| `delete:` | Dead code, unused flexibility, speculative features. |
| `stdlib:` | Hand-rolled what the language or its standard library already provides. |
| `native:` | A dependency or code that duplicates the framework or the platform. |
| `reuse:` | Something that already exists in the repo. Name it with `path:line`. |
| `yagni:` | Abstraction, indirection, or configuration with one user. |
| `move:` | Right code, wrong owner. See below. |
| `redesign:` | A different shape that removes a class of bugs. Handled before other fixes. See below. |

Put the tag first in the finding's "what". For each `delete:`, `stdlib:`,
`native:`, `reuse:`, or `yagni:` finding, add the lines it saves, as `(-N)`.
After the findings, add `net: -<N> lines possible`, or `Lean already.` if
there is nothing to cut.

## Before you call something unused

Dynamic frameworks find code by name. Before a `delete:`, grep the name as a
string, a symbol, and a path fragment, everywhere the stack map's "Where names
hide" lists. Put what you searched in the evidence.

## Where code lives (`move:`)

The stack map's "Layers" names the request, presentation, and domain layers
for this stack.

- **Layering**: business rules in the request layer, views, helpers, or
  client-side code, when they belong on the domain object. Queries built in
  views. Persistence in the presentation layer.
- **Domain or display**: a new domain method whose only callers are views and
  that returns labels, formatted or rounded values, or the data shape a chart
  or widget wants, belongs in the presentation layer. Grep its callers before
  you accept it on the model. Keeping domain rules out of views does not mean
  moving display code into the domain.
- **Request or domain**: logic that reads the request or its parameters stays
  in the request layer, in a private method once it's more than a line. A
  choice the domain makes, such as which record or which default, belongs on
  the model, even when only one caller uses it today.
- **Ownership**: Feature Envy (a method that mostly reads another object), Law
  of Demeter chains (`order.customer.account.plan.name`), and ask-then-act
  (`if thing.state == :x then thing.update(...)`) where the object should be
  told instead.
- **Invariants**: a rule enforced in one caller instead of on the object that
  owns it, so the next caller can skip it.
- **Cohesion**: a class or method doing two jobs that change for different
  reasons. Hooks that reach into other aggregates or call external services.
- **Boundaries**: external services called without a seam, and framework
  request objects or the signed-in user leaking into the domain.
- **Workarounds for your own code**: a second declaration that exists only to
  undo the first, such as a catch-all rescue or retry that then needs another
  handler to give the framework's own error back. Narrow the first one
  instead.

Propose a new class, module, mixin, or layer only when **at least two places
in the code already need it**. One future caller you can imagine is not
enough. Prefer moving code to the object that owns it over wrapping it in a
new one.

## A different shape (`redesign:`)

After the ladder, step back from single lines. Ask whether another data model
or flow would make a whole class of bugs impossible, instead of guarding
against each one. Signs: a status column or flag that several methods keep in
sync, conditional writes and locks that guard against races between versions,
or a handshake that covers a timing gap the design itself creates. For
example, writing a new row per version needs no pending flag. Name the
simpler shape, list the bugs and guards it would remove, and give what it
would cost.

Report it; never apply it yourself. The run asks the user or applies it before
any other fix, per its `redesign=` argument. Raise one only when the simpler
shape would make at least two reported findings moot, including ones you
report yourself, not to state a taste.

## Never cut

Validation, authorization, error handling users rely on, accessibility
attributes, logging the team monitors, or specs. Which specs shouldn't exist
is the coverage principle's call. This list is the only copy; `SKILL.md` and
`make-it-fast` point here.

## Not this principle

Names, comments, and rewrites for clarity go to readability, which owns
`shrink:`. Data shape goes to data patterns. Written project rules go to
conventions.
