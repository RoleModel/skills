# Blast radius

Find what outside the change could break because of it. The change's own
behavior is acceptance's job. Yours is everything that already depended on the
code it touched.

## Map it

For each method, query, template, route, client-side controller, CSS class, or
column the change edits or removes:

1. List its callers. Dynamic frameworks find code by name, so grep the name
   as a method, a string, a symbol, and a path fragment, everywhere the stack
   map's "Where names hide" lists.
2. Name the feature each caller belongs to.
3. Find the specs that cover those callers and run them (the Commands file
   says how), not only the specs for the touched files.

Return the map with your findings: changed thing → callers → specs run →
result.

## Look for

- **Callers now broken**: a caller that passes what the new code no longer
  accepts, or relies on what it no longer returns. Run the spec that shows it.
- **Callers with no spec**: a caller the change affects that nothing covers.
  Name the spec that would.
- **Changed interfaces**: a method signature, return shape, route, template's
  inputs, client-side value or target, or CSS class that something else uses.
- **Broken contracts**: for every renamed key or reshaped payload, read the
  other side and match the names: a server allowlist against the keys the
  client sends, a response against every caller of that URL, markup
  attributes against the values a client-side controller declares. The stack
  map's "Contracts to match" names the pairs. These fail silently: a dropped
  key saves nothing, and a misnamed value reads its default.
- **Shared defaults**: a changed scope, default, hook, or request filter that
  every caller now gets, wanted or not.
- **Weakened specs**: assertions deleted, tests skipped or marked pending, or
  expectations loosened in this change without a reason given.

## Severity

A caller that now breaks is `high`, or `critical` when it loses or corrupts
data or opens access. A changed interface with an uncovered caller is
`medium`.

## Not this principle

Bugs in the new behavior go to acceptance. New behavior with no spec goes to
coverage.
