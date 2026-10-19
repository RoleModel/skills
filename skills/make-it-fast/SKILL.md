---
name: make-it-fast
description: >-
  The optional "make it fast" pass after a change is right. Reviews it for
  speed and efficiency (database queries, request time, test suite speed, and
  page responsiveness), verifies each finding, fixes what it can measure, and
  reports before-and-after numbers. Use when the user says "make it fast",
  "speed this up", "performance review", "why is this page slow", "check for
  N+1s", "the specs are slow", or "optimize this", or after `make-it-right`
  when a change adds or alters queries, endpoints, jobs, spec setup, or
  markup that loads images, embeds, frames, fonts, or scripts. Skip it for
  other copy, markup, or style changes: they have nothing to measure.
metadata:
  author: rolemodel
  version: "1.0"
  triggers: "make it fast, speed this up, performance review, slow page, slow request, n+1, slow specs, slow tests, optimize, efficiency review"
license: MIT
---

# Make It Fast

Run after [`make-it-right`](../make-it-right), never before: fast code that's
wrong is wasted. This pass uses the same loop, so it borrows that skill's
machinery instead of copying it.

`SKILL_DIR` below is the directory this file was loaded from. `RIGHT_DIR` is
`<SKILL_DIR>/../make-it-right`. If it isn't installed, stop and say so.

## The loop

Follow `RIGHT_DIR/SKILL.md` with these changes:

- In every borrowed step, `$SKILL_DIR` means `RIGHT_DIR`: its `scripts/`,
  `references/` (stack maps, findings, verifier, redesign, report), the
  sibling glob, `review/maintainable.md`, and `test/coverage.md`.
- **Step 1** as written.
- **Step 2** as written.
- **Step 3** launches this table instead, with the same packet except that
  the principle file is `<this SKILL_DIR>/review/<principle>.md`. These
  principles measure, so launch each as `rolemodel-skills:make-it-right:tester`
  when that type is listed, and give it the test-agent line, not the
  review-agent one. It may also run the app's console runner.

| Principle | File | Run when the change touches |
|---|---|---|
| queries | `review/queries.md` | models, scopes, controllers, views, jobs, or migrations |
| requests | `review/requests.md` | controllers, jobs, or anything that calls an external service |
| test speed | `review/test-speed.md` | specs or factories, or when the suite is the complaint |
| page responsiveness | `review/page-responsiveness.md` | views, components, client-side code, CSS, or JS bundles |

- **Steps 4 and 5** as written, with `RIGHT_DIR/references/findings.md` and
  `RIGHT_DIR/references/verifier.md`. Fix order: queries, requests, page
  responsiveness, test speed.
- **Step 6**: round 2 re-measures, it doesn't re-review. Skip the UI/UX walk.
- **Step 7** as written, without the `make-it-fast` offer. The report drops
  the UI segment of Checked and the Criteria, Specs, Redesign, and Hand off
  lines, and adds `Measured: <thing>: <before> → <after>` for each fix.

## Measure, don't guess

A speed finding needs a number or a trace: a query count, a log line with its
time, a spec's `--profile` row, a waterfall. "This could be slow" with no
evidence is taste, and the verifier drops it.

Measure before and after each fix, on the same data. If a fix doesn't move the
number, revert it. Code that's faster in theory and the same in practice is
just more code.

## Gotchas

- Development and test databases are tiny, so a missing index or an N+1 can
  look free. Count queries, don't time them, unless you seed realistic
  volume.
- Caching hides a slow path instead of fixing it, and adds a way to show stale
  data. Fix the query or the work first. Cache only what is still slow after
  that, and name what expires it.
- The `make-it-right` rule still holds here: never cut what
  `RIGHT_DIR/review/maintainable.md` "Never cut" lists to gain speed.
