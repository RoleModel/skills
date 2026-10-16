---
name: make-it-right
description: >-
  The "make it right" pass after code works. Tests whether the change meets
  its requirements and reviews whether it is done correctly, verifies every
  finding against the source, fixes them, and reports what a human still
  needs to look at. Use when the user says "make it right", "review and fix",
  "clean this up before the PR", "get this up to standard", "review my
  changes", "code review this branch", "is this ready for review", "simplify
  this", "YAGNI review", or "QA this in the browser", or when a feature works
  and is about to go to `create-pr`.
metadata:
  author: rolemodel
  version: "2.2"
  triggers: "make it right, review and fix, code review, review my changes, review this branch, clean this up, get this up to standard, ready for review, simplify, yagni review, over-engineered, qa in the browser, before the pr"
license: MIT
---

# Make It Right

"Make it work" got the change running. This pass makes it trustworthy. Two
groups of agents look at it:

- **Test** asks whether the requirements are met. These agents run things:
  specs, the app, a browser.
- **Review** asks whether it is done correctly. These agents only read.

A verifier subagent checks their findings. This session fixes them and
reports, then offers [`make-it-fast`](../make-it-fast) before
[`create-pr`](../create-pr). `SKILL_DIR` is the directory this file was loaded
from. `make-it-fast` refers to these steps by number; renumber both.

The principle files deal in principles. Stack and project knowledge enters
through two hooks that step 1 resolves once and every agent receives: **Rule
sources**, the project's own rules, which win over everything else; and the
**Stack map**, `references/stacks/<stack>.md`, this stack's spellings under
headings the principle files cite. No map means the principles run as written.

## Arguments

- A base ref (default: the merge base with the default branch).
- `threshold=critical|high|medium|low`: the lowest severity fixed in
  **existing** code (default `high`).
- `skip=<principle>,…` by file name: `skip=ui-ux,blast-radius`.
- `report-only`: stop after step 4; a passed redesign goes under "Look here".
- `redesign=ask|apply` (default `ask`): see `references/redesign.md`.

## 1. Gather the packet

```bash
git fetch -q origin && git remote set-head origin -a >/dev/null 2>&1
BASE=$(git merge-base HEAD "$(git symbolic-ref --short refs/remotes/origin/HEAD)")  # or the user's ref
OUT=$(mktemp -d)
git diff --stat "$BASE"; git status --short
"$SKILL_DIR/scripts/new_lines.sh" "$BASE" > "$OUT/new_lines.txt"
```

Lines in `new_lines.txt` are **new code**; every other line is **existing
code**, even in files the change edited, unless the defect exists only
because of the change (the verifier decides).

Write the change's **intent** in one or two sentences. If a ticket is named,
copy its acceptance criteria; otherwise use the conversation, PR description,
or commits, or state the intent you're assuming.

**Rule sources.** List in `$OUT/rules.txt`: `AGENTS.md` / `CLAUDE.md`,
`docs/conventions/*.md`, and every installed skill (`.claude/skills/*/SKILL.md`,
`$SKILL_DIR/../*/SKILL.md`) whose description or triggers match a changed
file's directory or extension.

**Stack map.** Pick one by detection: a `Gemfile` naming `rails` →
`$SKILL_DIR/references/stacks/rails.md`; no match → none. From its "Leans on"
table, the sibling files that exist are `Also read`; the missing go in the
report once.

**Commands.** From the rule sources, then the stack map's "Linters and check"
and "Boot and data": lint, specs for files, full suite, boot, seed. Write them
to `$OUT/commands.txt`.

## 2. Run the linters and specs

