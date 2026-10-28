# Developing the page

Read this before changing the scripts or `scripts/page/`. None of it is needed
to run a review.

## Constraints

- **Never put `overflow` on an ancestor of a sticky element.** An `overflow`
  value other than `visible` on any ancestor silently kills `position: sticky`
  on its descendants. This cost a round trip when `.file` had `overflow:hidden`
  and the file headers looked sticky but never stuck.
- Sticky offsets are driven by a `--hh` custom property measured from the real
  toolbar height on load and resize, not a hardcoded pixel value that drifts
  when the toolbar wraps on a narrow window.
- **Media is inlined, never linked.** `image`/`video` entries and the PR
  description's images are read at build time into data URLs (description
  images not hosted on GitHub stay plain links; the `gh` token is only sent to
  github.com); the page renders only `data:image/` and `data:video/`
  sources, so opening it never fetches from anywhere.
- **The `localStorage` key is the PR** (`review:owner/repo#N`), or without one
  the title plus a hash of the sorted file names. Never key on render order:
  the guide reorders sections, and that would wipe checkmarks and drafts every
  time it was rewritten. Pages from before 2.1 used `diffviewed:<title>:...`
  keys; the page copies those over on first load. Checkmarks store the file's
  blob (`meta.blobs`, or a hash of its diff on `--stdin` pages), so they expire
  when the file changes. Comments are stored by (side, line), not row index, so
  they survive a rebuild, a whitespace toggle and expanded context. Each line
  comment also stores its file's `sig`; when the file has changed since, the
  comment is marked stale and Submit stays off until the reviewer re-saves or
  deletes it, because the same line number may now point at different code.
- **Split view sizes its gutters with a `<colgroup>`.** It uses
  `table-layout: fixed`, which takes column widths from the first row, and that
  row is a hunk header spanning all four columns: without the colgroup each
  gutter gets a quarter of the table.
- Rows are rebuilt (`buildTable`) on every view, whitespace or expand change,
  so anything that points at a row (`f.trOf`, `f.cellsOf`, `f.numsOf`,
  `f.rowAt`) must be looked up again afterwards, never cached across one.
- `/api/file` only serves files named in the page's own diff, at `meta.headRev`,
  and needs the page token like the POST endpoints. Keep it that narrow: the
  token and the Host check are all that stop other pages in the browser from
  reading the repo through it.
- The diff, whitespace diff, threads, guide, and metadata ride in `<script type="application/json">`
  islands with `<` escaped as `<`, which round-trips exactly (the old
  `text/plain` escaping showed a stray backslash in any line containing
  `</script`). Inlined JS has `</script` escaped. The page has no network
  dependencies, so it works from `file://` and can be mailed around.
- The diff parser only treats `---`/`+++`/`index` as headers **before a file's
  first hunk**. Inside a hunk, a deleted `-- comment` line arrives as
  `--- comment` and must count as a deletion.
- The served page gets its token by replacing the exact
  `<script id="server-src" type="application/json">null</script>` placeholder.
  Keep that string identical in `build-review.cjs` and `serve-review.cjs`.

- **Every drawn diagram has an expand button** in its corner (screenshots open
  on click instead), so its text stays selectable. `DIAG.render` keeps the
  diagram's data on the figure (`fig.diag`; each side of a `compare` carries
  its own) and the page draws it again in the lightbox, since a raw diagram's
  shadow root doesn't survive `cloneNode`. The lightbox fills the window: a
  drawn diagram scales through its viewBox (the SVG gets the panel's width
  and grows in height, with its legend in a column under it, never beside
  it), and a hand-written one, which has no viewBox, is measured and given a
  CSS `zoom` to fit (`fitBig`, rerun on resize).
- **Diagram layout never measures the DOM.** `diagrams.js` sizes boxes from
  label length with fixed arithmetic, so it renders the same in every
  browser. Nodes in one row can differ in height (a `sub` line), so code that
  asks "same row?" must compare `n.row`, not `y`.
- Raw `html`/`svg` diagrams render in a shadow root; the page's CSS variables
  inherit through it, nothing else does. `<script>` and `on*` attributes are
  stripped, since diagrams are pictures.
