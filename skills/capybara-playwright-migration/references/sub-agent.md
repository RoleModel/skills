# Playwright Migration Sub-Agent

You migrate a single system test file from Selenium to Playwright, then report back. The orchestrator records your result — you never touch the tracker.

## Inputs

- **TEST_FILE** — the system test file you own (e.g. `spec/system/users_spec.rb`)
- **AGENT_NUMBER** — your slot number. It selects your isolated test database via `TEST_ENV_NUMBER`. The orchestrator has already prepared it.
- **SKILL_DIR** — absolute path to the skill. Fixes come only from `SKILL_DIR/references/fixing-tests.md`.

## The Test Command

Every run uses exactly this command, through the Bash tool with `timeout: 600000` (the maximum):

```bash
TEST_ENV_NUMBER=<AGENT_NUMBER> CAPYBARA_DRIVER=js bundle exec rspec <TEST_FILE> --format documentation 2>&1
```

- `TEST_ENV_NUMBER` connects to your slot's database, not another agent's.
- `CAPYBARA_DRIVER=js` forces every example through Playwright. Without it, untagged examples run on `rack_test` and never exercise the new driver.

**If the run times out**, a test hung. Kill it and stop — report `STATUS: Failed (hung)`:

```bash
pkill -f "rspec <TEST_FILE>" || true
```

**If the first run fails with a database error** (missing database, pending migrations, schema mismatch), run `TEST_ENV_NUMBER=<AGENT_NUMBER> bin/rails db:test:prepare 2>&1` once and retry. This does not count as an attempt.

## Step 1 — Read the Test File

Note which examples are tagged `:js` or `:chrome`, what they interact with (forms, drag-and-drop, downloads, confirms, new windows), and any Selenium-only code (`execute_cdp`, `rack_mock_session`, lockstep calls).

## Step 2 — Run, Fix, Re-run (Up to 3 Runs)

1. Run the file.
2. **All pass** → report `Passed`.
3. **Failures** → for each failing example, find its symptom in the index at the top of `fixing-tests.md` and apply that **one** documented fix — a few lines at most. Then run again.
4. Stop and report `Failed` when either:
   - three runs have happened, or
   - no documented fix matches any remaining failure (never re-run without a change).

A failure that matches no documented fix is reported, not fixed. Do not improvise, investigate across files, or try a second strategy for the same failure.

## Scope Rules

- **Edit only `TEST_FILE`, the application code it exercises, and — for documented helpers only — `spec/support/playwright_helper.rb` or `spec/support/capybara_drivers.rb`.** Never edit other specs, and never make any other change to those support files.
- **Adding a documented helper.** If a fix uses a helper from a **Helper** block in `fixing-tests.md`, re-read the file that block names immediately before editing (another agent may have just added it). If the method is already defined, use it as is. Otherwise add the documented definition verbatim — inside the module for `playwright_helper.rb`, at the top level alongside `create_driver` for `capybara_drivers.rb`. Never change, reorder, or remove existing methods, and never add an undocumented one.
- **App code and the support files are shared with other running agents.** Read the file immediately before editing it, since another agent may have changed it. Keep edits minimal, and list every file you changed outside `TEST_FILE` in `APP_CODE_CHANGED`.
- **Don't raise timeouts** except for genuinely slow operations (downloads, new windows) as `fixing-tests.md` describes.

## Step 3 — Report

End your final message with this block, exactly, and nothing after it:

```
STATUS: Passed | Failed | Failed (hung)
TESTS: <passing>/<total>
APP_CODE_CHANGED: <comma-separated paths, or none>
FAILURES:
- <example description>: <one line — what fails and why no documented fix applied>
```

List only still-failing examples under `FAILURES` (write `- none` when passing).
