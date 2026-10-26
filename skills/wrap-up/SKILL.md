---
name: wrap-up
description: End-of-session skill that captures learnings into the right doc layer and updates project instructions.
allowed-tools: Read, Write, Edit, Glob
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: rolemodel
  version: "3.1"
  triggers: "WRAP UP, wrap this up, finish this session, wrap, end session, close out, save progress, done for the day, that's it for today, that's it for this session"
---

# Wrap Up Session

## Step 1: Decide whether anything is worth writing down

Review the conversation for learnings that will still matter next month. **The default is to write nothing.** Documentation that restates the code is worse than no documentation: nobody reads it, and it goes stale the moment the code changes.

Skip it if any of these is true:

- It's discoverable by reading the code, the schema, git history, or config
- A manifest or lockfile already pins it — versions above all
- A linter, type, or test already enforces it
- It's a narrative of what happened this session — what broke, what you tried, which ticket it was
- It's a file or method inventory
- It only mattered to this task

What survives that bar is usually one of two things: **a rule this project has settled on**, or **a fact about the outside world** the code can't reveal on sight — how a library actually behaves, an API that contradicts its own docs, a database rule with a surprising edge.

## Step 2: Route it

| What you learned                                    | Where it goes                                           |
| --------------------------------------------------- | ------------------------------------------------------- |
| A rule or taste call about how we build things here | `docs/conventions/` + an entry in `docs/CONVENTIONS.md` |
| How a domain subsystem hangs together               | `docs/subsystems/` + an entry in `docs/INDEX.md`        |
| How to perform an operational task                  | `docs/guides/` + an entry in `docs/INDEX.md`            |
| Stack, directory, or data model changes             | `docs/ARCHITECTURE.md`                                  |
| Project-wide workflow or debugging rules            | `AGENTS.md`                                             |

**Update an existing file rather than adding one.** A new file is justified only when no existing file covers the topic. If nothing in the table fits, ask the user — don't invent a folder.

Read the "What belongs in a convention file" section of `docs/CONVENTIONS.md` before writing a convention, and keep new `docs/CONVENTIONS.md` entries to one clause with an accurate `<!-- paths: -->` glob so the hook surfaces them.

If `.github/instructions/conventions.instructions.md` exists and the session changed what it asserts, update it. It points at `docs/CONVENTIONS.md`; never copy a convention into it.

Subsystem and guide docs follow the same restraint: state the shape of the thing and the decisions behind it, not a method-by-method tour. A mermaid diagram of how the pieces relate is worth more than prose describing the same relationships. Never add convention detail to `AGENTS.md` — it points at `docs/CONVENTIONS.md` — and keep it under 50 lines.

## Step 3: Prune while you're there

If the session showed an existing doc to be wrong, stale, or bloated, fix or delete it. Removing a paragraph that no longer holds counts as a successful wrap-up on its own.

## Step 4: Report

Summarize what was updated:

- Which files were created or edited and why
- What was routed where (convention vs guide vs subsystem vs AGENTS.md)
- What was intentionally skipped and why
