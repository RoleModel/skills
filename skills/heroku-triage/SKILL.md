---
name: heroku-triage
description: >
  Diagnose and fix the Heroku production problems Sentry issues don't cover: memory
  errors (R14/R15), slow or timing-out requests (H12, high p95 latency), crash and boot
  loops, and cost/performance tuning of the formation (Puma workers/threads, dyno size
  and count, Postgres plan). Four modes: diagnose (incident triage), apply (confirm +
  apply a change, snapshot a baseline, open a Linear tracking issue), verify (compare
  metrics against the baseline after a soak period), review (periodic cost/performance
  audit). Use when the user says an app "is slow", "is getting R14s", "has memory
  errors", "keeps timing out", "tune puma", "right-size the dynos", "heroku cost
  review", "why is production slow", or "verify that tuning change". Sentry error
  triage belongs to sentry-top-issue / rm-sentry-issue-fixer; this skill covers what
  those don't.
license: MIT
---

# Heroku Triage

Production diagnosis and tuning for RoleModel's standard stack: Heroku + Papertrail +
Sentry, Rails on Puma. Requires the `heroku` CLI (authenticated), `jq`, the Sentry MCP,
and the Linear MCP (for apply/verify). Ask the user questions **one at a time**.

## Operating principles

1. **Aggregate outside the context window.** Never page raw production logs into the
   conversation. Fetch them to files under `/tmp/heroku-triage/<app>/` and reduce with
   `jq`/`awk`/`sort` — only counts, percentiles, and compact timelines enter context.
2. **Cheapest signal first.** Check the release timeline before log spelunking; check
   error-code counts before fetching log bodies. Most incidents correlate with a deploy
   or config change visible in `heroku releases` in ten seconds.
3. **Capture before you heal.** A restart erases the evidence (memory curves, stuck
   state). Snapshot logs and metrics before restarting or scaling anything.
4. **Two independent signals per conclusion.** Do not propose a fix from a single data
   point. A diagnosis must cite at least two of: log timeline, Heroku state, Sentry
   data, Postgres stats, code inspection.
5. **One change at a time.** Every mutation goes through apply mode: baseline → confirm
   → apply → Linear issue → verify after a soak. Never batch tuning changes; you can't
   attribute the result.

## Inputs ($ARGUMENTS)

Space-separated `key=value` tokens plus bare words, all optional except the app:

