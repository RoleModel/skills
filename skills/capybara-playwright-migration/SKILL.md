---
name: capybara-playwright-migration
description: >
  Use this skill when migrating existing Selenium-based system tests to capybara-playwright-driver,
  when writing new system tests that use Playwright, or when debugging Playwright test behavior
  in a Capybara/RSpec environment. Triggers on: "migrate to playwright", "convert selenium tests",
  "playwright driver", "system test with playwright", or any debugging of JS-driven test failures
  after a Playwright migration.
---

# Capybara → Playwright Migration & Authoring Guide

You are helping migrate Selenium-based Capybara tests to `capybara-playwright-driver`, or debugging test failures after such a migration. Follow the routing below to load only the guidance you need.

---

## Determine Your Task

**Full migration** (Selenium → Playwright for the first time):
Read [references/initial-migration-steps.md](references/initial-migration-steps.md) for gems, driver setup, CI config, and helper modules. Then read [references/fixing-tests.md](references/fixing-tests.md) for before/after patterns to apply to existing tests.

**Fixing broken tests** after a migration:
Read [references/fixing-tests.md](references/fixing-tests.md) for the relevant before/after pattern and common post-migration debugging scenarios.
