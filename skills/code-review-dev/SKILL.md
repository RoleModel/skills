---
name: code-review-dev
description: >
  Render a git commit, range, branch, PR, or piped diff into a single self-contained HTML
  review page with per-file sections, syntax highlighting, "viewed" checkboxes, percent of
  changed lines reviewed, and a reading guide that groups files in the reviewer's preferred
  order. Shows the PR's existing review threads inline (with replies), unified or split view,
  a whitespace toggle, expandable context, keyboard navigation, and a re-review mode that
  marks or shows only what changed since the reviewer's last review. Reviewers can leave
  GitHub-style comments (Markdown, attachments, suggested changes, multi-line ranges,
  whole-file comments), then finish on a submit page that posts them all as one PR review,
  or copies them as Markdown when there is no PR. Small unrelated files can
  be auto-reviewed with a one-line summary, and you can pre-suggest comments for the reviewer
  to accept. Use when the user asks to "review this commit", "review PR #123", "review
  KATT-123", "make a review page for <sha>", "let me review this diff in the browser", "build
  an HTML diff for this PR", "re-review PR #123", "what changed since I reviewed", or wants
  to read a large diff file-by-file and track progress.
  Also use when a diff is too long to read comfortably in the terminal.
allowed-tools: Bash Read Write Edit Glob Grep AskUserQuestion
compatibility: Designed for Claude Code (or similar products). Posting to GitHub needs the gh CLI.
metadata:
  author: rolemodel
  version: '2.1'
license: MIT
---

# Commit Review Page

Turns a diff into an offline HTML page for file-by-file review, with comments
that can be posted to the PR as one review.

## Usage

```bash
S=~/.claude/skills/code-review-dev/scripts
node $S/build-review.cjs <commit-ish>                 # this commit vs its parent
node $S/build-review.cjs <base>..<head>               # or <base>...<head> from the merge base
node $S/build-review.cjs --pr <N|url|owner/repo#N>    # the PR's diff; comments can post to it
node $S/build-review.cjs <ref> --pr <N>               # a commit or range inside that PR
node $S/build-review.cjs <ref> --groups path.groups.json   # reading guide (below)
node $S/build-review.cjs <ref> --pr <N> --serve       # serve on localhost: Submit, and expanding context
node $S/build-review.cjs --pr <N> --since last        # re-review: only what changed since your last review
node $S/build-review.cjs --pr <N> --since <sha>       # ...or since any commit
node $S/build-review.cjs --pr <N> --no-threads        # skip loading the PR's existing review threads
node $S/build-review.cjs <ref> -o path.html --title "..." --event approve
git diff ... | node $S/build-review.cjs --stdin -o path.html
```

The script prints the output path on stdout (with `--serve`, the URL). Output
defaults to `tmp/review/<slug>.html` **relative to the current working
directory**, where the slug is a ticket ID from the commit or PR title (e.g.
`KATT-2143`), `pr-<N>`, or the short SHA. In a repo that doesn't gitignore
`tmp/`, pass `-o` rather than leaving untracked files behind.

## Workflow

1. **Gather.** Work out the diff, the PR, and the intent from whatever the user
   gave you: PR, commit, range, branch, or ticket ID. Recipes for each are in
   `references/gathering.md`. Always look for a PR, because that decides
   whether the page can post comments.
2. **Load preferences.** Read `~/.claude/code-review-dev/preferences.md`, then
   `.claude/code-review-dev.md` in the repo if there is one. If the user-level file
   doesn't exist, this is their first use: ask them (below) before continuing.
3. **Read the change** (`git show --stat`, the PR body or ticket, and enough
   of the diff to know what each file does), then write the guide, including
   any auto-reviews and suggested comments.
4. **Build** with `--groups` (and `--pr`). Skip the guide only for a diff small
   enough to read top-to-bottom, or if the user declines one. With `--pr` the
   build looks up the user's last submitted review on the PR (see
   **Re-reviewing** below) and prints a `re-review:` line.
5. **Open it.**
   - With a PR: run the build with `--serve` **in the background** (Bash
     `run_in_background`), then `open` the URL it prints. The server exits after
     a successful submit, which notifies you; report the review URL and any notes
     it printed. The page itself moves on to a "Review submitted" screen.
   - Without a PR: `open <path>`; the submit page offers Copy as Markdown. Serve
     it the same way if the user wants **Save for agent** to hand comments back,
     or to expand context around hunks (which reads files through the server).