- `app=<heroku-app>` (or first bare word that isn't a mode) — required
- `mode=diagnose|apply|verify|review` (or bare word) — default `diagnose`
- `symptom=memory|latency|availability|unknown` — default `unknown`, diagnose only
- `window=<hours>` — analysis window, default 24 (review uses 168)
- `repo=<path>` — local checkout of the app, for code-level steps
- `team=<linear-team>` — Linear team for tracking issues
- `target-p95=<ms>` — latency target, default 500
- `dry-run` — never mutate anything; print what apply would do

## Preflight (all modes)

1. `heroku auth:whoami` and `heroku apps:info -a $APP` — stop with instructions if
   either fails.
2. Resolve the app repo: use `repo=`, else check whether the cwd's git remotes or
   `heroku git:remote` match the app. Code-level steps degrade gracefully without it
   (`heroku run cat <file> -a $APP` reads one file from the slug — uses a one-off dyno).
3. Papertrail history: the legacy `heroku config:get PAPERTRAIL_API_TOKEN` no longer
   works. Two ways in (signals.md §3), neither assumed — ask the user: (A) they create
   a Papertrail API token and export it so `scripts/papertrail-search.sh` can query the
   search API, or (B) they download logs for a date range you specify and hand you the
   file to parse locally. Without either, history is limited to `heroku logs` (~1,500
   lines) — say so and lower confidence accordingly.
4. `heroku labs -a $APP | grep log-runtime-metrics`. If disabled and the investigation
   needs memory/CPU data, this is the first proposed change (see signals.md §4 for the
   restart caveat). Memory diagnosis needs a few hours of samples after enabling.
5. Sentry MCP: find the project matching the app/repo name; ask if ambiguous.
6. Linear MCP (apply/verify): confirm it responds. If unavailable, apply mode prints
   the tracking-issue content for the user to file manually rather than skipping it.
7. **Secrets hygiene:** never run bare `heroku config -a $APP`. Read only whitelisted
   keys via `heroku config --json -a $APP | jq '{WEB_CONCURRENCY, RAILS_MAX_THREADS,
   MALLOC_ARENA_MAX, RUBY_YJIT_ENABLE, RAILS_ENV, RACK_ENV, WEB_TIMEOUT}'`.

## Mode: diagnose

Read `references/signals.md` (recipes) and `references/heuristics.md` (decision trees)
before starting.

1. **Census** — formation (`heroku ps`), last 20 releases, whitelisted config, dyno
   error-code counts for the window vs. the same window a week earlier (Papertrail
   counts only). Identify the dominant symptom code (R14/R15, H12, H10/R10…).
2. **Onset correlation** — find when the symptom started (bucketed counts per hour/day)
   and line it up against the release timeline. A matching release → `git log`/diff
   that release in the repo; the culprit is usually in it.
3. **Playbook** — follow the matching decision tree in heuristics.md: §1 memory,
   §2 latency, §3 availability. Gather only the signals the tree asks for.
4. **Diagnosis block** — end with a structured summary: symptom, root cause, confidence
   (high/medium/low), evidence (each item citing its source), proposed change (exact
   commands or PR sketch), expected effect, risk, revert plan. If confidence is low,
   say what additional data would raise it (often: enable instrumentation, wait, rerun).
5. Stop and present. If the user wants to proceed, continue into apply mode.

## Mode: apply

Requires a diagnosis (from this session, or restated by the user).

1. **Baseline first**: capture the metrics snapshot per `references/linear-issue.md`
   §Baseline — before touching anything.
2. Present the exact change: commands, expected effect, risk, revert commands, soak
   period and success criteria (from heuristics.md §7). **Wait for explicit
   confirmation.** `dry-run` stops here.
3. Apply via heroku CLI. Confirm it took (`heroku releases -n 3`, `heroku ps`), then
   smoke-check: `/up` returns 200, and 5 minutes of error-code tail shows no new codes.
4. Create the Linear tracking issue per linear-issue.md (title
   `[heroku-triage] <app>: <change>`, baseline JSON, criteria, earliest-verify time).
   Ask for the team once (`team=` skips this).
5. Tell the user when to run `verify` (e.g., "after Thursday's peak — 48h from now").

## Mode: verify

1. Find open `[heroku-triage] <app>` issues via Linear MCP. None → report and stop.
2. Parse the baseline JSON and criteria. If the soak period hasn't elapsed, say how
   long remains and stop (unless the user insists).
3. Recompute the same metrics over an equivalent window (match weekday/peak where the
   baseline did) and build a before/after table.
4. Verdict per the criteria (heuristics.md §7):
   - **KEEP** — criteria met: comment with the table, close the issue.
   - **ITERATE** — improved but short: comment, keep open, propose the next rung of
     the fix ladder (a fresh apply cycle).
   - **REVERT** — regression: confirm with the user, run the recorded revert commands,
     comment, restart the soak clock for the revert.

## Mode: review

The recurring cost/performance audit (default window 168h). Composable with the
`schedule` skill for automated runs, like sentry-top-issue.

1. Gather the 7-day dossier (signals.md): formation + monthly cost, steady/peak memory
   per process type, latency p50/p95/p99, throughput peaks, load averages, R14/H12
   census, Postgres health (cache hit, connections vs. limit), addon plans.
2. Score against the targets table (heuristics.md §6), adjusted by `target-p95=`.
3. Output ranked recommendations — each with: change, evidence, expected effect,
   monthly cost delta, risk, confidence. Include "no change" findings so the user sees
   what was checked. Flag anything within 20% of a limit as "watch".
4. Offer to run apply on the top recommendation — one change at a time.

## Guardrails

- Never run destructive commands: `apps:destroy`, `addons:destroy`, `pg:reset`,
  `pg:kill*`, `maintenance:on`, `config:unset DATABASE_URL`. `releases:rollback` and
  `ps:restart` are allowed **only** with explicit user confirmation, after evidence
  capture (§principle 3).
- Every mutation is confirm-first, has its revert commands recorded in Linear *before*
  it runs, and is one change at a time.
- Don't stack memory allocator experiments (MALLOC_ARENA_MAX and jemalloc) in one step.
- Static tables in heuristics.md (dyno RAM, prices, connection limits) are fallbacks —
  prefer live values from `heroku ps`, `pg:info`, and the pricing page; note when a
  recommendation depends on a price you couldn't verify.
- Rolling restarts / worker killers are mitigations, not fixes: if proposed, record a
  follow-up Linear issue naming the unresolved root cause.

## Reference map

- `references/signals.md` — every data-gathering recipe: heroku CLI census, Papertrail
  API (via `scripts/papertrail-search.sh`), log-runtime-metrics, Sentry MCP intents,
  Postgres, in-repo config. Read at the start of diagnose/review.
- `references/heuristics.md` — decision trees (memory §1, latency §2, availability §3),
  Puma sizing + connection math §4, formation economics §5, review targets §6,
  verification criteria and soak periods §7.
- `references/linear-issue.md` — tracking-issue template, baseline JSON schema, verify
  comment format. Read before apply/verify.
