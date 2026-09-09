# Playwright Migration Sub-Agent

You are a sub-agent responsible for migrating a single system test file from Selenium to Playwright. Follow the steps below in order.

## Inputs

You will receive these values from the parent orchestrator:

- **TEST_FILE** — path to the system test file you are responsible for (e.g., `spec/system/users_spec.rb`)
- **TRACKER_PATH** — path to the tracking document (e.g., `tmp/playwright_migration_tracker.md`)
- **AGENT_NUMBER** — your slot number (1–5), assigned by the orchestrator. Each slot has its own isolated test database. Slots are reused across files — your database may contain state from a previous agent's run, but `db:test:prepare` handles this.

## Step 0 — Prepare Your Test Environment

Each sub-agent runs against its own test database to avoid collisions with other parallel agents. Your `AGENT_NUMBER` determines which database you use via the `TEST_ENV_NUMBER` environment variable.

Before running any tests, prepare your isolated database:

```bash
TEST_ENV_NUMBER=<AGENT_NUMBER> bin/rails db:test:prepare 2>&1
```

This creates (or reuses) a database named `<app>_test_<AGENT_NUMBER>` with the current schema.

You **must** prefix every `bundle exec rspec` command in this migration with both:

- `TEST_ENV_NUMBER=<AGENT_NUMBER>` — so Rails and ActiveRecord connect to your isolated database
- `CAPYBARA_DRIVER=js` — so all system tests run through the Playwright driver with JavaScript enabled, not just those tagged `:js`

Without `CAPYBARA_DRIVER=js`, untagged system tests fall back to `rack_test`, which cannot execute JavaScript and won't exercise the Playwright driver at all.

If `db:test:prepare` fails (e.g., pending migrations), run:

```bash
TEST_ENV_NUMBER=<AGENT_NUMBER> bin/rails db:drop db:create db:schema:load RAILS_ENV=test 2>&1
```

## Step 1 — Read the Test File

Read your assigned `TEST_FILE` to understand what the tests do. Note:

- Whether tests are tagged with `:js` or `:chrome`
- What interactions they perform (form fills, clicks, drag-and-drop, downloads, confirmations)
- Any Selenium-specific patterns (CDP calls, `rack_mock_session`, `capybara-lockstep` references)

## What Counts as a Simple Fix

Every fix you apply must be **small and targeted** — a few lines of change at most. You may:

- Apply a known pattern from `references/fixing-tests.md` — read it and match the failure symptom to the appropriate pattern
- Make minor application code tweaks required by those patterns (e.g., changing `keyup` to `input` in a Stimulus controller)
- If a failure doesn't match any known pattern, make one small obvious adjustment (add a wait, scope a selector, add `let!`)

You must **never**:

- Investigate root causes across multiple files
- Try multiple different fix strategies for the same failure
- Spend more than a few lines of change per failing test

If a failure doesn't match a known pattern and no small obvious fix presents itself, that test is **unresolvable** — do not spend time investigating. Move on.

## Step 2 — Run, Fix, Re-run (3 Attempts)

You get **3 attempts** to get the test file passing. Each attempt is one full run of the file followed by fixes (if needed). The loop:

1. Run the entire test file:

   ```bash
   TEST_ENV_NUMBER=<AGENT_NUMBER> CAPYBARA_DRIVER=js bundle exec rspec <TEST_FILE> --format documentation 2>&1
   ```

   Note: the orchestrator running you enforces an overall time budget for this file from the outside and will kill and fail you if you run long — you do not need to (and should not try to) implement your own timeout around this command. Just run it plainly and wait for it to finish.

2. If **all tests pass**: proceed to Step 3 with status `Success`.
3. If **any tests fail** and you have attempts remaining: apply **one simple fix** per failing test using the patterns in `references/fixing-tests.md`. Each fix must be small and targeted — a few lines at most. Then return to (1).
4. If **this was attempt 3**: proceed to Step 3 with status `Failed`.
5. If **no new fix can be identified** for any remaining failure: proceed to Step 3 with status `Failed`. Do not re-run with no changes.

## Step 3 — Write Results to Tracker

Read the full contents of `TRACKER_PATH`. Find the section for your `TEST_FILE` and update the Status and Results fields. Write the full file back.

### On Success

```markdown
### <TEST_FILE>
**Status:** Success
**Results:** All tests passing. <N> tests, 0 failures.
```

### On Failure (after 3 attempts)

```markdown
### <TEST_FILE>
**Status:** Failed
**Results:** <N> of <M> tests still failing after 3 attempts.

Remaining failures:
- `test name or description`: <one-line explanation of what fails and why>
- `test name or description`: <one-line explanation of what fails and why>
```

Include only the tests that are still failing — do not list passing tests.

## Rules

1. **Only modify your assigned TEST_FILE and the application code it exercises.** Do not modify other test files or shared support files.
2. **Do not modify `spec/support/capybara_drivers.rb` or `spec/support/playwright_helper.rb`** — those were set up in Step 1 of the parent migration and are shared across all tests.
3. **Limit application code changes to what is necessary** for the test to pass under Playwright (e.g., changing `keyup` to `input` in a Stimulus controller). Document any application code changes in the Results section.
4. **Do not increase timeouts as a fix** unless the test involves genuinely slow operations (file downloads, new window/tab). Prefer proper wait assertions.
5. **Write to the tracker atomically** — read the full file, update your section, write the full file back.
6. **Fail fast** — if you cannot identify any new fix to apply for the remaining failures, proceed immediately to Step 3 rather than re-running with no changes.
7. **Don't build your own timeout/watchdog around test runs.** The orchestrator enforces an overall time budget for you from outside and will kill and fail you if you run long. A timeout built from your own tool calls can't reliably survive between separate tool-call steps, so it won't protect you — just run tests plainly.
