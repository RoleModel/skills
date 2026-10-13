# Blast radius

Find what outside the change could break because of it. The change's own
behavior is acceptance's job. Yours is everything that already depended on the
code it touched.

## Map it

For each method, scope, partial, route, Stimulus controller, CSS class, or
column the change edits or removes:

1. List its callers. Grep the name as a method, a string, a symbol, and a path
   fragment, since Rails finds code by name: `data-controller` /
   `data-action` values, partial and template names, `send` / `public_send` /
   `constantize`, route helpers, i18n keys, callbacks, job class names, and
   factory names.
2. Name the feature each caller belongs to.
3. Find the specs that cover those callers and run them, not only the specs
   for the touched files.

Return the map with your findings: changed thing → callers → specs run →
result.

## Look for

- **Callers now broken**: a caller that passes what the new code no longer
  accepts, or relies on what it no longer returns. Run the spec that shows it.
- **Callers with no spec**: a caller the change affects that nothing covers.
  Name the spec that would.
- **Changed interfaces**: a method signature, return shape, route, partial's
  locals, Stimulus value or target, or CSS class that something else uses.
- **Broken contracts**: for every renamed key or reshaped payload, read the
  other side and match the names. Check permitted params against the keys the
  client sends, a JSON response against every caller of that URL, and
  `data-<controller>-<name>-value` attributes against the controller's
  `static values`. These fail silently: a dropped param saves `nil`, and a
  misnamed value reads its default.
- **Shared defaults**: a changed scope, default, callback, or `before_action`
  that every caller now gets, wanted or not.
- **Weakened specs**: assertions deleted, `skip` / `pending` / `xit` added, or
  expectations loosened in this change without a reason given.

## Severity

A caller that now breaks is `high`, or `critical` for money, permissions, or
data. A changed interface with an uncovered caller is `medium`.

## Not this principle

Bugs in the new behavior go to acceptance. New behavior with no spec goes to
coverage.
