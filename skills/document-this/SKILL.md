---
name: document-this
description: Generate multi-audience documentation from any codebase — workflows for non-technical readers, architecture for developers, and AI orientation for agents. Deterministic JS scripts handle structural extraction; the agent writes the prose. Project-agnostic and self-orienting. Use when the user asks to "document this project", runs `/document-this`, runs `/document-this <file-path>`, runs `/document-this --focus "<Feature Name>"` for a deep-dive on one subsystem in a named subfolder, or wants fresh documentation reflecting the current codebase state.
---

# /document-this

## Overview

Generates documentation across three audiences from one codebase:

- **Non-technical readers** — what the system does, in plain English, organized as user workflows backed by tests
- **Developers** — where things are, how they're structured, what patterns are in play
- **AI agents** — fastest path to useful context: entry points, test coverage map, known gaps, glossary

Scripts handle everything deterministic (directory structure, entity listing, test categorization). The agent handles everything that requires interpretation (prose, pattern recognition, workflow narratives).

---

## Invocation

```
/document-this                              # Full project documentation
/document-this <file-path>                  # Targeted update of affected sections only
/document-this --focus "<Feature Name>"     # Deep-dive docs for a feature/subsystem into a named subfolder
/document-this --focus "<Feature Name>" <file-path>   # Targeted update within a focus subfolder
```

The feature name is what the user types (typically Title Case, often with spaces — e.g., `"Order Fulfillment"`, `"Billing"`, `"Stripe Webhooks"`). The subfolder name is a **kebab-case slug** derived from that name (`order-fulfillment/`, `billing/`, `stripe-webhooks/`) — never the human-readable name verbatim. The slug may also be a simpler form of the feature name when one reads more naturally (`Order Fulfillment` → `orders/`).

---

## Output

### Default — full project documentation

```
generated-docs/
├── README.md               # Navigation hub: project summary + links to all docs
├── workflows.md            # Non-technical: user-facing workflows from system/integration tests
├── architecture.md         # Developer: stack, directory map, data model, patterns & conventions
├── ai-orientation.md       # AI agents: entry points, coverage map, known gaps, glossary
└── diagrams/
    ├── data-model.mmd      # Key entities + relationships (Mermaid erDiagram)
    └── architecture.mmd    # High-level component/module map (Mermaid graph TD)
```

### `--focus` — feature/subsystem deep dive

```
generated-docs/
└── <slug>/                                 # Kebab-case slug of the feature name
    ├── workflows.md                        # Non-technical: workflows scoped to this feature
    ├── architecture.md                     # Developer: architecture scoped to this feature
    └── diagrams/
        ├── <slug>-architecture.mmd         # Same slug as the folder, kept as prefix for global uniqueness
        └── <slug>-data-model.mmd
```

Example: `/document-this --focus "Order Fulfillment"` produces `generated-docs/orders/` (or `order-fulfillment/` — see slug rules below) containing `workflows.md`, `architecture.md`, and `diagrams/orders-architecture.mmd` + `diagrams/orders-data-model.mmd`.

**Focus mode produces only the four files above** — no `README.md` or `ai-orientation.md` inside the subfolder. The top-level docs serve those roles for the whole project; the focus subfolder is a deep dive linked from them.

`<slug>` is a short kebab-case form of the feature name, used for **both the folder and the diagram file prefixes**:

- **Default**: kebab-case of the full feature name (`Order Fulfillment` → `order-fulfillment`).
- **Shorter natural form is fine** when one reads better (`Order Fulfillment` → `orders`, `Stripe Webhooks` → `stripe-webhooks` or `stripe`). Use judgment.
- The same slug applies to the folder *and* to both diagram-file prefixes — they always match.

Multiple focus subfolders can coexist (`generated-docs/orders/`, `generated-docs/billing/`, etc.). Each is independent — regenerating one does not touch the others.

Regenerating any mode overwrites only the files it produces. Use `git diff generated-docs/` to review.

If `generated-docs/` does not exist, create it.

---