Run the linters with autocorrect on (keep what it changes), and the specs for
the changed files. Reviewers never report what a linter catches. A failing
spec means the change doesn't work yet: fix it when the fix is small, else
stop and say so. Rerun each failure alone, then in a worktree at the base
(`git worktree add "$OUT/base" "$BASE"`, if the project's setup runs there):
one that passes alone is flaky, one that fails on the base was already broken.
Report both; neither counts against the change. Leave the stack map's
"Scanners left to CI" to CI.

## 3. Launch the agents

| Group | Principle | File | Run when the change touches |
|---|---|---|---|
| test | acceptance | `test/acceptance.md` | any behavior |
| test | coverage | `test/coverage.md` | any behavior |
| test | blast-radius | `test/blast-radius.md` | existing code, not only new files |
| test | ui-ux | `test/ui-ux.md` | anything that renders a screen: views, components, client-side code, CSS, routes |
| review | security | `review/security.md` | anything but CSS, docs, or specs alone |
| review | maintainable | `review/maintainable.md` | any code |
| review | readability | `review/readability.md` | any code |
| review | conventions | `review/conventions.md` | any code |
| review | data-patterns | `review/data-patterns.md` | anything that stores or migrates data: models, migrations, queries, jobs, exports |

**Small change** (≤ 50 lines, ≤ 3 files): no subagents. Check it yourself
against each principle file that applies, then do the verifier's checks from
`references/verifier.md`, score and `new` / `existing` mark included.

**Otherwise**, launch every principle that applies except `ui-ux` (step 6) in
**one message**, as parallel general-purpose subagents, giving each only the
**packet**:

> SKILL_DIR is `<SKILL_DIR>`. Read `<SKILL_DIR>/<group>/<principle>.md` and
> `<SKILL_DIR>/references/findings.md`, then check the change.
> The change is `git diff <BASE>` plus any untracked files listed in
> `<path to new_lines.txt>`. Intent: `<intent and criteria>`.
> Rule sources: `<path to rules.txt>`. Stack map: `<path, or none>`.
> Also read: `<paths found, or none>`. Commands: `<path to commands.txt>`.

Add for **review** agents: "Read only. Do not edit, create, or delete any
file." For **test** agents: "You may run specs and the app. Do not edit app
code or specs; report what's missing." Never pass this session's history: an
agent that knows why the author chose something stops questioning it.

When they return, run `git status --short`. Revert any file an agent changed
and note it in the report.

## 4. Track and verify

Put every finding on a task list as it arrives. The run ends when the list is
empty, every open item names its blocker, or round 2 is done. Don't end a turn
by announcing the next step; take it.

Launch one subagent with the packet, the principle file replaced by
`<SKILL_DIR>/references/verifier.md`, the review agents' read-only line, and
every finding. It merges, checks,
scores, and marks each `new` or `existing`. Keep findings scored **75 or
above**. Its open questions go to "Look here", the three with the widest
effect; the rest go under "Not fixed" as `open question`.

Then snapshot the tree, staged but uncommitted, before any fix:
`git add -A && FIX_BASE=$(git write-tree)`. Round 2 diffs against it.

**Redesign.** If the verifier passes a `redesign:` finding, follow
`$SKILL_DIR/references/redesign.md` before step 5.

## 5. Address

**What gets fixed:** every kept `new` finding, whatever its severity, and
`existing` findings at or above `threshold`. The rest go under "Not fixed".

**Order.** Acceptance, blast radius, and security; then maintainable (deleted
code takes its findings with it), data patterns, readability, conventions;
coverage last. UI/UX fixes follow in step 6.

**How:**

- Fix serially in this session. Never have parallel agents edit files.
- For a bug, write the failing spec first, at the lowest level that shows it,
  then fix it. Specs go at the levels `$SKILL_DIR/test/coverage.md` sets, in the style of
  the test conventions skill the stack map names. Run each new spec without
  the fix and watch it fail for the reason you claim; if it passes, the setup
  doesn't reach the trigger, so change the setup, not the assertion.
- After each principle's batch, run the linters and the specs for the touched
  files. If a fix breaks something and two attempts don't repair it, revert
  that fix and report it.
- **Fix toward the intent.** When a finding has more than one fix, such as
  removing a control that does nothing or making it work, pick the one that
  makes the intent true, even when it's bigger.
- **Conflicts.** A fix that adds code must pass the ladder in
  `$SKILL_DIR/review/maintainable.md`. When adding structure and deleting it disagree,
  deleting wins, but never over behavior the intent asks for. Nothing removes
  what that file's "Never cut" lists; only coverage deletes a
  spec, and only a framework test or a duplicate.
- **Precedence.** A written rule outranks a general principle; one example in
  the codebase outranks neither.
- **Push back.** A verified finding can still be wrong for this change, such
  as one that conflicts with the intent or a written rule. Reject it with a
  one-line reason, in the report.

## 6. Round 2, then UI/UX

**Round 2.** Fixes are new code: rerun `"$SKILL_DIR/scripts/new_lines.sh"
"$BASE" > "$OUT/new_lines.txt"`. Then check only the fix hunks, as in step 3,
with the change set to `git diff $FIX_BASE` plus the untracked files. Pick principles from the step 3 table by
what each fix touches: always acceptance and conventions; security for a new
action, query, param, or response; coverage for an added or changed spec;
blast radius when existing behavior changes; data patterns when records are
copied, saved, or migrated differently; readability and maintainable when a
class or method is rewritten. Findings go through step 4; one that would undo
a fix from this run is rejected, naming the fix. Fix what survives, then stop,
even if findings remain, and list them as `round-2 limit`.

**UI/UX.** If it applies, launch `$SKILL_DIR/test/ui-ux.md` with the packet against the
fixed code. Subagents often lack browser tools; then walk the states yourself
from the same file. Its findings go through steps 4 and 5. After UI fixes,
re-walk only the states they touched, and run acceptance and conventions on
any fix hunk in server code or a template, as in round 2.

## 7. Finish

Run the linters and the full spec suite once. Leave the changes uncommitted
unless the user asked for commits. `create-pr` commits and opens the PR.
Offer `make-it-fast` when the change adds or alters queries, endpoints, jobs,
or spec setup, or any agent tagged a `fast:` finding; for copy, markup, or
style-only changes, say it's skipped. Report in one screen, in the shape
`references/report.md` gives.

## Gotchas

- Review agents launched from a prompt file have every tool, including Edit.
  The "read only" line is the only guard, which is why step 3 checks
  `git status` afterward.
- Hooks resolve once, in step 1. Principle files that probed `../` on their
  own found a sibling in one run and not the next. The packet carries it all.
