---
name: sentry-standard
description: Audit or provision a Rails app's Sentry-side setup against the RoleModel standard — dashboards, alert rules, team assignment, cron monitor validation, uptime monitors. Use when the user asks to "set up sentry" for an app, "audit sentry", "check sentry setup", or bring a project up to the Sentry standard. Repo-side SDK config is NOT this skill's job (that's the rolemodel_rails sentry generator).
---

# RoleModel Sentry Standard — audit & provision

Bring one Sentry project up to the org standard. This skill covers only what the
`rolemodel_rails` Sentry generator **cannot** do (it owns gems, initializers, user
context, and sourcemap upload — if those are missing, tell the user to run
`rails g rolemodel:sentry` instead of fixing them here):

1. Project + team setup
2. Alert rules (new issue, regression, error spike → team Slack channel)
3. The shared `RoleModel SHM` dashboard (one org-wide dashboard, not per-app)
4. Cron monitor validation
5. Uptime monitor validation

**One dashboard for the whole org.** A Sentry dashboard's project filter is
switched at view time, so a single `RoleModel SHM` dashboard serves every app —
open it, pick the project (and environment) from the selector, and the widgets
re-scope. This skill ensures that one dashboard exists and matches the template;
it does **not** create a dashboard per app. (This replaces the earlier per-app
`<App> SHM` model — if you find leftover per-app SHM dashboards, treat them as
deprecated and offer to delete them once the shared one is in place.)

**Org constants:** organization `rolemodel-software`, region `https://us.sentry.io`.

## How to talk to Sentry

Use the `sentry` CLI (https://cli.sentry.dev — verify with `sentry auth status`):

- Reads: `sentry project list|view`, `sentry team list`, `sentry dashboard list|view`,
  `sentry alert issues|metrics list|view`, `sentry monitor list`
- Writes: `sentry alert issues|metrics create` (supports `--dry-run`),
  `sentry dashboard create` + `sentry dashboard widget add`
- Anything without a dedicated command (uptime monitors, posting a full dashboard
  JSON): `sentry api <endpoint>` — endpoint is relative to `/api/0/`, auth is
  automatic. `sentry schema --search <term>` finds endpoint shapes.
- Append `--json` to any command when you need to parse the output.

CLI gotchas (learned on the c12 pilot):
- `sentry monitor list <org>/<project>` does NOT filter by project — list org-wide
  (response shape `{"data": [...]}`) and filter on `.project.slug` yourself.
- `sentry dashboard view` needs the org as a separate arg: `sentry dashboard view rolemodel-software/ <id>`.
- `sentry alert metrics create` can 403 for member-role users (org restricts
  metric-alert creation). If it does, classify 2c as 📋 for an org admin.
- `sentry dashboard list` paginates — a dashboard can be absent from the first
  page. To find one by title, use
  `sentry api 'organizations/rolemodel-software/dashboards/?query=<title>'`.
- Uptime and cron failures both have `issue.category:outage`
  (types `uptime_domain_failure` / `monitor_check_in_failure`). The legacy
  `uptime` and `cron` category values still parse without error but match
  nothing — a widget or search using them silently returns empty.
- Dashboards have no uptime dataset (valid widgetTypes as of 2026-07:
  error-events, spans, issue, logs, discover, metrics, transaction-like), so
  uptime **percentage** can't be a widget — pull it from the API instead (see
  Step 3).

The Sentry MCP tools work as an alternative when the CLI isn't installed.

## Step 0 — Gather inputs

Determine, asking the user only for what can't be derived:

- **Project slug + numeric ID** — match the repo to a project via `find_projects`.
  If ambiguous, ask. (Used for alerts, cron/uptime monitors — the dashboard is
  org-wide and not scoped to this project.)
- **Team + Slack channel** — teams map 1:1 to Linear teams (some partners have one
  team covering several apps). Find the Sentry team via `find_teams`; ask the user
  for the Slack channel name.
- **Production URL** — for the uptime check; usually derivable from the repo
  (README, `production.rb` hosts) — confirm with the user if guessing.
- **Scheduled jobs** — enumerate from the repo: GoodJob cron config
  (`config.good_job.cron` in application.rb/initializers), `config/recurring.yml`
  (Solid Queue), `sidekiq-cron`/`sidekiq-scheduler` YAML, `whenever` schedule.rb,
  and any job classes including `Sentry::Cron::MonitorCheckIns`
  (grep `sentry_monitor_check_ins`).

## Step 1 — Audit

Check each item and classify: ✅ compliant · 🔧 auto-fixable · 📋 needs a human.

| # | Check | How |
|---|-------|-----|
| 1a | Project exists | `sentry project list rolemodel-software/ --json` |
| 1b | Project assigned to the right team | `sentry project view rolemodel-software/<slug> --json`; fix via `sentry api projects/rolemodel-software/<slug>/teams/<team>/ -X POST` |
| 2a | Issue alert: new issue → team Slack | `sentry alert issues list rolemodel-software/<slug> --json`; inspect actions target the right channel |
| 2b | Issue alert: regression → team Slack | same |
| 2c | Metric alert: error-volume spike | `sentry alert metrics list rolemodel-software --json`; threshold ≈ 10× the app's average hourly error count over 30d (min 50) — get the baseline with `sentry explore` or `sentry event list` |
| 3a | Shared `RoleModel SHM` dashboard exists (org-wide, one for all apps) | `sentry api 'organizations/rolemodel-software/dashboards/?query=RoleModel SHM'` (dashboard list paginates — search by title) |
| 3b | Dashboard widgets match the template | `sentry dashboard view rolemodel-software/ <id> --json`, diff against `references/dashboard_template.json` (widget titles + queries; layout drift is fine). Confirm its project filter is **not** pinned to one project (empty `projects`/"All Projects") so the selector can re-scope it |
| 4a | Every scheduled job in the repo has a cron monitor | repo job list vs `sentry monitor list rolemodel-software/<slug> --json` |
| 4b | Every monitor is active/green and creates issues on failure | monitor details: status ok, `failure_issue_threshold` set (`sentry api organizations/rolemodel-software/monitors/<monitor-slug>/`) |
| 4c | No orphan monitors (monitor exists, job deleted from repo) | reverse diff — report, don't auto-delete |
| 5a | Uptime monitor exists for the production URL and is active | `sentry api organizations/rolemodel-software/uptime/` (confirm shape with `sentry schema --search uptime` first) |

Present the results as a table **before fixing anything**, then confirm with the user
which 🔧 items to apply (one confirmation for the batch, not per item).

## Step 2 — Fix

- **Alerts**: create missing rules with `sentry alert issues create` /
  `sentry alert metrics create` per `references/alert_templates.md` — run with
  `--dry-run` first, then for real. Cron/uptime failures surface as issues, so rule
  2a is what routes them to Slack — never add an issue-category filter to it.
- **Dashboard**: create the shared `RoleModel SHM` dashboard **once for the whole
  org** — only if 3a found none. Post `references/dashboard_template.json` as-is
  (no substitution — it has a fixed title and an empty project filter so the
  selector re-scopes it per app):
  `sentry api organizations/rolemodel-software/dashboards/ -X POST --input <file>`.
  (One `sentry api` call, not 12 `dashboard widget add` calls — several widgets are
  multi-series, which `widget add` can't express.) Because it's org-wide, the PII
  and per-project decisions are made at **view** time via the project selector, not
  baked in — do not add a project-specific "Affected Users" widget here. If the
  dashboard exists but drifts, PUT the merged widget list back the same way —
  **add** missing widgets; ask before removing custom ones someone added
  deliberately. Exception: widgets from the pre-July-2026
  template revision — Throughput (epm), Failed Requests, Handled vs. Unhandled,
  Throughput Over Time, Where Time Is Spent (by operation), Transactions by
  Failure Rate — are deprecated, not custom; remove them as part of the confirmed
  fix batch. (The current widget set is data-driven: it keeps only what SHM report
  writers actually cited across seven months of Almanac health report summaries,
  and adds issue-widgets for uptime/cron failures and performance issues, the two
  most-written-about topics that previously required leaving the dashboard.)
- **Cron monitors**: missing monitors are a repo problem (job lacks
  `sentry_monitor_check_ins`) — never create monitors API-side for jobs that never
  check in. Instead, provision them in code (see "Cron provisioning" below), with
  user confirmation on the diff. Monitors that exist but have no
  `failure_issue_threshold` → 🔧 update via API.
- **Uptime**: create the monitor if missing (interval 60s, checking the production
  URL) after confirming the URL with the user.

### Cron provisioning (repo-side, confirmation required)

No API calls needed: `sentry_monitor_check_ins` **upserts the monitor in Sentry on
the job's first check-in** — write the code, and the monitors appear after deploy.

Keep the schedule config as the **single source of truth** — don't scatter crontab
strings into job classes. For GoodJob (reference implementation:
`c12_core/config/initializers/good_job.rb` + `app/jobs/application_job.rb`):

1. `include Sentry::Cron::MonitorCheckIns` once in `ApplicationJob` (inert until
   the macro is called).

2. Below the cron hash in the GoodJob initializer, derive every monitor from it:

   ```ruby
   Rails.application.config.to_prepare do
     next unless Sentry.initialized? && Sentry.configuration.environment == 'production'

     Rails.application.config.good_job[:cron].each do |key, entry|
       entry[:class].constantize.sentry_monitor_check_ins(
         slug: key.to_s.dasherize,
         monitor_config: Sentry::Cron::MonitorConfig.from_crontab(entry[:cron], checkin_margin: 5)
       )
     end
   end
   ```

   The entry key becomes the monitor slug; schedule changes in the cron hash flow
   to Sentry automatically (upsert on next check-in).

3. This requires each cron entry to map to a **distinct job class** (the macro is
   class-level). For a class scheduled twice, create empty per-schedule subclasses
   (e.g. `class HourlyBlazerChecksJob < BlazerChecksJob; end`) and point the cron
   entries at them — kwargs keep working since subclasses inherit `perform`.

   For Solid Queue (`config/recurring.yml`) the same pattern applies: iterate the
   parsed YAML in a `to_prepare` block.

4. The production-only guard above is **required**, not optional: each monitor
   costs $1/month, and staging apps typically run crons under
   `RAILS_ENV=production`, so gate on the **Sentry** environment (set via
   `SENTRY_ENVIRONMENT`), never `Rails.env`.

5. Show the user the full diff and get confirmation **before** writing. After
   applying, run the test suite and verify both sides of the gate:
   `SENTRY_ENVIRONMENT=production bin/rails runner 'Rails.application.config.good_job[:cron].each { |k, e| puts "#{k}: #{e[:class].constantize.sentry_monitor_config.schedule.value}" }'`
   (and confirm `sentry_monitor_config` is nil without the env var).

6. Tell the user monitors appear in Sentry after the next deploy + first scheduled
   run. Schedule the follow-up: re-run this skill's audit afterward to set each new
   monitor's `failure_issue_threshold` (step 4b) — `from_crontab` can't set it.

## Step 3 — Report

End with: the check table (final state), links to the alert pages and to the
shared `RoleModel SHM` dashboard (link it with this project + production
pre-selected so the reader lands on the right view), and a short 📋 list of
anything requiring a human (Heroku dyno metadata, generator re-run, Slack channel
creation, orphan monitors to consider deleting, leftover per-app SHM dashboards
to retire).

Include the app's 30-day uptime percentage (it can't live on the dashboard — no
uptime dataset exists for widgets). Get the monitor id from
`sentry api 'organizations/rolemodel-software/uptime/'`, then:

```
sentry api 'organizations/rolemodel-software/uptime-summary/?uptimeDetectorId=<id>&statsPeriod=30d'
```

uptime % = 1 − downtimeChecks/totalChecks. Link the monitor page next to the
dashboard link — it's the SHM uptime section's source of truth.
