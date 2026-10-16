# Verifier

You receive every finding the agents reported. Your job is to decide which
ones are real. You didn't write the code or the findings, so trust neither.
Read `findings.md` next to this file for the format and severities.

## For each finding

1. **Merge duplicates.** Several agents often report the same line. Keep the
   clearest version under the most fitting principle, and note the others.
   Two agents filing one problem under two principles is one finding.
2. **Check it against the source.** Open the file at the line. Follow the
   evidence: read the caller, the rule, or the spec it names. For a `delete:`
   of code, rerun the name search yourself: dynamic frameworks reference code
   by string, and the stack map's "Where names hide" lists where. Before
   confirming that a value ignores or includes something, read where it's
   defined, including any override: a key, a query scope, a forwarded method,
   or a hook often does more than its call site shows.
3. **Score it 0–100.**

| Score | Means |
|---|---|
| 0 | Wrong: the code doesn't do what the finding says, or the rule doesn't say it. |
| 25 | Might be real, but you couldn't confirm the trigger or the rule. |
| 50 | Real but trivial, or real only under conditions that can't occur here. |
| 75 | Real and it matters, with one link in the chain you couldn't confirm. |
| 100 | Confirmed: you traced the trigger or found the written rule. |

   A bug whose finding names a concrete trigger, such as a double click
   against a unique index, is confirmed once you trace the trigger through
   the code. How often it happens doesn't lower the score.

   A finding that part of the intent isn't met keeps its score however big
   the fix is; the run fixes toward the intent.

   A `reuse:` finding is not taste when the existing code does the same job:
   two mechanisms for one job is a cost. Score it on whether the jobs match,
   not on how much code the change copied.

   A conventions finding whose rule isn't written where it claims scores 0.
   So does one whose rule names a tool the project doesn't have, such as a
   package or a config file: the rule was written for another codebase.

4. **Check that the fix runs.** Read the code the fix calls. A fix that
   reads an attribute or calls a method the object doesn't support fails on
   contact, so score the problem and rewrite the fix, or drop it.
5. **Check the fix's direction.** A real problem can come with a fix that
   moves code to the wrong owner, such as display logic from the presentation
   layer into the domain. Score the problem, and rewrite the fix to the right
   owner.
6. **Re-check "found fine" notes.** Agents' notes that code is in the right
   place or follows a rule are claims too. Check each one, and turn a wrong
   one into a finding.
7. **Mark it `new` or `existing` by cause.** It's `new` if its line falls
   inside a range in `new_lines.txt`, or if the defect exists only because of
   the change, wherever it surfaces (a missing spec for new behavior is
   `new`). Otherwise it's `existing`.
8. **Check the severity** against `findings.md` and correct it if needed.
9. **Flag conflicts.** Where one finding's fix would undo another's, such as
   one adding a class that another deletes, mark both and say which should win
   under `SKILL.md` step 5 "Conflicts": deleting wins, except over behavior
   the intent asks for and `<SKILL_DIR>/review/maintainable.md` "Never cut".

## A `redesign:` finding

Don't score it, and don't send it to open questions because it needs a human
call: the run's gate makes that call. Instead, check two things:

- **Moot:** list the other findings it would remove, by line, including ones
  you dropped. For each, trace how the new shape behaves on that trigger, not
  the old one: a failure the new shape can't reach counts as removed.
- **Fits:** check that the shape works here, such as that the index, the
  delivery path, and the callers all still hold.

It **passes** when at least two findings are moot and it fits. Return it under
**Redesign** with the moot list, what it can't remove, and its cost (migration,
pruning or backfill, specs to rewrite). Otherwise drop it with the reason.

## Output

Return the findings that score **75 or above**, one per line, in the
`findings.md` format, with `| <score> | new|existing` added at the end.

A finding that only the requester can settle, such as whether a field should be
editable, is neither confirmed nor wrong. Don't score it; list it under
**Open questions** with the evidence. So is a fix that takes away something
existing users can do today, such as narrowing who can run an action, when the
intent doesn't ask for that: keep the finding, and put the narrowing under
open questions.

Pass `fast:` findings through unscored under **Hand off**.

Then give the dropped ones in a single line each, with the reason.
