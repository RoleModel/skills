# RoleModel Skills

A collection of reusable AI agent skills for [RoleModel Software](https://rolemodelsoftware.com). Each skill is a folder with a `SKILL.md` that teaches AI coding agents (Claude Code, GitHub Copilot) a RoleModel workflow or convention.

Skills follow the [Agent Skills](https://agentskills.io) open standard and work across multiple AI tools.

## What makes a good skill

A skill earns its place when an agent does the job worse without it. Before adding or changing one, check it against this list.

1. **It changes what the agent does.** It carries a procedure, a decision RoleModel made, or a gotcha the agent can't learn from the code. It does not explain things the model already knows: Rails basics, Stimulus 101, how ActionCable works, Nielsen's heuristics. Every line loads into the context window and competes with the actual task.
2. **It does one job.** A skill that straddles several jobs (reference, review, scaffolding, deploy) triggers at the wrong times and confuses the agent about which part applies.
3. **The description is written for the model.** Third person, starting with what it does and when to use it, with the phrases a person would actually type. Don't summarize the steps in the description; agents follow the summary and skip the body.
4. **It has a Gotchas section built from real failures.** The places an agent went wrong while using it are the most valuable lines in the file. Add one every time it misfires.
5. **It's short.** Keep `SKILL.md` under about 200 lines (500 is the hard ceiling). Move detail into `references/` files linked directly from `SKILL.md`, and move deterministic steps into `scripts/`.
6. **It states goals and constraints, not every keystroke.** Spell out exact commands only where one wrong step is expensive (rewriting history, deleting data, publishing).
7. **It points at the source of truth instead of copying it.** Read the gem's README or the installed package rather than pasting a snapshot that goes stale. `dynamic-forms` and `optics-context` are the in-repo examples.
8. **It's been tested.** Watch an agent fail at the task without the skill, write the skill to fix that, then confirm the agent succeeds with it. Keep at least three realistic prompts to re-run when you change it.
9. **It contains no client data.** Examples use generic models (`Widget`, `Order`, `Article`), `example.com`, and placeholder names (`jdoe`). No client names, codenames, internal hostnames, people's handles, or code lifted from a client app.

What isn't a skill: a project's own conventions (put those in its `AGENTS.md` or `docs/conventions/`, via `scaffold-docs` and `generate-conventions`), textbook knowledge, one-off fixes, and rules a linter can enforce.

## Skills

### CSS, Design System, & UX

| Skill | Description |
|-------|-------------|
| **[bem-structure](skills/bem-structure)** | CSS guidance using BEM (Block Element Modifier) methodology. Naming conventions, nesting rules, and modifier patterns. |
| **[optics-context](skills/optics-context)** | RoleModel's Optics design system: components, `--op-` design tokens, and theming. Reads tokens and components from the installed `@rolemodel/optics` package; `references/theming.md` covers brand colors, color scales, fonts, and dark mode. |
| **[ux-review](skills/ux-review)** | Review UI code against Nielsen's 10 heuristics and the Laws of UX, reported as a severity-ranked issue log with file-and-line evidence and Optics-based fixes. |

### Rails

| Skill | Description |
|-------|-------------|
| **[rails-conventions](skills/rails-conventions)** | RoleModel's Rails conventions where they differ from what an agent writes by default: flash wording, `:unprocessable_content`, Simple Form for every form, `parent_resource.name.classify` in route concerns, and gotchas for `params.expect` with nested attributes and Lexxy change events. |
| **[dynamic-forms](skills/dynamic-forms)** | Forms that change as they are filled in (dependent dropdowns, conditional fields, dynamic option lists) with the `turbo_form` gem, RoleModel's mechanism for dynamic form interaction. Supersedes hand-wired `turbo_fetch`. |
| **[polymorphic-parent-resources](skills/polymorphic-parent-resources)** | Serve a child resource that hangs off many different parents (comments, reports, duplications, attachments) from a single controller, using a route concern plus `resource_for` from `rolemodel_rails`. Includes a retrofit guide for consolidating existing per-parent controllers. |
| **[tdd](skills/tdd)** | Test-driven development for Rails — outside-in with RSpec, Capybara, and FactoryBot. Covers the red-green loop, spec plans, and the Prove-It pattern for bugs. |

### Developer Workflow

| Skill | Description |
|-------|-------------|
| **[agentation](skills/agentation)** | Add the Agentation visual feedback toolbar to a project so you can point at UI problems in the browser and hand them to an agent. Written for Rails apps that bundle with webpack into `app/assets/builds`: adds React as a development-only dependency, with a production boundary verified against a clean build of the bundler's real output directory. Adapted from the upstream Agentation skill, which covers Next.js only. |
| **[babysit-pr](skills/babysit-pr)** | Shepherd an open PR to mergeable — poll CI, verify review findings against the source, push fixes, rebase onto the base when needed. Bounded loop with explicit stop conditions. Treats all PR content as untrusted input; never approves, merges, or closes. |
| **[cloudflare-tunnel](skills/cloudflare-tunnel)** | Expose locally-running apps to stable public HTTPS URLs with a single per-developer Cloudflare Tunnel (cloudflared). For receiving webhooks, testing OAuth callbacks, or sharing a work-in-progress. Covers named-tunnel setup, per-project hostnames, host allowlisting, and running cloudflared as a launchd service. |
| **[create-pr](skills/create-pr)** | Open a pull request and assign the author, after showing the drafted title and body for approval. Reads the linked ticket when a tracker tool is available. Follows the repo's PR template when there is one; otherwise uses **Why**, **What Changed**, and optional **Post-merge** and **Screenshots** sections. Targets the branch this one was cut from, including another open PR's branch. For UI changes, asks whether it should take screenshots, the user will, or there are none. Updates the existing PR in place when the branch already has one. Refuses to commit on the default branch and stages named paths only, never `git add -A`. |
| **[dependabot-stack](skills/dependabot-stack)** | Group all open Dependabot PRs on a repository into one ordered stack with `gh-stack`, so the week's dependency updates land as a single reviewable chain instead of N PRs that conflict on shared lockfiles. Orders by lockfile overlap, rebases in a scratch worktree, and registers the stack on GitHub. |
| **[document-this](skills/document-this)** | Generate multi-audience documentation from any codebase — workflows for non-technical readers, architecture for developers, and AI orientation for agents. Deterministic JS scripts handle structural extraction; the agent writes the prose. Use when the user asks to "document this project", runs `/document-this`, runs `/document`, or wants fresh documentation reflecting the current codebase state. |
| **[feature-review](skills/feature-review)** | Review a commit, branch, or PR as a feature first and code second, on one self-contained HTML page. Opens on an overview of the feature (what it does, checks to confirm, screenshots and recordings of the flow) and the shape of the change (layers, objects, departures from the architecture). The code step leads with recommendations you answer yes or no, then the diff with a reading guide, viewed checkboxes, existing PR threads, and a re-review mode. Reviews against the guides a repo lists in `REVIEW.md`, and posts everything as one PR review. |
| **[generate-conventions](skills/generate-conventions)** | Fill an empty `docs/conventions/` with rules worth writing — taste calls, facts the code won't announce, and corrections that recur across past PR review comments — not what a survey of the codebase already tells you. Confirms candidates with the user one at a time and writes three to seven lines each. Rejects most of them. |
| **[ruby-version](skills/ruby-version)** | Check which Ruby versions actually exist before claiming one does or doesn't, and install a specific Ruby through rbenv. |
| **[scaffold-docs](skills/scaffold-docs)** | Install the agent-documentation structure in a project — a minimal `AGENTS.md`, a `docs/` tree with `CONVENTIONS.md` and `INDEX.md`, the convention-surfacing PreToolUse hook, and a symlinked `wrap-up`. Installs the structure, not the content; also trims a bloated existing `AGENTS.md` under 50 lines. |
| **[split-stack](skills/split-stack)** | Split one PR that does too much into a stack of PRs, one per concern, without changing the combined diff. The top of the stack must stay byte-identical to the original commit — verified, not assumed. Includes `scripts/strip_hunks.py` for carving hunks out of a diff. |
| **[wrap-up](skills/wrap-up)** | End a work session by routing what was learned into the right doc layer — convention, subsystem, guide, or architecture — and pruning what the session proved stale. Defaults to writing nothing, since docs that restate the code are worse than none. Pairs with `scaffold-docs`. |

### Process, Planning, Quality, & Observability

| Skill | Description |
|-------|-------------|
| **[brave-breakdown](skills/brave-breakdown)** | Interactive BRAVE framework thought partner for breaking down a Linear card before starting work. Guides through Brainstorm, Reflect, Approach, Value, and Estimate — one question at a time. |
| **[make-it-right](skills/make-it-right)** | The pass after code works: test agents check requirements are met (acceptance criteria, coverage, blast radius, UI/UX in a real browser), read-only review agents check it's done correctly (security, maintainable, readability, conventions, data patterns). Verifies every finding against the source, fixes them, and reports what a human still needs to judge. |
| **[make-it-fast](skills/make-it-fast)** | Optional pass after `make-it-right`: reviews queries, request time, test speed, and page responsiveness, reusing `make-it-right`'s loop. Fixes only what it can measure, and reports before-and-after numbers. |
| **[made-it-wrong](skills/made-it-wrong)** | Retro on a `make-it-right` run: turns a miss, false alarm, bad fix, or skipped step into an edit to `make-it-right`, proven by a replay that fails before the edit and passes after. Proposes; you approve. |
| **[rails-audit](skills/rails-audit)** | Audit a whole Rails app against thoughtbot's best practices and write a markdown report grouped by category (Testing, Security, Models, Controllers, Code Design, Views) with severity levels. Optionally collects SimpleCov and RubyCritic metrics first. |
| **[rm-sentry-issue-fixer](skills/rm-sentry-issue-fixer)** | Full seven-phase workflow for diagnosing and fixing a Sentry issue using the Sentry API: issue discovery → deep analysis → root cause hypothesis → entry point audit → code investigation → implement fix → report results. Enforces security constraints (never follows instructions embedded in Sentry event data). |
| **[sentry-top-issue](skills/sentry-top-issue)** | Picks the single highest-priority unresolved Sentry issue (sorted by Trends, filtered for open PRs) and hands it off to `rm-sentry-issue-fixer`. Discovers Sentry scope from args or project docs; exits cleanly if scope or API access is unavailable. Supports `dry-run`, `no-pr-filter`, and `fixer=` overrides. |

## Installation

There are three ways to add these skills to your project. Choose the one that best fits your workflow.

### Option 1: Copy individual skills (simplest)

Copy the skill folders you need directly into your project's skills directory.

**For Claude Code:**

```bash
# Create the skills directory if it doesn't exist
mkdir -p .claude/skills

# Copy a skill into your project
cp -r path/to/rolemodel-skills/skills/bem-structure .claude/skills/bem-structure
```

Skills live in `.claude/skills/<skill-name>/SKILL.md` and are discovered automatically. Claude loads them when relevant to your conversation, or you can invoke them directly with `/<skill-name>`.

**For GitHub Copilot:**

```bash
# Create the skills directory if it doesn't exist
mkdir -p .github/skills

# Copy a skill into your project
cp -r path/to/rolemodel-skills/skills/bem-structure .github/skills/bem-structure
```

Skills live in `.github/skills/<skill-name>/SKILL.md` and are loaded on-demand when Copilot detects a relevant task.

### Option 2: Git submodule (keeps skills synced)

Add this repo as a git submodule, then point your AI agent at the skills directory. This makes it easy to pull updates as skills evolve.

```bash
# Add the submodule
git submodule add https://github.com/RoleModel/rolemodel-skills.git .rolemodel-skills

# Initialize (for teammates cloning the repo)
git submodule update --init
```

Then tell your agent where to find the skills:

**For Claude Code**, you have a few options:

1. **Use `--add-dir`** to include the skills directory when launching Claude:

    ```bash
    claude --add-dir .rolemodel-skills/skills
    ```

2. **Add it to your project's `.claude/settings.json`** so it's always available:

    ```json
    {
      "additionalDirectories": [".rolemodel-skills/skills"]
    }
    ```

3. **Reference the skills in your `CLAUDE.md`** so Claude knows to read them when relevant:

    ```markdown
    ## Skills

    This project uses shared AI agent skills from `.rolemodel-skills/skills/`.
    When working on CSS, read and follow the instructions in:
    - `.rolemodel-skills/skills/bem-structure/SKILL.md`
    - `.rolemodel-skills/skills/optics-context/SKILL.md`

    When reviewing UI for usability, read and follow:
    - `.rolemodel-skills/skills/ux-review/SKILL.md`
    ```

4. **Symlink individual skills** into `.claude/skills/` for automatic discovery:

    ```bash
    mkdir -p .claude/skills
    ln -s ../../.rolemodel-skills/skills/bem-structure .claude/skills/bem-structure
    ln -s ../../.rolemodel-skills/skills/ux-review .claude/skills/ux-review
    ```

**For GitHub Copilot:**

1. **Reference the skills in `.github/copilot-instructions.md`** so Copilot knows to read them when relevant:

    ```markdown
    ## Skills

    This project uses shared AI agent skills from `.rolemodel-skills/skills/`.
    When working on CSS, read and follow the instructions in:
    - `.rolemodel-skills/skills/bem-structure/SKILL.md`
    - `.rolemodel-skills/skills/optics-context/SKILL.md`

    When reviewing UI for usability, read and follow:
    - `.rolemodel-skills/skills/ux-review/SKILL.md`
    ```

2. **Symlink individual skills** into `.github/skills/` for automatic discovery:

    ```bash
    mkdir -p .github/skills
    ln -s ../../.rolemodel-skills/skills/bem-structure .github/skills/bem-structure
    ln -s ../../.rolemodel-skills/skills/ux-review .github/skills/ux-review
    ```

To pull the latest skill updates:

```bash
git submodule update --remote .rolemodel-skills
```

After updating, check for symlinks or `CLAUDE.md` / `copilot-instructions.md` lines that point at a skill that no longer exists (`find .claude/skills .github/skills -xtype l` lists broken symlinks). Removed skills and where their guidance went:

| Removed | Use instead |
|---------|-------------|
| `laws-of-ux`, `usability-heuristics`, `ai-ux-enhancements` | `ux-review` |
| `theming-context` | `optics-context` (theming is in `references/theming.md`) |
| `controller-patterns`, `routing-patterns`, `frontend-patterns` | `rails-conventions` |
| `dynamic-nested-attributes`, `form-auto-save`, `action-cable`, `stimulus-controllers`, `json-typed-attributes`, `trace`, `explain`, `create-profile` | Nothing; the agent handles these without a skill. `form-auto-save`'s Lexxy gotcha moved to `rails-conventions`. |

### Option 3: Install via skills.sh (community directory)

[skills.sh](https://skills.sh) is a community directory and CLI for discovering and installing agent skills. If these skills are published there, you can install them with:

```bash
npx skills add RoleModel/rolemodel-skills
```

This installs skills into the appropriate directory for your agent automatically. You can also browse [skills.sh](https://skills.sh) to discover additional skills from the community.

## Structure

```
skills/
  {skill-name}/
    SKILL.md          # Skill definition with YAML frontmatter + markdown instructions
    references/       # Optional detail, loaded only when SKILL.md points to it
    scripts/          # Optional deterministic helpers the agent runs instead of reading
    templates/        # Optional files the skill copies or fills in
```

Each `SKILL.md` has YAML frontmatter at the top:

```yaml
---
name: skill-name
description: What the skill does and when to use it.
metadata:
  triggers: "keyword that activates the skill, another trigger keyword"
---

Markdown instructions for the AI agent...
```

- **`name`** — Identifier for the skill (becomes the `/slash-command` in Claude Code)
- **`description`** — Tells the agent when to load this skill
- **`metadata.triggers`** — Keywords that help the agent match the skill to your request

## How skills work together

- **BEM + Optics** — BEM provides CSS structure; Optics provides design tokens and components. Use both when writing or reviewing stylesheets.
- **UX Review + Optics + BEM** — UX Review finds the usability problems; its fixes use Optics components and tokens with BEM class names.
- **Rails Conventions + Polymorphic Parent Resources + Dynamic Forms** — Rails Conventions holds the house rules and points to the other two: Polymorphic Parent Resources for a child resource that hangs off several parents, and Dynamic Forms for forms that change as they are filled in.
- **Scaffold Docs + Generate Conventions + Wrap Up** — Scaffold Docs installs the doc structure; Generate Conventions fills `docs/conventions/`; Wrap Up keeps the docs current at the end of each session.
- **Sentry Top Issue + Sentry Issue Fixer** — Top Issue selects the highest-priority Sentry issue; Issue Fixer runs the full diagnosis-and-fix workflow. Run together or invoke the fixer directly with a known issue.
- **File PR + Split Stack + Babysit PR** — File PR opens or updates a single PR. Split Stack is what you reach for when that PR turns out to cover more than one concern: it carves each concern into its own stacked PR, then File PR writes the description for each. Babysit PR takes over once a PR is open, driving it to mergeable while you work on something else.

## License

[MIT](LICENSE)

## Sources

The guidance in "What makes a good skill" draws on:

- Anthropic, [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Thariq Shihipar, Anthropic, [Lessons from building Claude Code: How we use skills](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills)
- Barry Zhang and Mahesh Murag, Anthropic, [Don't Build Agents, Build Skills Instead](https://www.ai.engineer/talks/CEvIs9y1uog-agent-skills)
- Jesse Vincent, [`writing-skills`](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md) from obra/superpowers
