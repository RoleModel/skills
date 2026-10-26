---
name: create-pr
description: >
  Opens pull requests with a consistent description format and assignment. Use when the user asks to open, create, file, or draft a PR or pull request, push a branch for review, or write a PR description.
metadata:
  author: rolemodelsoftware
  version: "2.0"
  triggers: "open a PR, create a PR, file a PR, draft a PR, pull request, PR description, write the PR body, update the PR description, push this for review, put this up for review, ready for review"
allowed-tools: Bash(git status:*), Bash(git fetch:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git switch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(ls:*), Bash(gh pr create:*), Bash(gh pr edit:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh api user:*), Bash(git merge-base:*), Bash(git rev-list:*), Bash(git rev-parse:*), Read, Write
---

# Creating a Pull Request

## Gather context

Run as one batch:

```bash
git status
git fetch origin
gh pr list --head "$(git branch --show-current)" --state open --json number,url,title,baseRefName
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md .github/PULL_REQUEST_TEMPLATE/ docs/pull_request_template.md pull_request_template.md 2>/dev/null
```

An open PR means updating it — `gh pr create` fails on a branch that already has one.

Never commit on the default branch. On `main` or `master`, create a branch with `git switch -c <branch>` and tell the user its name. When there is a ticket, start the name with its ID (`abc-123-add-invite-status`). Only ever create a new branch — switching to an existing one changes which work the PR describes.

**Base.** An existing PR keeps its `baseRefName`. Otherwise use the branch this one was cut from — often another open PR's branch or an epic branch, not the default. The candidates are the default branch and every other open PR's head (`gh pr list --state open --json headRefName`). For each, count `git rev-list --count $(git merge-base origin/<candidate> HEAD)..HEAD`; the lowest count wins, and ties go to the default. Skip a candidate cut from this branch, where the merge base is HEAD but the tip isn't. If `gh` fails, use the default branch. The user can name a different one. Then read the work against it:

```bash
git log --oneline <base>..HEAD
git diff <base>...HEAD
```

Three dots — two compares against the base's current tip and misdescribes the PR. Read the full diff: the description comes from what the code now does, not file names or commit messages. No commits ahead of the base means the work may be uncommitted; describe it from the working-tree diff.

When the branch or commits carry a ticket ID and a tracker tool is available (Linear, Jira), read the ticket — it is the best source for **Why**.

When the diff changes the UI, settle **Screenshots** now (see below) so the first draft includes them.

## Confirm before acting

Before committing, pushing, creating, or editing, show the base, title, and body as plain text in your reply, plus anything you would commit or push. Wait for approval; revise until given. When the user commits and pushes themselves, hand them the commands instead.

Commit uncommitted work before pushing — the PR only carries what is pushed. Stage named paths, never `git add -A`. Check `git status` after staging; if anything unexpected appears, stop and ask.

## Create or update

Write the body to a file in the scratchpad — always `--body-file`, never `--body`, which mangles backticks and `$`.

```bash
git push -u origin HEAD
gh pr create --base <base> --title "<title>" --body-file <path> --assignee @me   # add --draft when unfinished
```

`--assignee @me` assigns whoever `gh` is authenticated as; if it fails, use `gh api user --jq .login`. Add the reviewers the user names, or those the repo's `AGENTS.md` or contributing docs ask for; otherwise none.

For an existing PR, read it first with `gh pr view <pr> --json title,body`, then `gh pr edit <pr> --title "<title>" --body-file <path>`. The file replaces the whole body, so carry every heading and keep what the user wrote under **Screenshots** and any boxes they ticked. Don't reassign or re-add reviewers. Rewrite awkward existing prose rather than copying it.

Print the PR URL when done.

## Description format

A repo PR template sets the shape. Otherwise use **Why**, **What Changed**, **Post-merge**, **Screenshots**, in that order, as `##` headings; the last two only when needed.

- **What Changed**: every box checked — each line is done work.
- **Post-merge**: work someone must do after merging (a backfill, a config change). Boxes unchecked; one line each saying what to run and what stays broken until it runs.
- **Screenshots**: when the diff changes the UI, ask the user which applies:
  1. **You take them** — the repo's documented method if its docs describe one, else a browser tool, simulator, or dev server. Record the screen too when the change is motion or a multi-step flow a still can't show, and make sure the cursor shows in it. Save to the scratchpad, keep credentials and customer data out of frame, and view each image before attaching; one that looks wrong is a bug to fix, not a shot to retake.
  2. **They take them** — leave the heading and subheadings empty, and say so with the URL.
  3. **None** — omit the section.

  No UI change means omit it without asking. A template instruction to keep the heading wins: write `N/A — no UI changes` under it.

Reference each image by path (`![Invite list](<scratchpad>/invite.png)`) and pass the same path to `--attach`; `gh` (2.99.0+) uploads it and rewrites the reference. If an upload fails, the PR still opens — tell the user which are missing. Videos render as a player and take no alt text, so write one line under **Screenshots** saying what each recording shows.

### The repo's template

Read it first — `--body-file` replaces it outright. Keep its headings, wording, and order (except **Screenshots**, which follows the rules above); add none. Fill each placeholder, and follow its instructions, such as deleting a section that doesn't apply. Apply the **Why** rules to its equivalent (**Why?**, **Summary**, **Motivation**) and the **What Changed** rules to its list of changes.

In its checklists, check what this PR did, check and strike through what doesn't apply (`- [x] ~~Updated relevant READMEs~~`), and leave unchecked only what applies but isn't done. Leave sections only the user can answer for them. Mention both with the URL, along with any post-merge work the template has no place for.

## Writing rules

**Why**

- At most two sentences per feature, preferably one; one paragraph per feature, each on a single line — GitHub renders newlines in a PR body as line breaks.
- Explain the user-facing problem and how the change solves it.
- Anything a reviewer would question — an odd workaround, a surprising dependency — gets one sentence, two at most across the PR, in a final paragraph.
- Facts, not narrative: no stock phrases ("it turns out"), before/after rhetoric, or implied fault. Every clause carries a fact a reviewer can act on; claim no more than the change does.
- No ticket IDs or links. Inline code at most twice.

**What Changed**

- Five lines at most, roughly a dozen words each. Fold supporting changes into the line they serve and drop plumbing the diff shows anyway.
- Say what the change does, not how — no file, class, or method names unless meaningless without them.
- One clause per line: no "so that", "because", "rather than", "which". Never restate **Why**.
- Skip tests. A new or removed dependency always gets its own line. Group trivial churn into one line.

**Title**

- One line, under 70 characters including the prefix, no trailing period. Match the mood and casing of the repo's recent titles (`gh pr list --state all --limit 15 --json title`); imperative when there are none.
- Prefix the uppercased ticket ID in brackets — `[ABC-123] Add delivery status to invite list`, even from branch `abc-123-…`. Look in the branch name, then the ticket a tracker tool links to the branch, then commits. If none has one but recent titles use IDs, ask; otherwise skip it.

**Never sign the body** — no "Generated with" footer, AI attribution, or co-author line, even when session instructions ask for one.

## Cut before showing

The caps are ceilings. Give every draft one cutting pass: drop the unexpected-detail paragraph unless a reviewer would be surprised without it, merge **What Changed** lines a reviewer would read as one (three or four is typical), and cut clauses that explain how the code works. Asked for shorter, cut whole lines, not words.

| Too long | Right |
| --- | --- |
| "Emergency contact answers now create a contact on the profile, correcting an existing one's phone number on resubmission rather than duplicating it" | "Sync application emergency contacts to the profile" |
| "Removed a duplicated supplementary-form lookup so submission and projection share one definition" | "Deduplicate the supplementary-form lookup" |
