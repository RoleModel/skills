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
- **Naming**: names that say how instead of what, or names that no longer
  match the behavior after this change.
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