## Scripts

All scripts live under `scripts/` in this skill and emit **JSON on stdout**. Invoke them with `node` from the project root:

| Script | Purpose | Key Output Fields |
|---|---|---|
| `fingerprint.mjs` | Language, framework, DB, dep files, config files, project name | `language`, `database`, `configFiles`, `testLayouts` |
| `front_matter.mjs` | Current date + project name | `date`, `projectName` |
| `directory_tree.mjs [--depth N]` | Pruned directory tree honoring `.gitignore` | `tree` |
| `tech_stack.mjs` | Parsed dependency listing per ecosystem | `ecosystems` |
| `test_inventory.mjs` | Test files grouped by system / integration / unit | `files`, `summary` |
| `entities.mjs` | Model/entity definitions across any framework | `sources`, `schemaFiles` |
| `entry_points.mjs` | Routes, controllers, service layer directories | `routes`, `controllers`, `services` |

**Invocation from project root:**

Replace `skills/document-this/` below with the path to this skill in your installation (for example, under `.claude/skills/`, `.github/skills/`, or `.rolemodel-skills/skills/`).

```bash
node skills/document-this/scripts/fingerprint.mjs
node skills/document-this/scripts/front_matter.mjs
node skills/document-this/scripts/directory_tree.mjs --depth 3
node skills/document-this/scripts/tech_stack.mjs
node skills/document-this/scripts/test_inventory.mjs
node skills/document-this/scripts/entities.mjs
node skills/document-this/scripts/entry_points.mjs
```

**Fallback rule:** if `node` is not available on PATH, do not error — fall back to agent-driven extraction using Read, Glob, and Grep for the same purposes. Scripts are an optimization, not a hard dependency.

---

## Templates

Under `templates/`. Each is a markdown scaffold with `{{PLACEHOLDER}}` tokens the agent fills:

- `README.template.md` — navigation hub linking all generated files. Supports an optional `{{FOCUS_SUBFOLDERS}}` block for listing any `--focus` deep-dive subfolders.
- `workflows.template.md` — top-level scaffold for `workflows.md`.
- `workflow-entry.template.md` — one per workflow in the Workflows section.
- `architecture.template.md` — the Architecture section with explicit placeholders for stack, directory map, data model, patterns, optional JS architecture, and diagrams.
- `ai-orientation.template.md` — entry points, test coverage map (well-tested / undertested split), known gaps, glossary.
- `focus-workflows.template.md` — scaffold for a feature-scoped `workflows.md` inside a `--focus` subfolder. Same workflow-entry shape as the full version, with feature-specific intro and back-links to the top-level docs.
- `focus-architecture.template.md` — scaffold for a feature-scoped `architecture.md` inside a `--focus` subfolder. Tighter than the full architecture template — no JS-architecture section unless the feature is itself a JS subsystem.

---

## Generation Process (full)

Execute in this order. Each step's output informs the next. Each phase can stand alone — you don't need to complete all phases in one run.

### Phase 1 — Project Fingerprint

Run the fingerprint and tree scripts to orient yourself:

```bash
node skills/document-this/scripts/fingerprint.mjs
node skills/document-this/scripts/directory_tree.mjs --depth 3
```

From the output, derive — **do not assume**:
- Language and framework
- Test framework and where tests live
- Database(s) in use
- Major areas of the codebase
- What domain the project is in

Also read the README if one was detected.

### Phase 2 — Workflow Discovery → `workflows.md`

**Goal:** Document every user-facing workflow in plain English, for a non-technical reader.

**Discovery mechanism:** Start from system/end-to-end and integration tests, not routes or controllers. Tests are human-authored descriptions of complete user interactions.

```bash
node skills/document-this/scripts/test_inventory.mjs
```

Then:
1. Read each system/integration test file to identify workflows
2. Trace into source code only as needed to fill in details tests don't make explicit (validation rules, supported formats, role-based access)
3. Write each workflow using `templates/workflow-entry.template.md`
4. Group workflows logically by role or feature area
5. For 2–3 headline workflows (highest centrality or test count), add an inline `sequenceDiagram` mermaid block

