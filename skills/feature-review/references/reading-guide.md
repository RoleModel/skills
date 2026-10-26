# The reading guide

The groups, auto-reviews and suggested comments in `tmp/review/<slug>.groups.json`.
The overview half of the same file is in `overview.md`; recommendations are in
`recommendations.md`.

The script is plain Node with no model access, so the guide comes from you:

```json
{
  "groups": [
    { "title": "The new split: Order and Shipment",
      "why": "Start here: an order no longer holds shipping state directly.",
      "files": ["path/one.js", "path/two.js",
        { "path": "path/three.js", "auto": true, "summary": "Same rename as two.js, applied to its callers." }] },
    { "title": "Shipping UI", "why": "The panel now reads shipments instead of orders.",
      "files": ["app/x/panel.js", { "path": "app/x/typo.rb", "auto": true, "summary": "Fixes a typo in an error message." }] }
  ],
  "suggestions": [
    { "path": "path/one.js", "line": 42, "body": "This can be null when ...\n```suggestion\n  return shipment ?? null\n```" },
    { "path": "path/two.js", "start_line": 10, "line": 14, "body": "Same loop as `Shipment#each_item`; reuse it?" },
    { "path": "path/two.js", "body": "A whole-file comment: no line." }
  ]
}
```

Auto-reviewed files go **in the group where they belong**, as
`{ "path", "auto": true, "summary" }` entries next to the files they relate to,
not gathered into a separate "Auto-reviewed" group at the end. The reviewer
reads them in context, collapsed, as they pass that part of the change.
(`"auto": true` on a whole group still works, but only use it when every file
in a group that already makes sense on its own qualifies.)

A bare array of groups (the 1.x format) still works. Array order is reading
order, so lead with the group that explains the change and let the rest follow
from it; mechanical fallout goes last. `why` is one line on why the group is
read at that point, not a summary of the diff. Shape the groups to the user's
preferences file; where it is silent, use the order above.

Files you leave out still render, in a trailing "Unsorted" group, so nothing
can silently vanish and make the percent-reviewed number a lie. The build fails
on a file that isn't in the diff, a file named twice, or a suggestion whose line
isn't in the diff. `side` defaults to `RIGHT` (the new file); use `LEFT` with
old line numbers to comment on a deleted line. A multi-line range must stay
inside one hunk.

## Auto-review

Auto-reviewing a file means you read its whole diff, judged it fine, and are
telling the reviewer they can skip it. It sits in its reading-guide group like
any other file, but renders collapsed under a dashed border with your summary, counts toward the percent reviewed in a separate bar
color, and is listed again on the submit page. The reviewer can expand it to
double-check, or tick Viewed to sign it off themselves.

A file qualifies only if **all** of these hold:

- **Small**: at most the threshold in the preferences file, default 15 changed lines.
- **Unrelated to the request**: incidental to what the PR or ticket is for.
  Typo and copy fixes, formatting, import order, a rename's fallout, lint
  autofixes, comment changes, a one-line signature change that matches the
  others. Anything the PR body or ticket names is related by definition.
- **Not a key file.** Never auto-review config or build files (`package.json`,
  `Gemfile`, lockfiles, `*.yml`/`.yaml`, `.env*`, `Dockerfile`, CI config,
  `config/**`, initializers), database migrations or schema, routes, auth,
  permissions and policies, security-sensitive code, public API or contracts,
  a deleted file, or a file you couldn't fully read (binary, truncated).
- **You found nothing wrong.** If you'd comment on it, it isn't auto-reviewed:
  leave it in a normal group and add the suggestion.

Every auto-reviewed file needs a `summary`: one line saying what changed, not
that it "looks fine". Keep auto-reviewed lines a small share of the diff (the
groups line prints the ratio). If it's over about a quarter, you're hiding the
review, not speeding it up: auto-review less. Honor "off" in the preferences.

## Suggested comments

Prefer `recommendations` (`recommendations.md`): their `comments` become suggested comments
too, and the reviewer can accept a whole group of them at once. Bare
`suggestions` still work, and each shows in the Recommendations view as its own.

`suggestions` are comments you draft for the reviewer. They show inline, dashed,
marked "Suggested", and are **not** part of the review until the reviewer
clicks Accept (or edits them). Dismissed ones stay dismissed across reloads.
Only suggest what the preferences file asks for; by default, concrete bugs and
risks. Write them the way the reviewer would post them, and use a
```` ```suggestion ```` fence for a concrete replacement of `RIGHT`-side lines.
No suggestions is a fine answer.
