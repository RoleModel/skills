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

## Step 3 — Fix Tests in Batches of 5

Select the next 5 files from the tracker that still have `Status: Pending`.

Spawn 5 sub-agents **in parallel** using the Agent tool — one per test file. Each sub-agent receives this prompt:

> You are a sub-agent responsible for migrating a single system test file from Selenium to Playwright. Read `references/sub-agent.md` from the capybara-playwright-migration skill for your full instructions. Also read `references/fixing-tests.md` from the same skill for fix patterns. Your assigned test file is: `<path>`. The tracking document is at: `tmp/playwright_migration_tracker.md`.

Wait for all sub-agents in the batch to complete before proceeding.

## Step 4 — Repeat Until Complete

After each batch of sub-agents finishes:

1. Read `tmp/playwright_migration_tracker.md`
2. Count files still showing `Status: Pending`
3. If pending files remain: return to Step 3 with the next batch (may be fewer than 5 for the last batch)
4. If no pending files remain: proceed to Step 5

## Step 5 — Display Results

Read the final `tmp/playwright_migration_tracker.md` and present a summary to the user:

1. Update the Summary section at the top of the tracker with final counts
2. **Overall stats**: total files, passed count, failed count
3. **Failed files** (if any): list each file with its failure explanation