**Persona filter:** Write as if the reader is a non-technical manager or end user. Do not assume they know what "modal", "CRUD", or "API" means.

**Inclusion rule:** Only document a workflow if backed by at least one system or integration test. If a workflow appears in code but has no test coverage, note it in Known Gaps instead.

**No-tests case:** if the project has zero system and integration tests, put a prominent note at the top of `workflows.md` using the `{{#if NO_SYSTEM_TESTS}}` block in the template.

### Phase 3 — Architecture Analysis → `architecture.md` + `diagrams/`

**Goal:** Give a developer enough orientation to understand the codebase in under 5 minutes.

```bash
node skills/document-this/scripts/tech_stack.mjs
node skills/document-this/scripts/directory_tree.mjs --depth 3
node skills/document-this/scripts/entities.mjs
node skills/document-this/scripts/entry_points.mjs
```

Cover these five things — keep each concise (not exhaustive documentation, just orientation):

1. **Stack & key dependencies** — language, framework, database, notable libraries worth knowing
2. **Directory map** — what lives where and why, one sentence per major folder
3. **Data model summary** — key entities and their relationships; do not enumerate every field
4. **Patterns & conventions** — e.g. "business logic lives in service objects", "controllers stay thin"
5. **JavaScript architecture** *(optional)* — include only if the project has significant JS: React/Vue/Angular component structure, state management, Stimulus or Alpine controllers, build/chunk strategy, Node.js services. Derive this from Glob/Grep — look for `components/`, `controllers/`, `src/`, etc.

Then create the Mermaid diagram files:
- `diagrams/data-model.mmd` — entity relationships (`erDiagram` syntax), derived from `entities.mjs` output and schema files. Include entity names and relationships only — do not add attribute rows to the tables.
- `diagrams/architecture.mmd` — high-level module/layer map (`graph TD` syntax), derived from `entry_points.mjs` and directory tree

### Phase 4 — AI Orientation → `ai-orientation.md`

**Goal:** Give an agent the fastest possible path to useful context without duplicating what's in `architecture.md`.

Open with:
> For stack, directory structure, data model, and conventions — see [Architecture](./architecture.md).

Then include exactly these four things:

1. **Entry points map** — for each major area of the codebase, the single best file to start reading (use `entry_points.mjs` output)
2. **Test coverage map** — split into "use tests as ground truth in" vs "read implementation code directly for" (derived from Phase 2 decisions and `test_inventory.mjs`)
3. **Known Gaps & Uncertainties** — things that couldn't be determined confidently during generation. Flag explicitly so future agents or developers know where to dig
4. **Terminology / Glossary** — project-specific terms, domain language, abbreviations, non-obvious naming conventions

### Phase 5 — README → `README.md`

Write a brief navigation document:
- One paragraph: what the project is and who uses it
- Links to `workflows.md`, `architecture.md`, `ai-orientation.md`, and the diagrams
- A **Deep dives** block listing any existing `--focus` subfolders (one bullet per subfolder, linking to its `workflows.md` and `architecture.md`). If there are none, omit the block. Detect them by `ls generated-docs/*/` for any folder that contains a `workflows.md`.
- Generation timestamp and auto-generated warning (use `templates/README.template.md`)

---

## Focused Generation Process: `/document-this --focus "<Feature Name>"`

Use when the user wants deep documentation for a single feature or subsystem — typically because the top-level `workflows.md` and `architecture.md` only give it a paragraph of treatment and the feature is complex enough to warrant its own pair of files.

The output is a self-contained subfolder under `generated-docs/<slug>/` with `workflows.md`, `architecture.md`, and `diagrams/<slug>-{architecture,data-model}.mmd`. Do **not** create a `README.md` or `ai-orientation.md` inside the subfolder.

### Phase F1 — Feature scoping

