# The review page

How the built page reads and submits. `SKILL.md` covers building it; this is
for answering the reviewer's questions about the page and for reporting what a
submit did.

## Reading the page

- **Steps.** The header's **Overview / Code / Submit** switch steps (keys `1`,
  `2`, `3`; hashes `#overview`, `#code`, `#submit`). In the code step,
  **Recommendations / Code** (key `r`) switches mode; the choice is remembered
  per PR, and Recommendations is the default. Progress follows the mode:
  recommendations decided in Recommendations, changed lines viewed in Code. A file or group anchor
  (`#f3`, `#g1`), like the links in the overview, opens the code at that spot,
  and returning to the code restores where you were. The sidebar shows the
  feature-check count.
- **Existing threads.** With `--pr`, the PR's review threads are loaded at build
  time and shown inline at their lines, with author, date and a link to GitHub.
  Resolved threads start collapsed. Outdated threads, or every thread when the
  page isn't at the PR head, sit at the top of their file. **Reply** drafts a
  reply that is posted as part of the review. Your own pending (unsubmitted)
  GitHub comments are not shown. GitHub bodies render through the page's Markdown,
  so raw HTML in them (like `<img>` tags) shows as text, and Markdown images
  show as links (only pasted attachments render inline), so opening the page
  never fetches from a host a commenter chose.
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
- **Keyboard.** `r` Recommendations or Code, `j`/`k` next/previous file, `v` toggle Viewed, `x` collapse,
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
- **Finish review** opens the submit page (`#submit`), which is for writing
  the final message and sending it:
  - a strip of what still needs the reviewer (CI, undecided recommendations,
    unchecked feature checks, suggested comments not taken, stale comments),
    each a link to where it is decided; only stale comments block submitting;
  - the summary editor, whose **Preview the full review** tab shows the whole
    body as it will post: the summary, then the **Recommendations** and
    **Feature concerns** the page adds, then a line on the comments that ride
    along. A line under it says what will be posted;
  - one button per verdict, each of which submits: **Request changes**,
    **Comment**, **Approve** and **Ship it** (an approval with `:shipit:` added
    to the end of the summary). Comment and Request changes need something
    written. On the reviewer's own PR only Comment is open (the build records
    the viewer as `pr.viewer`). With CI failing, Approve and Ship it take a
    second click on the same button, which says why. Without a PR the button
    is **Copy review as Markdown**;
  - the comments (with their code; replies quote what they answer, and
    pending suggestions can be accepted or dismissed), recommendations, feature
    checks and auto-reviewed files, each folded with its counts in the heading;
  - an Export row: **Copy as Markdown** (to hand the review to an agent or
    paste it anywhere) and **Copy as JSON** (for `submit-review.cjs`).

  Submitting (served pages with a PR) posts everything as one review, clears
  the drafts so they can't double-post, and moves to a "Review submitted"
  page (`#done`, "Shipped it" with the squirrel for Ship it) with the verdict,
  counts, any notes and a link to the review.
- Every comment editor's **Preview** shows only what will be posted: the
  formatting toolbar, hint and attachment chips hide until **Write**.

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
- posts an Approve with no summary or comments as a plain approval; Comment
  and Request changes need one or the other, since GitHub requires a body;
- refuses Approve or Request changes on the user's own PR (GitHub doesn't
  allow it) with a clear message;
- **cannot upload attachments**: GitHub has no API for that. It saves them to
  `tmp/review/<slug>-attachments/`, puts `[attachment: name]` where they were,
  and says which to drag in on GitHub. Tell the user this when they attach files.

Never submit on the user's behalf from the terminal unless they ask. The submit
page is their approval step.

## Drafts and re-reviews

Drafts are stored per PR, so the full page and a `--since` page share them.
Viewed checkmarks are tied to each file's blob at the reviewed commit: one
survives a rebuild or a `--since` page while the file is unchanged, and comes
back unticked with a "changed since you viewed it" badge once it changes.
