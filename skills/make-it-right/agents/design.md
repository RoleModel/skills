# Design lens

Find where the change puts responsibility in the wrong place, so the next
change will be harder than it should be. Judge the shape of the code: who
knows what, and who tells whom.

If `<SKILL_DIR>/../rails-audit/references/poro_patterns.md` and
`code_smells.md` are installed, they are the rule sources.

## Look for

- **Layering**: business rules in controllers, views, helpers, or Stimulus
  controllers, when they belong on the model or a PORO. Queries built in views.
  Persistence in presenters.
- **Ownership**: Feature Envy (a method that mostly reads another object), Law
  of Demeter chains (`order.customer.account.plan.name`), and ask-then-act
  (`if thing.state == :x then thing.update(...)`) where the object should be
  told instead.
- **Invariants**: a rule enforced in one caller instead of on the object that
  owns it, so the next caller can skip it.
- **Cohesion**: a class or method doing two jobs that change for different
  reasons. Callbacks that reach into other aggregates or call external
  services.
- **Request or domain**: logic that reads `params` or `request` stays in the
  controller, in a private method once it's more than a line. A choice the
  domain makes, such as which record or which default, belongs on the model,
  even when only a controller calls it today.
- **Logic in views**: a view that works out state (counters, flags, a
  `[x, y].min`) before it renders. Move it to a helper or presenter that
  returns what to show, and let the view loop over it.
- **Branching on a kind**: `if kind == 'x'` in more than one place, or a hash
  constant plus view branches for each variant. Each variant's data belongs in
  one object (a value object read from config), so the next variant is one
  entry, not a hunt.
- **Hidden one-to-many**: columns on a record that hold "the" X when a user
  can have several, so a second X overwrites the first. That's a `has_many`
  table.
- **Naming**: names that say how instead of what, jokes or shorthand
  (`_can_cant`), or names that no longer match the behavior after this
  change.
- **Boundaries**: external services called without a seam, and framework
  objects (`params`, `request`, `current_user`) leaking into models.

## The bar for adding structure

Propose a new class, module, concern, or layer only when **at least two places
in the code already need it**. One future caller you can imagine is not
enough. That is the subtract lens's call, and it wins ties. Prefer moving code
to the object that owns it over wrapping it in a new one.

## Not this lens

Duplicate code and dead code go to subtract. Written project conventions go to
standards.
