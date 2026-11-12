---
name: app-feature-map
description: Crawls a running web app with Playwright and writes a nested map of its features, one markdown doc per page describing every interactive element in plain language with a Playwright locator, so testers and later QA scripts know what each page does. Asks first whether existing data may be changed, and maps once per user role. Use when the user says "/app-feature-map", "map the app", "document every page", "crawl the app", "what's interactive on each page", "build a feature map for QA", or "refresh the app map".
metadata:
  triggers: "app-feature-map, map the app, feature map, document every page, crawl the app, interactive elements, QA map, refresh the app map"
---

# App feature map

Produces `docs/app-map/` in the target project: a top `README.md`, one folder per app section, and one doc per page (URL pattern). Each doc lists what's interactive on the page, what it does, and a locator for it. QA scripts and smoke tests are built from these docs later, so the locators matter as much as the prose.

The work is split in two. `scripts/crawl.mjs` follows links to list the pages, and records a fingerprint of each page's controls, its errors, and a screenshot. Then each section is mapped: a section mapper opens what the crawl couldn't see, exercises the flows the data mode allows, and writes the docs. The mappers run either as parallel subagents or one at a time in this session, as the user chooses.

Prerequisites: the app is running, Playwright is installed in the project (`node_modules/playwright` or `@playwright/test`), and `playwright-cli` is on the path. Run everything from the project root.

## 1. Ask before running

Ask these in one batch, with a multiple-choice tool if there is one:

1. **App URL and start page.** Default `http://localhost:3000/`. Use a hosted test environment only when the user names it in chat.
2. **Data mode.** *Protect existing data* (default): may create records and change or delete only what this run created. *Allow changes to existing data*: local only. *Read-only*: opens everything, submits nothing. The rules for each mode are in [references/safety.md](references/safety.md). Read it now.
3. **Roles.** Which user roles to map, and for each, how to sign in: test credentials from the project's seeds or fixtures (local hosts only), or the user signs in by hand.
4. **Scope.** The whole app, or path prefixes such as `/widgets`.

Don't start until all four are answered. Sign-in with seed credentials and the crawl always run headless. Whether mapping runs headed is asked in step 5.

## 2. Sign in once per role

Set `RUN=tmp/app-map/<YYYYMMDD-HHMM>` and make sure `tmp/` is gitignored. For each role:

```bash
playwright-cli -s=<run-id>-auth-<role> open <base>/<sign-in path>
# seed credentials: fill the form and submit. By hand: add --headed to open so the user sees the window, ask the user to sign in, wait for their go-ahead.
playwright-cli -s=<run-id>-auth-<role> state-save $RUN/auth/<role>.json
playwright-cli -s=<run-id>-auth-<role> close
```

## 3. Crawl once per role

```bash
node <skill>/scripts/crawl.mjs --base <url> --start <path> --state $RUN/auth/<role>.json \
  --role <role> --out $RUN/crawl/<role> [--scope /widgets] [--allow-host]
```

Read the summary it prints, not the whole index. Exit code 2 means the session expired mid-crawl: sign in again and rerun. The crawl only loads pages by following links. It never submits forms or clicks buttons, but a page that writes on its own when it loads will still write. `--help` lists the other options.

## 4. Decide what to document

Merge the role indexes by `pattern`. When `docs/app-map/` already exists, compare each page's `fingerprint` to the doc's front matter:

- Same for every role: skip it.
- Changed, or new: assign it to its section.
- Doc exists, but no role reached the pattern: set `status: not-reached` in its front matter and list it in the report. Don't delete it.

Show the user the sections with their page counts, plus the crawl's skipped patterns and errors, and go on once they agree.

## 5. Map each section

Ask the user two questions in one batch, with the section list in front of them:

1. **Subagents.** Map in parallel subagents, one per section (faster, keeps this session's context small), or one at a time in this session (easier to watch and steer).
2. **Browser.** *Headed*: mapping browser windows are visible. *Headless*: no windows.

**Without subagents:** map the sections yourself, one at a time, following [references/mapping-a-section.md](references/mapping-a-section.md) with the same values as the brief below.

**With subagents:** launch the sections in one message, at most four at a time, as `rolemodel-skills:app-feature-map:section-mapper` when that type is listed. Otherwise use general-purpose subagents with the same brief:

> Read `<skill>/references/mapping-a-section.md` and follow it. Skill folder: `<skill>`. Section: `<section>`. Pages: `<slugs>`. Crawl folders: `$RUN/crawl/<role>` for each role. Auth: `$RUN/auth/<role>.json` for each role. Data mode: `<mode>`. Browser: `<headed|headless>`. Run id: `<run-id>`. Ledger: `$RUN/ledger/<section>.jsonl`. Docs: `docs/app-map/<section>/`.

If subagents can't run `playwright-cli`, tell the user and map the sections without subagents.

## 6. Write the top index

Write `docs/app-map/README.md` yourself from the crawl and the mappers' reports, in the format in [references/page-template.md](references/page-template.md): sections, global layout per role, roles mapped, run date, and what wasn't reached.

## 7. Clean up, then report

Follow **Cleanup** in [references/safety.md](references/safety.md): show the merged ledger, ask whether to delete the run's records, and on yes delete them from the Rails console.

Then report: docs written, updated, unchanged, and not reached; problems found (console errors, 5xx responses, broken controls) with their pages; canvas pages flagged for scripted interaction; controls left untouched because of the data mode; and any records still in the app.

## Gotchas

- **Web components hide their controls from `document.querySelector`.** `playwright-cli` snapshots see into open shadow roots, but an `eval` using `document.querySelectorAll` misses them.
- **A delete link looks like an ordinary link.** Rails renders `link_to … data: { turbo_method: :delete }` as an `<a href>`. Before clicking a link on an existing record, check it with `playwright-cli eval "el => [el.dataset.turboMethod, el.dataset.turboConfirm]" <ref>`. The crawl already skips these links.
- **The link crawl misses some pages.** Pages reached only by JS (clickable table rows, buttons that navigate) or by query-string views (`?tab=`) don't show up as separate patterns. Mappers find them while exploring. Pass the important ones as extra `--start` paths on the next run.
