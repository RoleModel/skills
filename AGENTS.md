# AGENTS.md

This file provides guidance to AI assistants when working with code in this repository.

## Repository Purpose

This is a collection of **AI agent skills** for RoleModel Software. Skills are reusable instruction sets (SKILL.md files) that guide AI agents in applying specific methodologies and design systems. There is no build system, test suite, or application code — this repo contains only skill definitions and their supporting assets.

## Structure

```
.claude-plugin/plugin.json
agents/
  {skill-name}/
    {agent-name}.md       # Subagent definition with YAML frontmatter + markdown
skills/
  {skill-name}/
    SKILL.md              # Skill definition with frontmatter (name, description, triggers)
    scripts/              # Optional deterministic helpers the agent runs
    templates/            # Optional files the skill copies or fills in
    references/           # Optional reference docs loaded into context as needed
```

Each skill has YAML frontmatter defining `name`, `description`, and `metadata.triggers` (keywords that activate the skill).

Skills may also include a `references/` directory for supporting markdown files that are loaded selectively during skill execution (rather than always being in context).

Each agent has YAML frontmatter defining `name`, `description`, `tools`, `model`, `effort`, and `maxTurns`.

## Skills

The table in `README.md` lists every skill. Each skill's `SKILL.md` is its source of truth; don't summarize skills here.

## Key Conventions

- When editing skills, preserve the YAML frontmatter format at the top of SKILL.md files.
- New and changed skills must meet "What makes a good skill" in README.md: only what the model doesn't already know, one job, a model-facing description, a Gotchas section, under ~200 lines, pointers to the source of truth instead of copies, and no client data.
- Examples use generic models (`Widget`, `Order`, `Article`), `example.com`, and placeholder handles (`jdoe`). Never client names, codenames, internal hostnames, real people's usernames, or code lifted from a client app.
- BEM, Optics, and UX Review are designed to work together — BEM provides CSS structure, Optics provides design tokens and components, and UX Review finds usability problems whose fixes use both.
- The `agentation` skill is a fork of the upstream skill in [benjitaylor/agentation](https://github.com/benjitaylor/agentation), pinned in a note at the top of SKILL.md. The toolbar internals it depends on are private, so re-read upstream when bumping the `agentation` package. Keep the upstream commit in that note current.
- Optics tokens use the `--op-` CSS custom property prefix. Project-specific tokens should use a project namespace prefix (e.g., `--ya-` for "Your App").
- Optics component overrides go in `app/assets/stylesheets/components/optics-overrides/{component.css}` (in consuming projects).
- Skill descriptions should be written to trigger aggressively — Claude tends to undertrigger skills, so descriptions should be explicit and include example phrases.
- When creating a new skill with reference files, keep SKILL.md under ~200 lines and put large reference content in `references/` with clear pointers from SKILL.md on when to read each file.
- `feature-review`'s Node scripts must keep the `.cjs` extension.
