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

## Step 2 — Checkpoint: Confirm and Size the Pool

Stop here and get two answers from the user before touching any tests. Ask them one at a time, using AskUserQuestion when it is available.

1. **Continue?** Summarize what Step 1 changed, then ask whether to begin migrating/fixing the system tests now.
   - If the user says no, stop. Tell them the initial migration is in place and that they can resume later by asking to continue the Playwright migration from Step 3.
2. **How many sub-agents?** Count the system test files (`find spec/system -name "*_spec.rb" -type f | wc -l`) and ask how many sub-agents to run in parallel. Include the file count in the question and offer 5 as the recommended default.
   - Call the answer `POOL_SIZE`. It must be a whole number of at least 1; if it exceeds the file count, use the file count.
   - Each slot gets its own test database, so a larger pool means more databases and more load on the machine.

## Step 3 — Build Test Inventory

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

## Step 4 — Migrate Tests (Rolling Pool of `POOL_SIZE`)

You maintain `POOL_SIZE` agent **slots** numbered 1–`POOL_SIZE`. Each slot maps to an isolated test database. Keep every slot active at all times — as soon as one agent finishes, immediately fill its slot with the next pending file. Do **not** wait for the whole pool to finish before spawning more.

### 4a — Spawning a sub-agent

Every sub-agent, whether it starts the pool or refills a slot, is spawned with the Agent tool and receives this prompt:

> You are a sub-agent responsible for migrating a single system test file from Selenium to Playwright. Read `references/sub-agent.md` from the capybara-playwright-migration skill for your full instructions, and `references/fixing-tests.md` from the same skill — it is the **only** source of fixes you may apply. Your assigned test file is: `<path>`. The tracking document is at: `tmp/playwright_migration_tracker.md`. Your agent number is: `<N>` (use this as your AGENT_NUMBER for test environment isolation).

Keep a note of which file each slot is working on.

### 4b — Start the pool

Take the first `POOL_SIZE` pending files from the tracker and spawn one sub-agent per slot, all in the same message so they run in parallel (4a).

### 4c — On each agent completion

When any sub-agent completes:

1. **Hung agent check** — if the agent returned empty or no output, it likely hung on a stuck test. Spawn a recovery sub-agent for that file.
2. **Refill the slot** — read the tracker for the next file with `Status: Pending`. If one exists, immediately spawn a new sub-agent for it in the slot that just freed up (4a).
3. **Drain** — if no pending files remain, do not spawn. Wait for the remaining active agents and recovery agents to finish.

Recovery sub-agents do **not** consume a slot. Spawn each one with this prompt:

> You are a recovery sub-agent. Read `references/recovery-agent.md` from the capybara-playwright-migration skill and follow it exactly. TEST_FILE: `<path>`. TRACKER_PATH: `tmp/playwright_migration_tracker.md`.

### 4d — Pool complete

Once all agents (including recovery agents) have completed and no pending files remain, proceed to Step 5.

## Step 5 — Display Results

Read the final `tmp/playwright_migration_tracker.md` and present a summary to the user:

1. Update the Summary section at the top of the tracker with final counts
2. **Overall stats**: total files, passed count, failed count
3. **Failed files** (if any): list each file with its failure explanation
