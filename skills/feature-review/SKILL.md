---
name: feature-review
description: >-
  Reviews a PR, commit, range, or branch as a feature first and code second, in a
  local HTML page whose comments post back to the PR as one GitHub review. Use when
  the user asks to review a PR or commit, review the feature or shape of a change,
  or re-review a PR after new pushes: "review PR #123", "review this commit",
  "review the feature in PR #123", "re-review PR #123".
allowed-tools: Bash Read Write Edit Glob Grep AskUserQuestion
compatibility: Designed for Claude Code (or similar products). Posting to GitHub needs the gh CLI.
metadata:
  author: rolemodel
  version: '3.10'
license: MIT
---

# Feature Review

Turns a diff into an offline HTML page that reviews a change in three steps,
with comments that can be posted to the PR as one review:

1. **Overview**: what the PR's author said (a digest, their screenshots, and
   the full description folded away), the feature (what it does for the user,
   and checks to confirm it does it well), the **feature overview** (the
   flow end to end, each step pairing screenshots or recordings with what runs
   underneath, the groups that do it, and its checks), and the shape of the change (layers, objects, departures
   from the architecture, and how the codebase's shape moved), with diagrams.
2. **Code**, in two modes switched in the header (or `r`):
   - **Recommendations** (the default): each reading-guide group as a short
     gist with its visuals (diagrams, screenshots, screen recordings) and the
     recommendations to answer yes or no. Each one bundles the line comments
     it stands for, so a large change can be reviewed at this height.
   - **Code**: the diff, file by file, in reading-guide order, with diagrams
     next to the complex groups.
3. **Submit**: the summary, verdict, comments and feature concerns, posted as
   one review.

The emphasis is on the quality of the feature; the code is the fallback for
confirming it.

## Usage

```bash
S=~/.claude/skills/feature-review/scripts
node $S/build-review.cjs <commit-ish>                 # this commit vs its parent
node $S/build-review.cjs <base>..<head>               # or <base>...<head> from the merge base
node $S/build-review.cjs --pr <N|url|owner/repo#N>    # the PR's diff; comments can post to it
node $S/build-review.cjs <ref> --pr <N>               # a commit or range inside that PR
node $S/build-review.cjs <ref> --groups path.groups.json   # reading guide (below)
node $S/build-review.cjs <ref> --pr <N> --serve       # serve on localhost: Submit, and expanding context
node $S/build-review.cjs --pr <N> --since last        # re-review: only what changed since your last review
node $S/build-review.cjs --pr <N> --since <sha>       # ...or since any commit (falls back to last after a force-push)
node $S/build-review.cjs --pr <N> --no-threads        # skip loading the PR's existing review threads
node $S/build-review.cjs --pr <N> --no-description    # skip the PR description and its screenshots
node $S/pr-media.cjs --pr <N>                         # download the description's screenshots, to reuse as visuals
node $S/build-review.cjs <ref> -o path.html --title "..." --event approve
git diff ... | node $S/build-review.cjs --stdin -o path.html
```

The script prints the output path on stdout (with `--serve`, the URL). Output
defaults to `tmp/review/<slug>.html` **relative to the current working
directory**, where the slug is a ticket ID from the commit or PR title (e.g.
`ABC-123`), `pr-<N>`, or the short SHA. In a repo that doesn't gitignore
`tmp/`, pass `-o` rather than leaving untracked files behind.

## Workflow

1. **Gather.** Work out the diff, the PR, and the intent from whatever the user
   gave you: PR, commit, range, branch, or ticket ID. Recipes for each are in
   `references/gathering.md`. Always look for a PR, because that decides
   whether the page can post comments. With a PR, read its description and run
   `node $S/pr-media.cjs --pr <N>` to download its screenshots for reuse.
2. **Load preferences and the project's review rules.** Read
   `~/.claude/feature-review/preferences.md`. If it doesn't exist, this is
   their first use: ask them (below) before continuing. Then run
   `node $S/review-guides.cjs` in the repo: it finds `REVIEW.md` at the root,
   fetches the shared guides it lists, and prints where each one is. Read
   `REVIEW.md` and every guide it prints. They are what you review against:
   recommendations should follow from them, and the project's rules win over
   the user's preferences on conflicts. No `REVIEW.md` is fine; review on
   general judgement. Format: `references/review-md.md`.
   Then run `node $S/decision-patterns.cjs`. If it prints a `pattern:`
   (something the reviewer declined in at least 70% of 5 or more
   recommendations), ask them with AskUserQuestion whether to add a line about
   it to their preferences file (offer: add it, as you phrase it from the
   declined and kept titles; not now; never). Edit the file only on "add it",
   under a `## Learned from your decisions` heading, with the date. Whatever
   they answer, run `node $S/decision-patterns.cjs --ack <key>` so it isn't
   asked again until five more decisions come in. Skip this step when
   building a page for someone else's review.
3. **Read the change** (`git show --stat`, the PR body or ticket, the diff, and
   the touched files at the head where the shape question needs them), then
   write `tmp/review/<slug>.groups.json`, in this order:
   - the **overview** first (author digest, feature, checks, feature
     overview, shape, diagrams): read `references/overview.md` for the
     format and what each part is for;
   - then the **reading guide**, with auto-reviews, a gist for each group
     (`summary`, `points`), and the **recommendations** that carry your
     comments: read `references/recommendations.md` for the format and how to
     fold comments into recommendations;
   - then **visuals**: diagrams for the complex groups, and screenshots or
     short screen recordings of any UI change, captured with Playwright or the
     Chrome extension (recipes in `references/recommendations.md`). Skip
     captures when the app can't run, and say so in the report.
4. **Build** with `--groups` (and `--pr`). Skip the overview and guide only for
   a diff small enough to read top-to-bottom, or if the user declines them. With `--pr` the
   build looks up the user's last submitted review on the PR (see
   **Re-reviewing** below) and prints a `re-review:` line.
