# Standards lens

Find where the change breaks a **written** rule. Every finding cites the rule:
the file, and the heading or line. If you can't point at where it's written,
it isn't this lens's finding.

## Rule sources, in precedence order

1. The project's `AGENTS.md` / `CLAUDE.md` and `docs/conventions/`.
2. The RoleModel skills installed next to this one (`<SKILL_DIR>/../<skill>/SKILL.md`)
   that match the files changed. Read only these, and skip any that aren't
   installed:

| Files changed | Skills |
|---|---|
| `*.css`, `*.scss` | `bem-structure`, `optics-context` |
| `*.slim`, `*.erb`, components | `frontend-patterns`, `optics-context` |
| `app/javascript/controllers/**` | `stimulus-controllers` |
| `app/controllers/**` | `controller-patterns` |
| `config/routes.rb`, `config/routes/**` | `routing-patterns` |
| controllers serving a child of many parent types | `polymorphic-parent-resources` |
| forms with dependent or conditional fields | `dynamic-forms` |
| nested-attribute forms | `dynamic-nested-attributes` |
| JSON-backed model attributes | `json-typed-attributes` |
| `spec/**` | `tdd` |

When the project's docs and a RoleModel skill disagree, the project wins.

## Comments

Code says what and how. A comment earns its place only by saying what the code
can't: why a non-obvious choice was made, a constraint from outside the code,
or a link to the issue behind a workaround. Report as `low`:

- Comments that restate the code.
- Comments that narrate the change ("now uses X", "added for Y", "fixed").
  Agent-written code is full of these.
- Commented-out code.
- Section-divider and banner comments in short files.

Report a comment that is **wrong** about the code as `medium`.

## Not this lens

Rules the linters enforce, and taste that isn't written down. If a missing rule
keeps coming up, say so in one line at the end. It's a candidate for
`docs/conventions/`.
