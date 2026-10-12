---
name: capybara-playwright-migration
description: >
  Use this skill when migrating existing Selenium-based system tests to capybara-playwright-driver,
  when writing new system tests that use Playwright, or when debugging Playwright test behavior
  in a Capybara/RSpec environment. Covers two modes: a full, orchestrated migration of every
  system spec using parallel sub-agents, and a lightweight lookup of fixes for a single test.
  Triggers on: "migrate to playwright", "convert selenium tests", "playwright driver",
  "system test with playwright", "continue the playwright migration", or any debugging of
  JS-driven test failures after a Playwright migration.
metadata:
  author: rolemodelsoftware
  version: "1.0"
  triggers: "migrate to playwright, playwright migration, convert selenium tests, replace selenium, capybara-playwright-driver, playwright driver, system test with playwright, continue the playwright migration, resume playwright migration, flaky playwright test, playwright system spec failing, remove capybara-lockstep"
---

# Capybara → Playwright Migration

## Choose a Mode

Pick one before doing anything else:

- **Single test, new test, or debugging** — the user wants one spec fixed, a new Playwright system test written, or a failure explained. Read `references/fixing-tests.md` and apply it directly. Do not orchestrate, spawn sub-agents, or create a tracker.
- **Full migration** — the user wants the whole suite moved off Selenium. Run Steps 1–5 below.
- **Resume** — `tmp/playwright_migration_tracker.md` already exists. Skip to Step 4. Treat every `In progress` entry as `Pending` (its agent did not finish), and re-prepare the slot databases (Step 3, item 3) before spawning.

`<skill-dir>` below means the **absolute** path of the directory containing this SKILL.md (the skill loader shows it as the skill's base directory). Sub-agents do not share your working context, so every path you hand them must be absolute.

---

## Full Migration — Your Role Is Orchestrator Only

Execute Steps 1–5 exactly as written. You **never**:

- Run `bundle exec rspec` or any test command
- Debug or fix individual test failures
- Modify test files or application code to fix test behavior

You are the **only** writer of the tracker. Sub-agents report back; you record.

## Step 1 — Apply Initial Migration

Read `<skill-dir>/references/initial-migration-steps.md` and apply every step in it: gem swap, Playwright install, driver registration, lockstep removal, CI update, `PlaywrightHelper`, and the `database.yml` check.

Then confirm the app boots in the test environment:

```bash
bundle install && RAILS_ENV=test bin/rails runner 'puts :ok'
```

Do not proceed until this prints `ok` and `config/database.yml`'s test database name interpolates `ENV['TEST_ENV_NUMBER']`. Without that interpolation every slot shares one database and parallel agents corrupt each other's data silently.

## Step 2 — Checkpoint: Confirm and Size the Pool

Ask the user two questions, one at a time, using AskUserQuestion when available.

1. **Continue?** Summarize what Step 1 changed, then ask whether to begin migrating the system tests now. If no, stop and tell them they can resume later by asking to continue the Playwright migration.
2. **How many sub-agents?** Count the files (`find spec/system -name "*_spec.rb" -type f | wc -l`) and ask how many to run in parallel. Include the count; offer 5 as the recommended default.
   - Call the answer `POOL_SIZE`: a whole number ≥ 1, capped at the file count.
   - Each slot gets its own test database, so a larger pool means more databases and more machine load.

## Step 3 — Build the Inventory and Prepare Slot Databases

1. List the files: `find spec/system -name "*_spec.rb" -type f | sort`
2. Write `tmp/playwright_migration_tracker.md`:

   ```markdown
   # Playwright Migration Tracker

   ## Summary
   - Total files: <N>
   - Passed: 0
   - Failed: 0
   - Remaining: <N>

   ## Results

   ### spec/system/example_one_spec.rb
   **Status:** Pending
   **Results:**
   ```

   Statuses move `Pending → In progress → Passed | Failed`. No other values.
3. Prepare every slot database once, so sub-agents start clean:

   ```bash
   for n in $(seq 1 <POOL_SIZE>); do TEST_ENV_NUMBER=$n bin/rails db:test:prepare || break; done
   ```

   If any slot fails, stop and show the user the error.

## Step 4 — Migrate Tests (Rolling Pool of `POOL_SIZE`)

You maintain slots numbered 1–`POOL_SIZE`, each mapped to one slot database. Keep every slot busy: the moment an agent finishes, refill its slot. Never wait for the whole pool.

### 4a — Spawning a sub-agent

Mark the file `In progress` in the tracker, note which slot it is in, then spawn with the Agent tool using this prompt:

> You are a sub-agent migrating one system test file from Selenium to Playwright. Read `<skill-dir>/references/sub-agent.md` for your instructions and `<skill-dir>/references/fixing-tests.md` for the only fixes you may apply.
> TEST_FILE: `<path>`
> AGENT_NUMBER: `<slot>`
> SKILL_DIR: `<skill-dir>`

### 4b — Start the pool

Spawn the first `POOL_SIZE` pending files in a single message so they run in parallel.

### 4c — On each agent completion

1. **Record the result.** The agent's final message ends with a result block (format in `sub-agent.md`). Copy `STATUS`, `TESTS`, `APP_CODE_CHANGED`, and `FAILURES` into that file's tracker entry, set its Status, and update the Summary counts.
2. **Hung agent.** If the output is empty or has no result block, the agent likely hung on a stuck test. Run `pkill -f "rspec <path>" || true` yourself, then record:

   ```markdown
   **Status:** Failed
   **Results:** Sub-agent returned no output — a test likely hung.
   ```
3. **Refill the slot** with the next `Pending` file (4a). If none remain, spawn nothing and wait for the active agents.

When no files are `Pending` or `In progress`, go to Step 5.

## Step 5 — Display Results

Confirm the tracker Summary matches the per-file statuses, then report to the user:

1. Total, passed, and failed counts
2. Each failed file with its failure explanations
3. Every path listed under `APP_CODE_CHANGED`, de-duplicated, so the user can review application code changes in one place
