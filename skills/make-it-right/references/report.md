# Report

One screen, in this shape:

```markdown
**<Outcome in one sentence: ready for review / ready except X / blocked on Y.>**

Checked: <principles run> · UI: <states walked> at 390px and 1440px, or skipped / n/a / blocked on <what>
Criteria: <n of n met, or "no criteria found">
Fixed: <n> new-code findings, <n> existing-code (≥ <threshold>) · net <±N> lines
Specs: +<n> per level in `test/coverage.md`, by the stack map's names · −<n> framework or duplicate
Redesign: applied | declined | none — <shape>, replacing <what>
Hand off: make-it-fast — <why: queries, endpoints, jobs, spec setup, or `fast:` findings> / skipped — <why>

Look here:
- <path:line>: <why a human should judge this: product call, unclear intent, risky migration>

Not fixed:
- <path:line> <severity>: <finding>. <below threshold / rejected because … / fix reverted because … / round-2 limit / open question / declined by user>

Also:
- <run: $OUT path, make-it-right <metadata.version> · flaky: spec · broken on base: spec · reverted agent edit: path · missing sibling: path · no doc covers <topic>, suggest `generate-conventions`>
```

"Look here" holds two or three items at most and never repeats something
already fixed. If nothing needs a human, write "Nothing — the diff speaks for
itself." Drop any line that has nothing to say, except the first.