Before reading or writing anything, identify what code, tests, models, controllers, JS modules, jobs, and config files belong to this feature. The agent does this — there is no deterministic script for "is this file part of the orders feature." Use whatever combination of these signals is appropriate:

- **Name match** — Glob for files with the feature name or its slug in the path (`**/*orders*`, `**/*billing*`).
- **Reference match** — Grep for class names, table names, or domain terms associated with the feature (`OrderList`, `OrderSnapshot`, `order_policy`, …).
- **Test inventory filter** — re-run `test_inventory.mjs` and keep only specs whose names or paths match the feature.
- **Cross-references** — once you have an initial set, scan their imports/associations to pull in tightly coupled files (e.g., the `applyShippingRules` hook belongs to the orders feature even though `CheckoutFlow.js`, where it's registered, doesn't).

Record the scoping set as you go — you will reference it across phases. Aim for the **minimum set that explains the feature end-to-end**, not every file that mentions it. If a file is only tangentially related, leave it out and rely on the top-level docs to cover it.

If the scoping set is empty or trivially small (one or two files), **stop and tell the user** — the feature may not exist under that name, or it may already be adequately covered in the top-level docs.

### Phase F2 — Workflow discovery (scoped) → `<slug>/workflows.md`

Same approach as the full-mode workflow discovery, but filter to the feature scope:

1. From `test_inventory.mjs`, keep system/integration tests whose paths or `describe`/`context` strings reference the feature.
2. Read those tests. Each user-visible behavior they exercise is a workflow candidate.
3. **Also include workflows that aren't covered by tests but are clearly part of the feature** (e.g., a developer rake task for importing seed data) — but mark them explicitly as not test-backed and link to whatever evidence does exist (a script, a hand-written doc, a code path).
4. Group by **audience** (e.g., "Admins", "Customers", "Developers"). Open with a "Who interacts with this feature" section.
5. Use `templates/focus-workflows.template.md`. Use `templates/workflow-entry.template.md` for individual workflow entries.
6. Add an inline `sequenceDiagram` for the 1–3 most central workflows.
7. Path references back to the rest of the repo use `../` (e.g., `[spec/system/orders_spec.rb](../spec/system/orders_spec.rb)`).

### Phase F3 — Architecture analysis (scoped) → `<slug>/architecture.md` + `diagrams/`

Cover only the slices that matter for the feature:

