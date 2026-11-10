---
name: ui-qa
description: >-
  Fast before/after UI QA of a branch or PR in a Rails app. Gathers what "done" means from the
  ticket and the PR, then has the ui-qa agent seed data with factories, capture the changed
  screens on this checkout and on the base commit, diff every capture, measure layout problems
  in the page, and judge only what changed. Publishes a report with screenshots. Use when the
  user says "/ui-qa", "QA this", "QA the PR", "check the UI", "did this break anything", "verify
  the change looks right", or wants a seeded browser to poke at a feature by hand.
metadata:
  author: rolemodel
  version: "1.0"
  triggers: "ui qa, qa this, qa the pr, check the ui, did this break anything, verify the change looks right, visual regression, before and after screenshots, seeded browser"
license: MIT
---

# UI QA

Answers two questions about a change, cheaply enough to run on every PR:

1. Does the changed UI do what the ticket asked for, and look right?
2. Did anything else change that nobody intended?

Scripts do the capturing and the diffing. You gather the context and write a brief; the `ui-qa`
agent writes a scenario, runs it, and judges only what differs; you publish its report. Don't
drive the browser step by step, and don't run the capture yourself unless the user asks for a
seeded browser (step 5).

`$Q` is `scripts/ui-qa` in this skill's directory, as an absolute path.

## Requirements

- RSpec system specs with FactoryBot and `capybara-playwright-driver`, on Postgres.
- `config/database.yml` reads the test database name from an environment variable, so the base
  checkout can use its own database. Default `DATABASE_TEST_NAME`; set `UI_QA_DATABASE_ENV` if
  the app uses another.
- Assets build with `yarn build` into `app/assets/builds`, or set `UI_QA_BUILD`.
- `ruby-vips` loadable from the app's bundle, and `jq`.

## 1. What "done" means

- The ticket: take the ID from the branch name or PR title and read it with the tracker tool
  (Linear, Jira), with its comments when the description points to a discussion. Pull out the
  acceptance criteria as a short checklist. No ticket: use the user's words, then the PR body.
- `gh pr view --json title,body` for what the author says changed.

## 2. Map the change to screens

- `git diff $(git merge-base HEAD <default branch>) --stat` (for an already-merged PR, its
  parent), then read the hunks that can change what a user sees. Judge by effect, not file type:
  `lib/`, models, validations, locale files and i18n backends change pages too. If nothing can
  reach a screen, stop and say so in one line.
- A changed partial: grep for where it's rendered. A CSS class: grep the class name in views,
  components and JavaScript. A global change (shared CSS, a backend, a form builder): the page
  the ticket is about plus one unrelated page that uses the same thing.
- For each screen, the states worth seeing (empty, filled, error, after submit) and the existing
  system spec whose setup fits.

## 3. Brief the agent

Spawn `subagent_type: "ui-qa"` with this brief, filled in:

```
Checkout: <absolute path of this checkout>
Q: <absolute path of scripts/ui-qa>
Base: <sha>
Report out: <omit unless the checkout is outside this session's working directory>
Intent: <one or two sentences>
Acceptance criteria:
- <criterion>
Screens:
- <screen>: <states>; setup from <spec path>
Regression risk: <pages that share the changed code>
Project pitfalls: <setup traps from the project's docs, if any>
Probe: <yes, and the constraints to try | no>
```

## 4. Publish

The agent returns the verdict and the `page`, `root` and `files` lines from its report. Publish
with the Artifact tool when there is one: `file_path` the page, `root` and `files` as given. The
page is generated, so skip any page-design pass. If `tmp/ui-qa/artifact_url` exists, update that
artifact so reruns on a branch keep one link; otherwise write the new URL there. Without an
Artifact tool, give the user the page's path.

In chat give the verdict, one line per bug, unexpected finding, or unmet acceptance criterion,
and the link. The scenario stays in `tmp/ui-qa/`, so a rerun after a fix is one more agent pass.

## 5. A seeded browser to click around in

`$Q init`, fill in the scenario's setup and `visit`, then `$Q run --headed`: the browser stays
open, signed in, until the user presses Enter.

## Gotchas

- **A capture can look clean while showing the wrong state.** Missing setup (a role, a required
  child record) renders an error page on both sides, which diffs as "unchanged". The summary
  prints each capture's heading and alerts so the agent can spot it.
- **Spec tags carry behavior.** A tag that turns on translations, cassettes or a feature flag
  must come along with the setup, judged by the changed code. Without it the bug doesn't
  reproduce and a clean diff is false.
- **The base run stops at the first step it can't do.** Capture pages that exist on base before
  any branch-only step, or they come out `new` with nothing to compare.
- **Reading screenshots is the expensive part.** The real bugs in testing were overlap,
  clipping and overflow, which the in-page layout checks measure for free. Judge from the
  summary's text and the issue crops first; new screens come as contact sheets.
- **Sonnet misses layout bugs without the measurements.** In testing it waved off a mobile
  overlap Opus caught, until the layout checks flagged it. Keep the checks on.
- **Fresh agents carry the session's whole tool list.** A general-purpose agent started at
  ~40k tokens before reading the brief; the `ui-qa` agent's short tool list starts near 10k.
- **One shared base worktree.** Parallel runs on different bases queue on its lock.
