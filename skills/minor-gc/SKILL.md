---
name: minor-gc
description: "Quick dead-code sweep: remove code that static checks or a short look can prove dead — leftover TEMP/TODO/FIXME code whose reason has passed, commented-out blocks, unused imports and variables, debug leftovers, focused or skipped tests. Use when the user says \"minor gc\", \"quick cleanup\", \"sweep for dead code\", \"remove leftover TODOs\", \"tidy up before the PR\", or wants a cheap cleanup pass on a repo, folder, or branch. For deep, cross-file dead code (unused classes, routes, files, packages), use major-gc instead."
metadata:
  triggers: "minor gc, quick cleanup, dead code sweep, leftover TODOs, TEMP code, FIXME, commented-out code, unused imports, unused variables, debug leftovers, console.log, binding.pry, focused tests, skipped tests, tidy up before the PR"
---

# Minor GC

A cheap, fast pass. Remove only what a linter or one short look proves dead.
If proving it would take tracing callers across files, it belongs to `major-gc`:
list it in the report and move on.

## Scope

- Default: the whole repo. If the user names a path or says "this branch",
  limit the sweep to that path or to `git diff --name-only <base>...HEAD`.
- Skip generated and vendored code: `vendor/`, `node_modules/`, `dist/`,
  `build/`, `public/assets`, `tmp/`, lockfiles, `db/schema.rb`/`structure.sql`,
  migrations, and anything with a "generated" header.
- If the tree is dirty, leave the user's changes alone. Work on a branch;
  never on `main`/`master`.

## 1. Gather candidates

Run what the project already has before inventing anything. Read the repo's
lint config so you use its rules, not your own.

| Kind | How to find it |
|---|---|
| Marker comments | `rg -n '\b(TEMP|TEMPORARY|TODO|FIXME|HACK|XXX|REMOVE ?ME|DELETE ?ME|REMOVE (AFTER|WHEN|ONCE))\b'` |
| Commented-out code | runs of 3+ comment lines that parse as code (`# foo.bar(`, `// const x =`, `-# = render`) |
| Unused imports, locals, params | JS/TS: `eslint` (`no-unused-vars`), `tsc --noEmit --noUnusedLocals --noUnusedParameters`. Ruby: `rubocop --only Lint/UselessAssignment,Lint/UnusedMethodArgument,Lint/UnusedBlockArgument`. Python: `ruff --select F401,F841`. Go: `go vet`, `staticcheck` |
| Debug leftovers | `console.log`, `debugger`, `binding.pry`, `binding.irb`, `byebug`, `pp `, `puts ` in app code, `print(` in libs |
| Focused or skipped tests | `fit`, `fdescribe`, `it.only`, `describe.only`, `xit`, `xdescribe`, `it.skip`, `skip`, `pending` |
| Code after `return`/`raise`/`throw` in the same block | linter "unreachable" rules (`no-unreachable`, `Lint/UnreachableCode`) |
| Branches on literals | `if (false)`, `if true`, `&& false` |

## 2. Judge each one

Look only at the line, its function, and `git log -L`/`git blame` for it.

- **TEMP / "remove after X" / "until Y ships"**: dead if X has happened.
  Check the cheap way: blame age, whether the named ticket is closed
  (if a tracker tool is connected), whether the flag, migration, or
  version it waits on exists. Remove the marker *and* the code it guards,
  keeping the branch that is now the real path.
- **TODO / FIXME**: a TODO is a note, not dead code. Remove only when the
  thing it asks for is already done, or it refers to code that no longer
  exists. Otherwise keep it and list it in the report as possible card work.
- **Commented-out code**: remove. Git has it. Keep it only if a comment next
  to it says why it must stay (e.g. "uncomment to debug X") — then list it.
- **Unused imports and locals**: remove, unless the import has side effects
  (see Gotchas).
- **Unused params**: prefix with `_` or remove only when the signature is
  private. Leave public API, callbacks, and interface methods alone.
- **Debug leftovers**: remove, except deliberate logging (a logger call, or a
  `console.log` in a CLI or script whose job is to print).
- **Focused tests** (`.only`, `fit`): unfocus. **Skipped tests**: don't
  delete — list them with their reason.

When in doubt, don't delete. List it.

## 3. Remove

- One commit per kind of cleanup ("Remove commented-out code", "Remove
  unused imports"), so each can be reverted alone. Follow the repo's commit
  rules.
- Prefer the tool's autofix (`eslint --fix`, `rubocop -a` for the listed
  cops) over hand edits when it covers the case.

## 4. Verify

- Rerun the linters and type checker from step 1.
- Run the tests for the files you touched, not the full suite. Find them by
  the repo's spec-to-source mapping or by grepping for the file or class
  name under the test folder.
- If anything fails, fix your change or put the code back. Never leave a
  removal that breaks a test.

## 5. Report

Keep it short:

- **Removed** — count by kind, with a few `path:line` examples.
- **Kept, needs a person** — TODOs that are real work, skipped tests,
  TEMP code whose condition you couldn't confirm. One line each with the
  reason.
- **Looks dead, needs a deeper look** — anything that needs cross-file
  tracing. Suggest `major-gc` if the list is long.

If the repo has a task board (e.g. `.rm-vault/`), offer to turn real TODOs
into cards instead of leaving them as comments.

## Gotchas

- Imports with side effects look unused to every linter: CSS imports,
  polyfills, `require 'foo'` that patches classes, files that register web
  components or Stimulus controllers. Removing one breaks the app at runtime,
  not in lint.
- A skipped test often hides a real bug. Deleting it hides the bug for good.