5. **Open it.**
   - **If `FEATURE_REVIEW_NO_OPEN` is set** (the build prints
     `open: skipped (FEATURE_REVIEW_NO_OPEN)`), never run `open`: something
     else, such as a menu bar app, opens the page. Still build, still `--serve`
     in the background, and report the URL or path.
   - With a PR: run the build with `--serve` **in the background** (Bash
     `run_in_background`), then `open` the URL it prints. The server exits after
     a successful submit, which notifies you; report the review URL and any notes
     it printed. The page itself moves on to a "Review submitted" screen.
   - Without a PR: `open <path>`; the submit page offers Copy as Markdown,
     which the user pastes back to hand you their comments. Serve it the same
     way if they want to expand context around hunks (which reads files
     through the server).
6. **Report** the self-check, groups and overview lines, a one-line summary of
   the feature and of the shape (plus any departures you flagged), the PR (or that there isn't one),
   the `review-guides:` line (or that there is no `REVIEW.md`), the `ci:`
   line (say plainly if anything is failing), the
   recommendations (titles, and how many comments each bundles), the
   `media:` and `description:` lines, what you captured for the feature
   overview (or why nothing), the `threads:` and `re-review:` lines, the commit's file/line totals, and the
   list of auto-reviewed files with their one-line summaries so the user knows
   what they are trusting you on.

If the user hands back a review as pasted Markdown, act on it. A submitted
review is also saved as `tmp/review/<slug>.review.md` and `.review.json` next
to the page, attachments included (their paths are in the Markdown).

## First use: ask how they review

When `~/.claude/feature-review/preferences.md` is missing, ask with
AskUserQuestion, one round, up to four questions:

- **Grouping order**: follow the data flow (models, then callers, then UI);
  top-down (entry point first); tests first, as the spec; or by feature.
- **Tests**: next to the code they cover, or in their own group at the end.
- **Auto-review**: off; conservative (trivial and clearly unrelated only); or
  aggressive (any small mechanical change).
- **Suggested comments**: bugs and risks only; also style and naming; or none.

Write the answers into the template at `references/preferences-template.md`,
save it to `~/.claude/feature-review/preferences.md`, and tell the user where it
is so they can edit it. Don't ask again once it exists. If they'd rather not
answer, write the template with the defaults (data flow, tests with their code,
conservative, bugs and risks only) and carry on.

## The overview

The page opens on the overview when there is one (and afterwards on whichever
step the reviewer was last on). It has four parts, written by you under
`overview` in the groups file:

- **From the PR description** (`author`): your digest of what the author said
  and why, and where the code differs from it. The page adds the description's
  screenshots and the full text, folded away.
- **The feature**: what the change does, the behaviour before and after, and
  **feature checks**: behaviour for the reviewer to confirm, each marked Looks
  right or Concern. Concerns and their notes are added to the review summary.
- **Feature overview** (`connection`): how it all comes together. A short
  end-to-end summary, how it works technically, then the flow step by step:
  each step pairs what the user sees (screenshots, recordings) with a short,
  optional "Under the hood" note (folded by default), links the groups and
  files that do it, and holds the checks that test it. Make it as visual as you can.
- **The shape**: the shape of this change (layers, objects, new dependencies,
  departures from the architecture instructions) and how it moves the shape
  of the codebase as a whole, always with a `structure` diagram that marks
  what was added, changed and removed. Under it the page adds two computed
  blocks, from git: lines changed per area, and every touched file's length
  before and after.

Diagrams (`structure`, `sequence`, `compare`, or hand-written `html`/`svg`) go
in either part, and can also be pinned to a reading-guide group so they show
next to the complex code they explain. Full format, guidance and examples:
`references/overview.md`. Without an overview the page opens on the code, and
the Overview step shows only the computed shape.

## The reading guide

The groups of files in reading order, each with a one-line `why`, written next
to `overview` in the groups file. Lead with the group that explains the change;
mechanical fallout goes last. Shape the groups to the user's preferences file.
Files you leave out still render, in a trailing "Unsorted" group.

**Auto-review** a file (collapse it with a one-line summary so the reviewer can
skip it) only when it is small, incidental to the request, not a key file
(config, migrations, routes, auth, policies, security, public API, deletions),
and you found nothing wrong. Keep auto-reviewed lines well under a quarter of
the diff, and honor "off" in the preferences.

Format, the auto-review rules in full, and bare `suggestions`:
`references/reading-guide.md`.

## Recommendations

The code step opens on the Recommendations view, built from the guide: one
card per group with its `summary`, up to four `points`, its pinned diagrams and
media, and its files as chips (folded by default) that open the diff. Your
review comments live here as **recommendations**: one action each, which the
reviewer answers Yes (its comments go into the review, or a general one into
the summary) or No. Each also has a few short sections (`context`,
`problem`, `proposal`, `tradeoffs`), one sentence each and two at most, in
plain words rather than code; its `kind` decides which. A recommendation can
carry `visuals` (any diagram kind), `checks` (ids of feature checks it bears
on, which then show on it with their Looks right / Concern buttons; a concern
says yes to it), and a `principle` (the section of a shared guide it rests on,
copied into the page for the reviewer to read).
Inside a recommendation the reviewer can also accept, edit or dismiss each
comment on its own, and click its path to open the diff at that line.
Fold comments that ask for the same thing into one recommendation; it is not
one to one. Keep every card light: if a group needs more than a couple of
sentences, give it a diagram or a screenshot instead of more words.

Format, the media kinds (`image`, `video`) and how to capture them:
`references/recommendations.md`.

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

**`FEATURE_REVIEW_SINCE=<sha>`**: when re-reviewing and this is set, build with
`--since $FEATURE_REVIEW_SINCE` instead of `--since last`. It is the head the
user last actually saw, which can be newer than their last submitted review.
If that commit is gone or no longer on the branch (a force-push), the build
falls back to your last review on its own and says so in the `re-review:`
line; report that. With no review to fall back to it fails: rebuild with
`--since last`, or the full page, and say why.

A re-review stays on the delta:

- **Lead with what changed since that commit**: a short summary of the new
  commits (`git log --oneline <since>..<head>`) and what they do, as the
  `author` digest or the start of the feature section.
- **Go through the earlier threads and comments** (the `threads:` line, and
  your saved `tmp/review/<slug>.review.md` if there is one) and say which ones
  the new work addresses and which are still open. Recommend resolving or
  replying to each rather than repeating it.
- **Review only the delta.** Recommendations and checks are about the new
  changes; earlier code comes in only where the new work depends on it.

## The page and submitting

The reviewer drives the page; `references/page.md` describes its steps, keys,
existing threads, expanding context, the submit page, and what
`submit-review.cjs` does with each comment. Read it when the reviewer asks how
something on the page works, or before reporting what a submit posted.

`submit-review.cjs` does the posting, and can be run by hand on a saved or
copied JSON: `pbpaste | node $S/submit-review.cjs - [--dry-run]`. Comments
GitHub would reject are moved into the review summary rather than failing the
whole review.

**Never submit on the user's behalf from the terminal unless they ask.** The
submit page is their approval step.

## Files

- `scripts/build-review.cjs`: builds the page, runs the self-check and guide validation.
- `scripts/decision-patterns.cjs`: what the reviewer keeps declining, from the decisions each served review logs (`lib/decisions.cjs`).
- `scripts/review-guides.cjs`: reads the repo's `REVIEW.md`, fetches the shared guides it lists through `gh` and caches them (`lib/review-guides.cjs`, shared with the build for principles).
- `scripts/pr-media.cjs`: downloads a PR description's screenshots and recordings (`lib/pr-media.cjs`, shared with the build).
- `scripts/serve-review.cjs`: localhost server for Save, Submit and `/api/file` (also runs standalone on a built page).
- `scripts/submit-review.cjs`: posts a review JSON through `gh`; `saveReview` writes the Markdown and JSON.
- `scripts/lib/events.cjs`: the optional event log and `FEATURE_REVIEW_NO_OPEN` check.
- `scripts/lib/diff-parse.cjs`: the one diff parser, used by all three and inlined into the page.
- `scripts/page/`: `style.css`, `highlight.js`, `markdown.js`, `diagrams.js`, `app.js`, inlined into every page.
- `references/overview.md`: the overview format (feature, checks, shape, diagrams) and how to write it.
- `references/recommendations.md`: group gists, recommendations, screenshots and recordings, and how to capture them.
- `references/review-md.md`: the `REVIEW.md` format for a project's review rules and shared guides.
- `references/reading-guide.md`: groups, auto-review and suggested comments.
- `references/gathering.md`: how to get from a PR, commit, range, branch, or ticket ID to a build.
- `references/preferences-template.md`: the per-user preferences file.
- `references/page.md`: the page's steps, keys, threads, submit page and posting rules.
- `references/developing.md`: constraints, the highlighter, and how to verify a change to the page.

## Hooks for other tools

Both are off unless set, so a plain run is unchanged:

- `FEATURE_REVIEW_NO_OPEN=1`: don't `open` the page (step 5).
- `FEATURE_REVIEW_EVENTS_DIR=<dir>`: the scripts append JSON lines to
  `<dir>/<owner>__<repo>__<pr>.jsonl` (PR reviews only), each with `ts`, `pr`
  and `repo`: `built` (`url` or null, `path`, `head_sha`, `rereview`,
  `since_sha`), `opened` (first load of the page in a server run),
  `submitted` (`review_url`, `commit_id`) and `server_exit`. A failed write is
  ignored (`scripts/lib/events.cjs`).

## Gotchas

- **The Node scripts must keep their `.cjs` extension.** Many repos set
  `"type": "module"` in `package.json`, which makes a `.js` file an ES module
  and breaks `require`.
- **Output lands in the current repo's `tmp/review/`.** In a repo that doesn't
  gitignore `tmp/`, pass `-o` rather than leaving untracked files behind.
- **GitHub has no API for uploading attachments.** `submit-review.cjs` saves
  them to `tmp/review/<slug>-attachments/`, puts `[attachment: name]` where
  they were, and says which to drag in on GitHub. Tell the user when they
  attach files.
- **GitHub won't let the author approve or request changes on their own PR.**
  The page only offers Comment there; don't try to work around it.
- **`file://` URLs are blocked for the Claude-in-Chrome tools**, and the
  sandbox may block `--serve` too. `open` in the user's own browser is the
  reliable route.
- **Changing the page?** Read `references/developing.md` first, and check
  the change in a browser, not only by reading the code.