1. **Stack** — only the libraries that the feature actually uses (don't list every dependency).
2. **Directory map** — only the directories that hold the feature's code, with one line each on what each contributes to *this feature*.
3. **Data model** — the tables and in-memory entities specific to the feature, with key columns and the JSON shapes they carry.
4. **Pipeline / flow** — if the feature has a notable end-to-end pipeline (ingest, request lifecycle, build chain), describe it with an inline ASCII or Mermaid diagram. This is often the single most useful section.
5. **Patterns & conventions** — only feature-specific conventions (e.g., "webhook retries are idempotent; duplicates are ignored").
6. **Mapping section (optional)** — if the user's mental model differs from the code, include a "User concept → reality" table. Useful when documenting features the user has questions about.
7. **Notable files** — 5–15 file paths the developer will keep returning to.

Then write the two diagram files:

- `diagrams/<slug>-data-model.mmd` — entities and relationships **for the feature only**. May include in-memory types (e.g., `CartSnapshot`), not just DB tables.
- `diagrams/<slug>-architecture.mmd` — the feature's end-to-end flow as a `graph TD` (sources → processing → destinations). Group with `subgraph` blocks by time/space boundary (build-time vs. runtime, web admin vs. background job, etc.).

Use `templates/focus-architecture.template.md` as the scaffold. Path references back to the rest of the repo use `../`.

### Phase F4 — Cross-link from the top-level docs (only if they exist)

After writing the focus subfolder, if `generated-docs/README.md` exists, check whether it lists this focus subfolder under "Deep dives". If not, add it. Do **not** regenerate the top-level workflows.md / architecture.md / ai-orientation.md as part of focus mode — if those need cross-references too, suggest the user run `/document-this` to refresh them.

If the top-level docs do not exist yet, the focus subfolder is the only output. The user can run `/document-this` later to generate the top level; that run will detect the focus subfolder and link to it from the README.

### Slug derivation

The slug is used for **the subfolder name and both diagram file prefixes** — all three always match.

- **Default**: kebab-case of the feature name (`Order Fulfillment` → `order-fulfillment`, `Billing` → `billing`, `Stripe Webhooks` → `stripe-webhooks`).
- **Shorter natural form is fine** when the long form reads awkwardly (`Order Fulfillment` → `orders`, `Stripe Webhooks` → `stripe`). Use judgment.
- Lowercase, ASCII letters, digits, and hyphens only. No spaces, no underscores, no capitals.
- If the slug would collide with an existing focus subfolder of a different feature, pick a different form rather than overwriting.

---

## Targeted Update: `/document-this <file-path>`

When called with a path (and no `--focus`), do not regenerate the whole document. Instead:

1. Identify which sections the file is most likely to affect:
   - Test files → `workflows.md` + test coverage map in `ai-orientation.md`
   - Entity/model files → `architecture.md` (data model) + `diagrams/data-model.mmd` + possibly Terminology
   - Service/controller files → `architecture.md` (patterns) + possibly `workflows.md`
   - Config/dependency files → `architecture.md` (stack)
   - JavaScript/TypeScript files → `architecture.md` (JS Architecture section) + possibly `diagrams/architecture.mmd`

2. Re-run only the relevant scripts

3. Regenerate only the affected sections

4. **Ripple check:** After updating, scan other sections for cross-references or dependent content that is now stale. Update those too if needed.

5. Do not regenerate the entire document unless the file affects all sections.

### With `--focus`: `/document-this --focus "<Feature Name>" <file-path>`

If `--focus` is also passed, restrict the update to the focus subfolder:

1. Confirm the file is in scope for the named feature. If not (the file has nothing to do with the focus subsystem), tell the user and stop — don't silently update unrelated docs.
2. Re-run only the relevant scripts, then regenerate the sections of `generated-docs/<slug>/workflows.md` or `architecture.md` (and/or the feature-prefixed diagrams) that the file affects.
3. Do **not** touch the top-level `generated-docs/*.md` files — those are out of scope for a focused update.
4. Same ripple-check rule applies within the focus subfolder.

---

## Quality Rules

### General

- **Never invent workflows.** Only document what is evidenced by tests or source code.
- **Never duplicate content between sections.** If something belongs in Architecture, reference it from AI Orientation rather than restating it.
- **Plain English in Workflows.** Save technical language for Architecture and AI Orientation.
- **No system tests = say so.** Note this prominently at the top of `workflows.md`. Do not fabricate workflows from routes or controllers alone.
- **Keep Architecture scannable.** Short paragraphs or brief lists — not walls of text.
- **Flag uncertainty explicitly.** Use Known Gaps rather than guessing.
- **Don't assume framework.** Derive everything from what you find in the project.
- **When scripts disagree with disk, trust disk.** Update Known Gaps with the discrepancy.

### Focus mode specifics

- **Scope discipline.** A focus doc covers one feature. If a workflow or entity is only tangentially related, leave it to the top-level docs.
- **No README, no ai-orientation in the subfolder.** Those roles belong to the top-level docs. Producing them inside a focus subfolder creates duplication.
- **Always link back to the top level.** The first paragraph of each focus doc should link to the top-level `workflows.md` and/or `architecture.md` so a reader knows there's a broader context.
- **Use `../` for paths to files outside the subfolder.** Test specs, source files, and other top-level project files all need the parent-dir prefix.
- **One slug per subfolder.** The folder name and both diagram-file prefixes always match (`orders/diagrams/orders-architecture.mmd` + `orders/diagrams/orders-data-model.mmd`, not `orders/diagrams/ord-architecture.mmd`).
- **Refuse to invent the feature.** If feature scoping comes back near-empty, stop and tell the user — don't write a thin doc just to have produced something.
