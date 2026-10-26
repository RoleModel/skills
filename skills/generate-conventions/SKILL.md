---
name: generate-conventions
description: >
  Interactively fill a project's docs/conventions/ by proposing candidate rules from taste
  calls, from the codebase, and from past PR review comments, then writing what's confirmed.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
metadata:
  author: rolemodel
  version: "1.1"
  triggers: "generate conventions, write conventions, document our conventions, mine review history, what do reviewers keep flagging, audit past PR feedback, update conventions from code reviews"
---

# Generate Conventions

## 1. Read the bar

`docs/CONVENTIONS.md` must exist. If it doesn't, run `scaffold-docs` first. Its "What
belongs in a convention file" section governs everything below. Read the existing
`docs/conventions/` files too: a rule that fits one of them is an edit.

## 2. Gather candidates

Each candidate needs evidence in the code, and you don't get to invent the project's
position. Skip anything a survey already answers: the stack, the layout, the actions a
controller happens to have. That's architecture.

**Taste**

- What a template may not do: grouping, sorting, transforming.
- Helper or partial, and which shape gets which.
- Whether a non-CRUD operation earns a custom action or its own controller.
- What a callback may do, versus what the caller must do explicitly.
- Whether names describe purpose or appearance.
- Which layers get tests, and which deliberately don't.
- What an assertion may reach for, and what not to assert at all.
- Duplication in tests: descriptive repetition, or extracted setup.
- Whether a behavior change updates the old test or adds one beside it.
- When a comment earns its place.

**Facts the code won't announce**

- The project's own wrapper, used instead of the library it hides.
- Behavior that's global rather than opt-in, so every test has to expect it.
- A framework helper that doesn't work on this stack, and its replacement.
- A change that looks free and isn't: user-facing copy, an enum value, a shared factory trait.
- The one class every value of a kind must pass through.
- The model that exists versus the one newcomers assume exists.

**Mined from review history**

Run `scripts/mine_review_comments.sh` (last 100 merged PRs by default) for every human
reviewer comment, bots and author replies already stripped. Cluster thread openers
(`"reply": false`) by the thing flagged, not by wording. A reply counts only as a second
reviewer echoing the opener.

The bar is more than one PR **and** more than one reviewer, so count both. Most repos
have a dominant reviewer who clears the PR half constantly, and one person repeating
themselves is a preference however many PRs it spans. Rank a cluster higher when it
names an identifier only this repo has, like a `soft_destroy` or a project wrapper,
since nobody joining can guess those. General themes are usually a framework default.

Then ask the user what they keep correcting in review. That's the highest signal and you
can't grep it. Taste lives in one person's head while counterexamples sit in the repo, so
weigh what they say over what most files do.

## 3. Kill most of them

Drop a candidate when a linter or test already fails on the violation, one file shows it,
a manifest pins it, it restates a framework default, it's true of any codebase, or it
happened once and nobody defends it. What survives is **how this project does something**
or **taste**, and would cost someone a wrong guess.

## 4. Confirm one at a time

Show the survivors as a shortlist, one line each, naming the evidence. Ask which they
want (`AskUserQuestion`, multi-select) and what you missed. Then per rule: state it back,
get a yes, write the file, show it, next. Never batch-write a directory.

## 5. Write it small

A title, the rule, and at most one more paragraph for the trap that makes the rule
non-obvious. Three to seven lines. Ten is long. Fifteen means two rules, or none.

- The rule is the first sentence, imperative, with no preamble.
- Name a reference implementation rather than transcribing it: "follow `person_spec.rb`".
- A code sample only where prose can't state the rule. Once, three lines.
- No headings below the title.

Add one `docs/CONVENTIONS.md` entry: a clause after the separator, plus an accurate
`<!-- paths: -->` glob so the hook surfaces it on edit.

## 6. Verify and report

Check that every path resolves, every glob matches something, and no file runs past a
screen. Leave `.github/instructions/conventions.instructions.md` alone: it points at the
index and must not restate a rule. Then read the new files against the rest of
`docs/conventions/`, because two rules that cancel each other pass every structural check
and then leave an agent silent on the exact change they were written for. Report what you
wrote, what you indexed, and what you rejected and why.
