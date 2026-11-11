---
name: major-gc
description: "Deep dead-code hunt across a whole codebase: find files, classes, methods, routes, views, partials, CSS, feature flags, config, translations, and packages that nothing reaches, prove each one dead (including dynamic and string-built references), and remove the proven ones in reviewable batches. Use when the user says \"major gc\", \"deep clean\", \"find dead code\", \"find unused code\", \"what can we delete\", \"prune the codebase\", or asks for a full dead-code audit. For a quick lint-level sweep (leftover TODOs, unused imports, commented-out code), use minor-gc instead."
metadata:
  triggers: "major gc, deep clean, find dead code, find unused code, what can we delete, prune the codebase, dead code audit, unused classes, unused methods, unused routes, unused files, unused packages, unused CSS, unused translations, stale feature flags"
---

# Major GC

Find code that nothing reaches, prove it, and remove it in batches a
reviewer can follow. The hard part is the proof: most "unused" hits from
tools are false, because frameworks call code by name, by string, and by
convention. Treat every tool result as a lead, never as a verdict.

## 0. Set up

- Work on a fresh branch off the main branch. Never on `main`/`master`.
  If the tree is dirty, stop and ask.
- Run `minor-gc` first (or ask the user to). Leftover imports and
  commented-out code hide real references and make the deep pass noisy.
- Read the repo's agent docs (`AGENTS.md`, `CLAUDE.md`, `docs/`) for
  conventions that create hidden references: plugin registries, naming
  conventions, code shared with another service, public APIs.
- Ask the user if any of these exist, since they change what "unused" means:
  - Production usage data: coverage (Coverband, Datadog), request logs,
    Sentry, analytics. Code that runs in prod is not dead, whatever
    static tools say.
  - Other consumers: mobile apps, other services, public API clients,
    scripts run by hand, cron outside the repo.

## 1. Map the entry points

List everything that can start execution. Code reachable from none of these
is a candidate.

- HTTP: routes, controllers/actions, API endpoints, webhooks, GraphQL/MCP
  tool registries.
- Background: jobs, schedulers (cron, sidekiq-cron, `config/schedule`),
  queues, event subscribers, ActionCable channels.
- CLI: rake/thor tasks, `bin/` scripts, `package.json` scripts, Makefile.
- Front end: build entry files (Vite/webpack config), Stimulus/web component
  registration, HTML `data-controller`/`data-action` attributes, custom
  element tags in templates.
- Framework conventions: model callbacks, validations, concerns, helpers
  auto-included in views, mailer previews, initializers, `config/` files
  that name classes as strings, serializers found by class name.

## 2. Gather candidates

Use the best tool the stack has, then fill gaps with reference counting.

| Stack | Tools |
|---|---|
| JS/TS | `knip` (files, exports, deps), `ts-prune`/`ts-unused-exports`, `depcheck`, `unimported` |
| Ruby/Rails | `debride` (methods), `traceroute` (routes ↔ actions), `rails_best_practices` unused-methods check, `bundle exec rails stats` for a map |
| Python | `vulture`, `deptry` |
| Go | `deadcode`, `staticcheck -checks U1000` |
| CSS | `purgecss --rejected` against the templates and JS, or grep each class |
| Any | reference count: for each defined name, `rg -w` across the repo minus its own definition and tests |

Run tools without `npx`-style installs the user hasn't approved; ask before
adding a dev dependency. If a tool isn't installed, fall back to grep.

Look for these kinds, roughly in order of payoff:

1. Whole files and modules nothing imports or loads.
2. Routes with no action, actions with no route, views and partials no
   action or `render` names, unused mailers and jobs.
3. Classes and public methods with no callers outside their own file and tests.
4. Feature flags that are on (or off) everywhere — the losing branch is dead.
5. Packages in the manifest that no file imports.
6. CSS classes no template or script uses; unused images, fonts, icons.
7. Translation keys, env vars, config keys, and settings nothing reads.
8. One-off scripts, backfills, and data migrations whose work is done.
9. Duplicate implementations where one copy has no callers.
10. DB columns and tables no code reads or writes (report only — see step 5).

For a large repo, split by area (backend / frontend / assets / config) and
hand each to a subagent. Keep fan-out small — two at a time — and give each
the entry-point map from step 1 so they don't rebuild it.

