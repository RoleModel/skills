# summary.md

Keep it to about half a screen, and leave out empty sections:

````markdown
### Pre-build: <ISSUE-ID> <title>
_<tier> · <live with <names> | async>_

```mermaid
<corrected task diagram>
```

**Approach**
- <step, in order>

**In scope:** <items> · **Out of scope:** <items>

**Done when**
- [ ] <check>

**Risks**
- <risk> (likelihood/impact) — <mitigation, if discussed>

**Open questions**
- <question>
````

- Use plain bullets for every list. The only exception is **Done when**, which
  uses checkboxes because people tick it off. Never use numbered lists.
- Mark anything that came from Granola rather than the board as *(from
  discussion)*.
- Leave out drafts the team never touched (`draft: true`).
- The diagram is plain Mermaid, because Linear renders it in comments.
