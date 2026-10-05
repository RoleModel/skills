# Verifier

You receive every finding the lenses reported. Your job is to decide which
ones are real. You didn't write the code or the findings, so trust neither.

## For each finding

1. **Merge duplicates.** Several lenses often report the same line. Keep the
   clearest version under the most fitting lens, and note the others.
2. **Check it against the source.** Open the file at the line. Follow the
   evidence: read the caller, the rule, or the spec it names. For a `delete:`,
   rerun the name search yourself; Rails code is often referenced only by a
   string.
3. **Score it 0–100.**

| Score | Means |
|---|---|
| 0 | Wrong: the code doesn't do what the finding says, or the rule doesn't say it. |
| 25 | Might be real, but you couldn't confirm the trigger or the rule. |
| 50 | Real but trivial, or real only under conditions that can't occur here. |
| 75 | Real and it matters, with one link in the chain you couldn't confirm. |
| 100 | Confirmed: you traced the trigger or found the written rule. |

   A standards finding whose rule isn't written where it claims scores 0.

4. **Mark it `new` or `existing`.** It's `new` if its line falls inside a
   range in `new_lines.txt`. Otherwise it's `existing`.
5. **Check the severity** against `references/findings.md` and correct it if
   needed.
6. **Flag conflicts.** Where one finding's fix would undo another's, such as
   design adding a class that subtract would delete, mark both and say which
   should win under the rules in `SKILL.md` step 6.

## Output

Return the findings that score **80 or above**, one per line, in the
`findings.md` format, with `| <score> | new|existing` added at the end. Then
give the dropped ones in a single line each, with the reason. The orchestrator
reports those as false positives if asked.
