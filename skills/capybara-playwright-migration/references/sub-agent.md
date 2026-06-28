# Playwright Migration Sub-Agent

You are a sub-agent responsible for migrating a single system test file from Selenium to Playwright. Follow the steps below in order.

## Inputs

You will receive these values from the parent orchestrator:

- **TEST_FILE** — path to the system test file you are responsible for (e.g., `spec/system/users_spec.rb`)
- **TRACKER_PATH** — path to the tracking document (e.g., `tmp/playwright_migration_tracker.md`)

## Step 1 — Read the Test File

Read your assigned `TEST_FILE` to understand what the tests do. Note:

- Whether tests are tagged with `:js` or `:chrome`
- What interactions they perform (form fills, clicks, drag-and-drop, downloads, confirmations)
- Any Selenium-specific patterns (CDP calls, `rack_mock_session`, `capybara-lockstep` references)

## Step 2 — Run the Test File (Attempt 1 of 3)

Run the test file:

```bash
bundle exec rspec <TEST_FILE> --format documentation 2>&1
```

- If **all tests pass**: skip to Step 5 with status `Success`.
- If **any tests fail**: proceed to Step 3.

## Step 3 — Apply Fixes

Read `references/fixing-tests.md` from the capybara-playwright-migration skill. For each failing test, identify which pattern applies and make the fix. Use this mapping table to quickly find the right pattern:

| Failure symptom | Pattern in fixing-tests.md |
|---|---|
| Assertions pass then immediately fail, or elements not found after action | Timing Issues After Removing capybara-lockstep |
| `Playwright::Error` multiple elements match selector | Duplicate `data-testid` Values |
| Turbo Frame link click doesn't update content | Turbo Frame Navigation |
| Factory record not found on page in `:js` test | `let` vs `let!` in JS Tests |
| Old flash message still in DOM, or obscures next click | Flash Message Accumulation |
| Spinner/skeleton assertion flakes | Don't Assert Transient Loading States |
| Multi-step form button click fails | Assert Button Existence Before Clicking |
| New window/tab operation times out | New Window / Tab Operations |
| Confirmation dialog not handled | Confirmation Dialogs |
| `ElementNotFound` after page navigation | Explicit Waits After Navigation |
| `fill_in` doesn't trigger JS handler | Fill-In and Keyboard Events |
| Debounced search/filter doesn't fire | JS Debouncing and Throttling |
| Async component not ready on page | Async Component Loading (`data-loaded` Pattern) |
| Select/dropdown interaction fails | Select / Option Elements |
| Element found but interaction fails (hidden/off-screen) | Element Visibility |
| `Playwright::Error` ambiguous element match | Element Scoping (Ambiguity Resolution) |
| Test needs JS but isn't tagged | When to use `:js` |
| Implicit wait doesn't catch async update | Wait Patterns |
| Drag-and-drop doesn't work | Drag and Drop (SortableJS / Complex DnD) |
| Timezone-dependent test fails | Browser Timezone Override |
| HTTP status code check fails | HTTP Status Code Checks |
| Cookie access fails | Cookie Access |
| `data-testid` selector not found | `data-testid` Selectors |
| Download test fails | File Downloads |

If a failure does not match any known pattern, use your best judgment to fix it. Prefer minimal, targeted changes — do not refactor unrelated code.

## Step 4 — Re-run the Test File (Attempts 2 and 3)

After applying fixes, re-run the test file:

```bash
bundle exec rspec <TEST_FILE> --format documentation 2>&1
```

- If **all tests pass**: proceed to Step 5 with status `Success`.
- If **tests still fail** and this was attempt 2: return to Step 3 and apply additional fixes, then run attempt 3.
- If **tests still fail** after attempt 3: proceed to Step 5 with status `Failed`.

## Step 5 — Write Results to Tracker

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