## 3. Prove each candidate dead

A candidate is dead only when every check below comes back empty.

- **Every spelling of the name.** Search `CamelCase`, `snake_case`,
  `kebab-case`, `camelCase`, plural and singular, with and without
  namespace (`Admin::FooController`, `admin/foo`, `admin_foo_path`,
  `foo_url`). Rails turns `FooJob` into `"foo_job"`; Stimulus turns
  `foo_bar_controller.js` into `data-controller="foo-bar"`.
- **Dynamic dispatch.** `send`, `public_send`, `constantize`, `safe_constantize`,
  `method_missing`, `respond_to?`, `define_method`, `Object.const_get`,
  `obj[name]()`, dynamic `import()`, `require.context`, glob loaders,
  string-built partial and component names (`render "cards/#{kind}"`).
  If a name could be built at runtime, find the builder and list its inputs.
- **Outside code paths.** Templates (`.slim`, `.erb`, `.haml`, `.html`),
  YAML/JSON config, `.env` samples, Procfile, CI config, Dockerfiles,
  docs that are run as code, DB seeds, stored data (serialized class names,
  polymorphic `*_type` columns, STI `type` columns, enum values).
- **Callers outside the repo.** Public API endpoints, webhook targets,
  exported packages, anything named in the user's answers from step 0.
  Treat these as alive unless the user confirms otherwise.
- **History.** `git log -S<name>` and the commit that added it. Check open
  branches and PRs (`gh pr list --search <name>`) before deleting.
- **Production signal**, when available. Zero hits over a long window
  supports "dead"; any hit means alive.

Sort each candidate into:

- **Dead** — every check empty. Safe to remove.
- **Likely dead** — only a weak link left (an old doc, a string that might
  build the name, an unconfirmed outside caller). Needs a person.
- **Alive** — found a real caller. Drop it, and note the hidden path if it
  surprised you; that's worth a comment in the code.

## 4. Remove in batches

- Remove **Dead** items only. Group by feature or area, not by kind, so a
  reviewer sees "the old CSV importer is gone" rather than forty unrelated
  method deletions.
- Delete the tests, fixtures, factories, translations, styles, and assets
  that only served the removed code in the same commit.
- Remove removed packages from the manifest and lockfile with the package
  manager (`bundle remove`, `yarn remove`), never by hand.
- One commit per batch, following the repo's commit rules, so each batch
  reverts cleanly.

## 5. Things never to delete directly

- **DB columns and tables.** Report them. Dropping needs a staged plan
  (stop reading it → `ignored_columns` or equivalent → deploy → migration to
  drop) and a check of reports, exports, and other services that read the DB.
- **Migrations**, even old ones. Schema history is not dead code.
- **Public API surface** and anything another service or client calls,
  unless the user confirms it's retired.
- **Feature flags** still off in some environment or for some tenant.

## 6. Verify

- After each batch: lint, type check, build (JS bundles and asset
  pipelines catch missing imports that tests miss), and the tests for the
  touched area. Don't run a slow full suite per batch; run it once at the
  end, or leave it to CI and say so.
- Boot the app if the batch touched routes, initializers, autoloaded
  classes, or entry files — a Rails eager-load (`rails zeitwerk:check`) or a
  production build catches load errors fast.
- If anything fails, find out why before changing anything else (see
  Gotchas).

## 7. Report

Write the report to a file in the repo's scratch or docs area (or the
session's scratch folder) and summarize in chat:

- **Removed** — batch by batch: what it was, why it's dead, lines removed,
  commit SHA.
- **Likely dead, needs a decision** — each with the one thing keeping it
  from "Dead" and who could answer.
- **DB and API items** — with the staged plan for each.
- **Surprises** — hidden reference paths you found. These belong in the
  repo's docs or as code comments so the next pass doesn't trip on them.
- Totals: lines and files removed, packages dropped.

If the repo has a task board (e.g. `.rm-vault/`), offer cards for the
"needs a decision" and DB items.

## Gotchas

- Tests do **not** count as entry points. Code only tests reach is dead;
  delete the tests with it.
- Code added recently, or for a feature in progress, is often unused *yet*,
  not unused.
- A failure after a removal usually means a hidden reference you missed.
  Put the code back, move the item to **Alive**, and note the path; don't
  patch around it.
