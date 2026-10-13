# Conventions

Find where the change breaks a **written** rule. Every finding cites the rule:
the file, and the heading or line. If you can't point at where it's written,
it isn't this principle's finding.

## Rule sources, in precedence order

1. The project's `AGENTS.md` / `CLAUDE.md` and `docs/conventions/`.
2. Skills the project has installed (in `.claude/skills/`, or next to this
   one) whose description matches the files changed: a CSS methodology skill
   for stylesheets, the project's design-system skill for views and CSS, a
   Rails conventions skill for controllers, routes, and forms. Read only
   those that match, and only the sections that apply.
3. `<SKILL_DIR>/references/rails-standards.md`: RoleModel's defaults for
   anything the first two don't cover.

When the project and a skill or default disagree, the project wins.

## The design system

If the project has one (its docs or an installed skill say which), check that
the change uses its tokens and components for spacing, color, type, and
layout instead of hard-coded values or custom CSS that duplicates a component.
Read the system from the project's installed package or docs, not from
memory. A project with no design system has no findings here.

## Not this principle

Rules the linters enforce, and taste that isn't written down. User-facing
copy, button severity (danger vs. warning), and the product's own terms are
taste unless a doc covers them, and they are most of what human reviewers
add. If no doc covers them, say so in one line at the end and suggest
`generate-conventions`. The same goes for any missing rule that keeps coming
up.