- An editor opened from a recommendation (`editInRecs`) is the one `editing`
  draft with `inRecs` set. `renderFile` leaves it alone, and `mountRecEditor`
  puts it back in its card after every redraw of the Recommendations view.
- The step views are body classes (`overviewing`, `submitting`, `done`) plus
  `body.dataset.view`; the code view is the absence of the others. The last
  step is remembered under `<KEY>:step`.

## Syntax highlighting

`page/highlight.js` is ordinary browser source inlined into the page. Two rules
when editing it:

- **Sub-patterns must not contain capturing groups.** The rules are combined
  into one alternation and the matched group index maps back to a class name
  positionally, so a stray `(...)` shifts every class after it. Use `(?:...)`.
- **Tokenise first, escape per token.** Never highlight already-escaped text,
  or a rule will match inside `&amp;` and corrupt the line.

Slim (`.slim`) has its own line-mode tokeniser (`slim` in `highlight.js`)
rather than a rule list: it reads the line's leading indicator (`/` comment,
`|`/`'` text, `-`/`=`/`==` Ruby, `filter:`, or a tag with `.class#id`
shorthand) and highlights the rest as Ruby or attributes accordingly, recursing
for inline `tag: tag` nesting. Its pieces still go through `tok`, so the
no-capturing-groups rule applies to them too.

It tokenises a line at a time, but `hl(text, lang, st)` carries a state object
from line to line: block comments and template literals (`OPEN`), Ruby
heredocs and `=begin`, YAML block scalars, and Slim's indented blocks
(comments, text, and `javascript:`/`css:`/`ruby:` filters highlighted in their
own language). The page keeps one state per side of the diff (context lines
advance both) and restarts it after every gap, since hidden lines are unknown;
expanding a gap fully joins the state up again. A leading `*` is still treated
as a comment continuation, which covers JSDoc whose opening `/*` is in hidden
lines.

## Word-level diff

`wordDiff` in `app.js` runs after highlighting. It pairs the k-th deleted line
of a run with the k-th added line after it (the same pairing as split view),
diffs their word, whitespace and punctuation tokens, and wraps what changed in
`<mark>` inside the already highlighted HTML. `markHtml` counts an entity as
one character and closes the mark around every highlighter tag, so it never
changes the displayed text. Pairs whose unchanged non-space text is under half
the shorter line get no marks. Marks use `<mark>`, not `<span>`, so they stay
when syntax highlighting is off.

## Verifying a change to the page

The build always self-checks: it re-parses the diff it embedded and compares
per-file `+/-` counts against `git diff --numstat -z` (renames included),
exiting non-zero on any mismatch. With `--groups` it also prints how many files
the guide covers, how many are auto-reviewed, and how many suggestions there
are, and exits non-zero on an unknown or duplicated file or an unanchorable
suggestion. Trust both. `submit-review.cjs --dry-run` shows the exact payload
without posting.

For changes to the page's *behavior*, drive it in a real browser with
Playwright when a project has it installed (`require('playwright')`). Serve
the page with `--serve` so Submit, Save and expanding context work, click
through the flow you changed, and fail on any `pageerror` or console error.
Layout, sticky positioning and diagram layout still need a look at a
screenshot to confirm; say so rather than claiming they are verified.

For screenshots, Playwright can load the page straight from `file://` when a
project has it installed (`require('playwright')`): `page.goto('file:///…/x.html#overview')`,
then `page.screenshot`, in both `colorScheme: 'light'` and `'dark'`.

For the highlighter specifically, assert *fidelity*: collect every
`tr[data-r] td.c` textContent per file (unified view; in split view, the
`tr.sp td.c:not(.re)` cells) and compare it to the raw diff lines, grouping by
file rather than by document order, since the reading guide reorders the
sections. Highlighting must never change a single character of what is
displayed. Expanded lines are `tr.x` rows without `data-r`; check them against
`git show <headRev>:<path>` by their line numbers, on both sides.

Note that `file://` URLs are blocked for the Claude-in-Chrome browser tools, so
screenshotting the page needs `--serve` (or another local HTTP server), and
that may also be blocked by the sandbox. `open` in the user's own browser is the
reliable route.