6. **Report** the self-check and groups lines, the PR (or that there isn't one),
   the `threads:` and `re-review:` lines, the commit's file/line totals, and the
   list of auto-reviewed files with their one-line summaries so the user knows
   what they are trusting you on.

If the user hands back a review (pasted Markdown, or "I saved it for you"), the
saved copy is `tmp/review/<slug>.review.md` and `.review.json` next to the page;
read those, attachments included (their paths are in the Markdown).

## First use: ask how they review

When `~/.claude/code-review-dev/preferences.md` is missing, ask with
AskUserQuestion, one round, up to four questions:

- **Grouping order**: follow the data flow (models, then callers, then UI);
  top-down (entry point first); tests first, as the spec; or by feature.
- **Tests**: next to the code they cover, or in their own group at the end.
- **Auto-review**: off; conservative (trivial and clearly unrelated only); or
  aggressive (any small mechanical change).
- **Suggested comments**: bugs and risks only; also style and naming; or none.

Write the answers into the template at `references/preferences-template.md`,
save it to `~/.claude/code-review-dev/preferences.md`, and tell the user where it
is so they can edit it. Don't ask again once it exists. If they'd rather not
answer, write the template with the defaults (data flow, tests with their code,
conservative, bugs and risks only) and carry on.

## The reading guide

The script is plain Node with no model access, so the guide comes from you.
Write `tmp/review/<slug>.groups.json`:

```json
{
  "groups": [
    { "title": "The new split: Side and Section",
      "why": "Start here: a bay no longer holds bracing state directly.",
      "files": ["path/one.js", "path/two.js",
        { "path": "path/three.js", "auto": true, "summary": "Same rename as two.js, applied to its callers." }] },
    { "title": "Bracing UI", "why": "The panel now reads sections instead of bays.",
      "files": ["app/x/panel.js", { "path": "app/x/typo.rb", "auto": true, "summary": "Fixes a typo in an error message." }] }
  ],
  "suggestions": [
    { "path": "path/one.js", "line": 42, "body": "This can be null when ...\n```suggestion\n  return side ?? null\n```" },
    { "path": "path/two.js", "start_line": 10, "line": 14, "body": "Same loop as `Section#walk`; reuse it?" },
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

`suggestions` are comments you draft for the reviewer. They show inline, dashed,
marked "Suggested", and are **not** part of the review until the reviewer
clicks Accept (or edits them). Dismissed ones stay dismissed across reloads.
Only suggest what the preferences file asks for; by default, concrete bugs and
risks. Write them the way the reviewer would post them, and use a
```` ```suggestion ```` fence for a concrete replacement of `RIGHT`-side lines.
No suggestions is a fine answer.

## Re-reviewing

With `--pr`, the build finds the user's last submitted review on the PR and
the commit it was made at:

- **Full page (default).** Files changed since that review get a "changed since
  your review" badge and a dot in the sidebar, and the sidebar has an **Only
  these** filter. The `re-review:` line says how many files changed, or that
  nothing has.
- **`--since last`** builds the page from that commit to the PR head instead, so
  only the new work is shown. Its slug ends in `-since`, so it doesn't overwrite
  the full page. If the branch was rebased since, the line says so: the diff then
  includes upstream changes too, and the full page with the filter is often the
  better read.

When the user asks to re-review, or the `re-review:` line reports changes on a
PR they reviewed before, offer the `--since last` page (or build it if that's
what they asked for). Reuse the earlier guide where files overlap.

Drafts are stored per PR, so the full page and a `--since` page share them.
Viewed checkmarks are tied to each file's blob at the reviewed commit: one
survives a rebuild or a `--since` page while the file is unchanged, and comes
back unticked with a "changed since you viewed it" badge once it changes.

## Reading the page

- **Existing threads.** With `--pr`, the PR's review threads are loaded at build
  time and shown inline at their lines, with author, date and a link to GitHub.
  Resolved threads start collapsed. Outdated threads, or every thread when the
  page isn't at the PR head, sit at the top of their file. **Reply** drafts a
  reply that is posted as part of the review. Your own pending (unsubmitted)
  GitHub comments are not shown. GitHub bodies render through the page's Markdown,
  so raw HTML in them (like `<img>` tags) shows as text.
- **Expanding context.** Unchanged lines between hunks fold into gap rows with
  `↓ 20`, `↑ 20` and `All` buttons, as on GitHub. Files load lazily, one request
  each, through the local server, so this needs `--serve`; from `file://` the gaps
  just say how many lines they hide. Expanded lines are context, not diff:
  GitHub can't anchor comments to them, so their gutters aren't clickable.
- **Whitespace.** The **Whitespace** toggle swaps in `git diff -w` for the files
  where it differs, and replaces whitespace-only files with a note. Counts and
  progress always use the full diff. Comments on lines hidden this way are listed
  at the top of their file until whitespace is shown again. Not available on
  `--stdin` pages.
- **Split view.** **View: unified / split** (unified by default, remembered).
  Comments, threads and range selection work the same in both.
- **Keyboard.** `j`/`k` next/previous file, `v` toggle Viewed, `x` collapse,
  `n`/`p` next/previous comment or thread, `/` filter, `s` split, `w`
  whitespace, `?` help. The current file is the one whose header is pinned
  under the toolbar.

## Comments and submitting

In the page:

- Click a line number to comment on that line, or press on one and drag to
  another to comment on the range (it stops at the hunk edge, since GitHub
  can't anchor a comment across hunks). Each file header has a **Comment**
  button for a whole-file comment.
- The editor supports Markdown with Write/Preview tabs and toolbar buttons,
  **Suggest** (pre-fills a `suggestion` block from the selected new-side
  lines), and attachments: paste, drop, or Attach, up to 3 MB each, stored in
  the page.
- **Finish review** opens the submit page (`#submit`): a summary editor, the
  verdict (Comment / Approve / Request changes, only when there's a PR), every
  comment and reply with its code (replies also quote what they answer),
  pending suggestions to accept or dismiss, and the auto-reviewed files.
  Comments can be edited or deleted from there.
- **Copy as Markdown** and **Copy / Download JSON** always work. **Save for
  agent** (served pages) writes `<slug>.review.md` / `.review.json` and the
  attachments next to the page. **Submit review** (served pages with a PR) posts
  everything as one review, clears the drafts so they can't double-post, and
  moves to a "Review submitted" page (`#done`) with the verdict, counts, any
  notes and a link to the review.

Drafts and checkmarks live in `localStorage`, so a rebuilt page (a new guide)
keeps them. `--serve` uses a fixed port (4823, or the next free one) so the
origin, and with it that storage, is stable across runs.

`submit-review.cjs` does the posting, and can be run by hand on a saved or
copied JSON: `pbpaste | node $S/submit-review.cjs - [--dry-run]`. It:

- checks every comment against the diff GitHub anchors to (merge base to the
  reviewed commit). Comments GitHub would reject are **moved into the review
  summary** with their file and line, rather than failing the whole review;
- posts line comments through REST, and whole-file comments and thread replies
  over GraphQL (`addPullRequestReviewThread`, `addPullRequestReviewThreadReply`)
  onto the same pending review, then submits it. A reply GitHub rejects is moved
  into the summary like any other;
- refuses Approve or Request changes on the user's own PR (GitHub doesn't
  allow it) with a clear message;
- **cannot upload attachments**: GitHub has no API for that. It saves them to
  `tmp/review/<slug>-attachments/`, puts `[attachment: name]` where they were,
  and says which to drag in on GitHub. Tell the user this when they attach files.

Never submit on the user's behalf from the terminal unless they ask. The submit
page is their approval step.

## Files

- `scripts/build-review.cjs`: builds the page, runs the self-check and guide validation.
- `scripts/serve-review.cjs`: localhost server for Save, Submit and `/api/file` (also runs standalone on a built page).
- `scripts/submit-review.cjs`: posts a review JSON through `gh`; `saveReview` writes the Markdown and JSON.
- `scripts/lib/diff-parse.cjs`: the one diff parser, used by all three and inlined into the page.
- `scripts/page/`: `style.css`, `highlight.js`, `markdown.js`, `app.js`, inlined into every page.
- `references/gathering.md`: how to get from a PR, commit, range, branch, or ticket ID to a build.
- `references/preferences-template.md`: the per-user preferences file.
- `usage.md` and `assets/screenshots/`: a guide for people using the page, with screenshots.

## Constraints that matter

- **The Node scripts must keep their `.cjs` extension.** Many repos set `"type":
  "module"` in `package.json`, which makes a `.js` file an ES module and breaks
  `require`. The `page/*.js` files are never required, only read as text.
- **Never put `overflow` on an ancestor of a sticky element.** An `overflow`
  value other than `visible` on any ancestor silently kills `position: sticky`
  on its descendants. This cost a round trip when `.file` had `overflow:hidden`
  and the file headers looked sticky but never stuck.
- Sticky offsets are driven by a `--hh` custom property measured from the real
  toolbar height on load and resize, not a hardcoded pixel value that drifts
  when the toolbar wraps on a narrow window.
- **The `localStorage` key is the PR** (`review:owner/repo#N`), or without one
  the title plus a hash of the sorted file names. Never key on render order:
  the guide reorders sections, and that would wipe checkmarks and drafts every
  time it was rewritten. Pages from before 2.1 used `diffviewed:<title>:...`
  keys; the page copies those over on first load. Checkmarks store the file's
  blob (`meta.blobs`, or a hash of its diff on `--stdin` pages), so they expire
  when the file changes. Comments are stored by (side, line), not row index, so
  they survive a rebuild, a whitespace toggle and expanded context.
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

## Verifying a change to the page

The build always self-checks: it re-parses the diff it embedded and compares
per-file `+/-` counts against `git diff --numstat -z` (renames included),
exiting non-zero on any mismatch. With `--groups` it also prints how many files
the guide covers, how many are auto-reviewed, and how many suggestions there
are, and exits non-zero on an unknown or duplicated file or an unanchorable
suggestion. Trust both. `submit-review.cjs --dry-run` shows the exact payload
without posting.

For changes to the page's *behavior*, drive it in jsdom rather than guessing.
This skill is global, so `jsdom` may not be resolvable from the current
directory: check with `node -e "require('jsdom')"`, and otherwise require it
by absolute path from a project that has it, or `npm i -g jsdom`:

```js
const { JSDOM } = require('jsdom');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
const d = dom.window.document;
const click = (el, o) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...o }));
const gutter = d.querySelector('tr.a[data-r] td.n');
const mouse = (el, type) => el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0 }));
mouse(gutter, 'mousedown'); mouse(gutter, 'mouseup');  // opens a comment editor (mouseover another gutter in between for a range)
const ta = d.querySelector('.editor textarea');
ta.value = 'note'; ta.dispatchEvent(new dom.window.Event('input'));
click(d.querySelector('.editor [data-ed=save]'));
console.log(d.getElementById('meta').textContent);   // "Comments1"
```

To serve a page in jsdom as if from `--serve`, replace the `server-src`
placeholder with `{"token":"t"}` before constructing it. jsdom doesn't
implement `scrollIntoView` or `scrollTo`, so errors naming those are expected.

That catches script errors and wrong arithmetic. It does **not** compute layout,
so sticky positioning and visual stacking still need a human (or a screenshot)
to confirm. Say so rather than claiming the layout is verified.

For the highlighter specifically, assert *fidelity*: collect every
`tr[data-r] td.c` textContent per file (unified view; in split view, the
`tr.sp td.c:not(.re)` cells) and compare it to the raw diff lines, grouping by
file rather than by document order, since the reading guide reorders the
sections. Highlighting must never change a single character of what is
displayed. Expanded lines are `tr.x` rows without `data-r`; check them against
`git show <headRev>:<path>` by their line numbers, on both sides.

To test expanding in jsdom, stub `window.fetch` in `beforeParse` to answer
`/api/file?path=...` from `git show`. Stub `navigator.clipboard` there too if
the test clicks a Copy button: jsdom has neither.

Note that `file://` URLs are blocked for the Claude-in-Chrome browser tools, so
screenshotting the page needs `--serve` (or another local HTTP server), and
that may also be blocked by the sandbox. `open` in the user's own browser is the
reliable route.
