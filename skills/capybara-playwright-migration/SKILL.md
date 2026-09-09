---
name: capybara-playwright-migration
description: >
  Use this skill when migrating existing Selenium-based system tests to capybara-playwright-driver,
  when writing new system tests that use Playwright, or when debugging Playwright test behavior
  in a Capybara/RSpec environment. Triggers on: "migrate to playwright", "convert selenium tests",
  "playwright driver", "system test with playwright", or any debugging of JS-driven test failures
  after a Playwright migration.
---

# Capybara → Playwright Migration

You are orchestrating a full migration of Selenium-based Capybara system tests to `capybara-playwright-driver`. Execute the steps below in order.

## Your Role — Orchestrator Only

You are the orchestrator. Your job is to execute Steps 1–5 below exactly as written — do not deviate, skip, reorder, or add steps. You **never**:

- Run `bundle exec rspec` or any test command yourself
- Debug or fix individual test failures
- Modify test files or application code to fix test behavior

All test execution, debugging, and fixing is the sole responsibility of sub-agents. If a sub-agent reports a failure, record it in the tracker — do not attempt to re-run or fix it yourself.

---

## Step 1 — Apply Initial Migration

Read `references/initial-migration-steps.md` and apply every change it describes:

- Swap gems (add `capybara-playwright-driver`, remove `selenium-webdriver` and `capybara-lockstep`)
- Install Playwright via npm/yarn
- Register the Playwright driver in `spec/support/capybara_drivers.rb`
- Remove all capybara-lockstep references from layouts and helpers
- Update CI configuration
- Create `PlaywrightHelper` in `spec/support/playwright_helper.rb`

Run `bundle install` and confirm the app boots. Do not proceed until this step is clean.

## Step 2 — Build Test Inventory

Create a tracking document at `tmp/playwright_migration_tracker.md`.

1. Find all system test files: `find spec/system -name "*_spec.rb" -type f | sort`
2. Write the tracking document with this structure:

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

### spec/system/example_two_spec.rb
**Status:** Pending
**Results:**
```

Every file starts with `Status: Pending` and an empty `Results:` field.

## Step 3 — Migrate Tests (Rolling Pool of 5)

You maintain 5 agent **slots** numbered 1–5. Each slot maps to an isolated test database. Keep all 5 slots active at all times — as soon as one agent finishes, immediately fill its slot with the next pending file. Do **not** wait for all 5 to finish before spawning more.

### 3a — Start the pool

Take the first 5 pending files from the tracker. Spawn 5 sub-agents **in parallel** using the Agent tool — one per slot. Each sub-agent receives this prompt:

> You are a sub-agent responsible for migrating a single system test file from Selenium to Playwright. Read `references/sub-agent.md` from the capybara-playwright-migration skill for your full instructions. Also read `references/fixing-tests.md` from the same skill for fix patterns. Your assigned test file is: `<path>`. The tracking document is at: `tmp/playwright_migration_tracker.md`. Your agent number is: `<N>` (use this as your AGENT_NUMBER for test environment isolation).

### 3b — On each agent completion

When any sub-agent completes:

1. **Hung agent check** — if the agent returned empty or no output, it likely hung on a stuck test. Spawn a recovery sub-agent for that file (this does **not** consume a slot):

   > You are a recovery sub-agent. A previous agent for `<path>` returned no output, likely due to a hung test. Skip directly to Step 3 of `references/sub-agent.md` and record this file as Failed in the tracker at `tmp/playwright_migration_tracker.md` with the result: "Sub-agent returned no output — test likely hung or timed out."

2. **Refill the slot** — read the tracker for the next file with `Status: Pending`. If one exists, immediately spawn a new sub-agent for it using the same slot number that just freed up.

3. **Drain** — if no pending files remain, do not spawn. Wait for the remaining active agents to finish.

### 3c — Pool complete

Once all agents have completed and no pending files remain, proceed to Step 4.

## Step 4 — Display Results

Read the final `tmp/playwright_migration_tracker.md` and present a summary to the user:

1. Update the Summary section at the top of the tracker with final counts
2. **Overall stats**: total files, passed count, failed count
3. **Failed files** (if any): list each file with its failure explanation
