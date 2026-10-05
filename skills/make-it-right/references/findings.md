# Findings

Every lens reports in this format. Report everything you find, including
things you're unsure of. A separate verifier scores and filters them, so
holding back a finding loses it for good.

## Format

One finding per line:

```
- <path>:<line> | <severity> | <lens> | <what is wrong and what it causes>. <the fix>. | <evidence>
```

- **path:line**: where the fix goes. Use the first line of a range.
- **what**: the concrete failure. "`total` is nil for an order with no line
  items, so checkout raises NoMethodError" is a finding. "Consider handling
  edge cases" is not.
- **fix**: specific enough to apply without re-deriving it.
- **evidence**: the written rule it breaks (`docs/conventions/forms.md`,
  `bem-structure: no &__`) or the code that proves it (`called from
  app/jobs/sync_job.rb:12 with nil`). A finding with neither is taste, so
  drop it.

End with `<lens>: <n> findings` or `<lens>: nothing to report`.

## Severity

| Level | Means |
|---|---|
| **critical** | Security hole, data loss or corruption, or production down. |
| **high** | Wrong behavior a user or caller will hit, an untested critical path, or a broken written rule that costs real maintenance. |
| **medium** | Wrong in a rare case, a design problem that will cost the next change, or a convention violation. |
| **low** | Polish: naming, small simplifications, minor style the linters miss. |

## Out of scope for every lens

- Anything the project's linters or formatters already enforce.
- Lines carrying a lint-ignore or a comment explaining the choice. Report
  them only if the explanation is wrong.
- Rewrites of existing code that the change doesn't call or depend on. Report
  real bugs there, but don't propose restyling it.
