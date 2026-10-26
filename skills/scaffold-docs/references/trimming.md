# Trimming an existing AGENTS.md

Target: under 50 lines. Every line loads into every session, including the tasks
it has nothing to do with. Length is the cost; specificity is the value.

Go line by line. Each one is routed, cut, or kept.

## Route it out

Worth keeping, not worth loading every time:

| Content | Destination |
|---|---|
| A rule or taste call about how we build here | `docs/conventions/` + an index entry with a `paths` glob |
| How a subsystem hangs together | `docs/subsystems/` + an `INDEX.md` entry |
| A procedure someone performs | `docs/guides/` + an `INDEX.md` entry |
| Stack, directory layout, data model | `docs/ARCHITECTURE.md` |

An accurate `paths` glob buys back the just-in-time surfacing a rule loses by
leaving `AGENTS.md`.

## Cut

- What the code, schema, linter, types, or config already enforces.
- Version numbers, dependency lists, and anything else a manifest or lockfile
  pins. Name the manifest; don't copy what it says.
- File and method inventories, directory listings, model counts.
- Advice true of any codebase: "write clean code," "handle errors," "consider
  edge cases."
- Restated framework defaults.
- Tone and persona rules — those belong in user settings.
- History: migrations run, bugs fixed, decisions reversed.
- Commands that no longer exist. Check each against `package.json`, `Rakefile`,
  `Makefile`, or `bin/`.
- The same rule stated twice in two sections.

## Keep

- What the project is, plus the one domain fact that shapes every task in it.
- The before-editing rules.
- Pointers to `docs/CONVENTIONS.md`, `docs/INDEX.md`, `docs/ARCHITECTURE.md`.
- Verification commands, exactly as they're run.
- Repo-wide gotchas with no better home.

## Then

Re-read it cold. Anything that reads as advice rather than as a fact about *this*
repo is still a candidate. Still over 50 lines? What's left is almost always a
section that wants to be a convention file.

Confirm every path it references exists.
