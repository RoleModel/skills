# Signals: data-gathering recipes

Working convention: raw data goes to `/tmp/heroku-triage/<app>/` (create it once per
session: `mkdir -p /tmp/heroku-triage/$APP`). Only aggregates enter the conversation.
All recipes assume `APP=<heroku-app>` is set. `date` invocations show the macOS form;
on Linux use `date -d '24 hours ago' +%s` instead of `date -v-24H +%s`.

## 1. State census (cheap — always run first)

```bash
heroku ps -a $APP                      # formation, sizes, dyno uptimes (short uptimes = restart loop)
heroku releases -a $APP -n 20          # deploys AND config changes, timestamped — the onset suspect list
heroku addons -a $APP                  # postgres plan, papertrail plan
heroku buildpacks -a $APP              # jemalloc present? metrics buildpack?
heroku labs -a $APP                    # log-runtime-metrics enabled?
heroku config --json -a $APP | jq '{WEB_CONCURRENCY, RAILS_MAX_THREADS, MALLOC_ARENA_MAX, RUBY_YJIT_ENABLE, WEB_TIMEOUT}'
```

Interpretation notes:
- `heroku ps` uptime resets on restart — a dyno hours younger than its siblings
  restarted (R15 kill, crash, or manual).
- `heroku releases` includes `config:set` entries — a tuning change someone made by
  hand shows up here. Always line incident onset up against this list.

## 2. Error-code census (recent window, no Papertrail needed)

```bash
heroku logs -a $APP --num 1500 > /tmp/heroku-triage/$APP/recent.log
grep -oE 'code=(H|R|L)[0-9]+' /tmp/heroku-triage/$APP/recent.log | sort | uniq -c | sort -rn
```

| Code | Meaning | First move |
|------|---------|-----------|
| R14 | Memory quota exceeded (swapping) | Memory playbook (heuristics §1) |
| R15 | Quota vastly exceeded — dyno SIGKILLed | Memory playbook; check for runaway request/job |
| H12 | Request exceeded 30s router timeout | Latency playbook (heuristics §2) |
| H13 | Connection closed without response | Often a worker killed mid-request (pairs with R15) |
| H10 | App crashed | Availability playbook (heuristics §3) |
| R10 | Boot timeout (no bind to $PORT in 60s) | Availability playbook |
| H19 | Backend connection timeout (dyno didn't accept in 5s) | Boot storm / saturation |
| H21 | Backend connection refused | Dyno restarting under load |
| H27/H28 | Client interrupted / idle | Usually benign; ignore unless dominant |

`heroku logs` holds ~1,500 lines — minutes on a busy app. It answers "what's happening
right now"; every historical question goes to Papertrail.

## 3. Papertrail (history — the agent's primary time-series source)

Papertrail holds the log history. **The old `heroku config:get PAPERTRAIL_API_TOKEN`
config var is legacy and no longer grants access** — don't rely on it. There are two
ways to get history into the agent's hands; pick whichever fits the situation, and
neither should be assumed available without asking the user:

**Option A — user creates a Papertrail API token.** Ask the user to create an API
token for this project in Papertrail (Settings → Profile → "API token"), then export
it so the bundled script can query the search API directly. This unlocks the full
recipe cookbook below (narrow-window fetches, hourly buckets, percentiles):

```bash
export PAPERTRAIL_API_TOKEN=<token the user created>
bash skills/heroku-triage/scripts/papertrail-search.sh \
  --app $APP --query '"Error R14"' \
  --from $(date -v-7d +%s) --out /tmp/heroku-triage/$APP/r14.tsv
```

**Option B — user downloads logs for a date range.** If the user would rather not
create a token, ask them for the specific time window that matters (e.g. the incident
hour, plus the same hour a day earlier as a control), have them download those logs
from the Papertrail UI, and hand you the file. Parse it locally with the same
grep/awk/`cut` recipes below — they operate on TSV/plaintext regardless of how it was
obtained. Give the user a *narrow, purposeful* window rather than "all of it": a few
targeted hours answers the question and keeps the download small.

Either way the bundled script emits (or the download should be reduced to) TSV
(`received_at`, `source`, `program`, `message`) oldest-first before the recipes run.

**Sampling strategy — do not fetch the firehose.** Router lines on a busy app run to
millions per week. Instead fetch narrow windows and compare: the incident hour, the
same hour yesterday (control), and the weekly peak hour. `--max-events` defaults to
50,000; if the script reports hitting the cap, narrow the window rather than raising it.

Query cookbook (Papertrail full-text; quote exact phrases, filter precisely with
grep/awk afterwards):

```bash
# R14/R15 timeline → hourly buckets: which days, what cadence, which dynos?
scripts/papertrail-search.sh --app $APP --query '"Error R1"' --from $(date -v-7d +%s) --out r1x.tsv
cut -f1 r1x.tsv | cut -c1-13 | sort | uniq -c                    # events per hour
grep -oE 'web\.[0-9]+|worker\.[0-9]+' r1x.tsv | sort | uniq -c   # which process/dyno

# Memory curve for one dyno (needs log-runtime-metrics, §4) → 10-min buckets, max MB
scripts/papertrail-search.sh --app $APP --query '"sample#memory_total" "source=web.1"' \
  --from $(date -v-48H +%s) --out mem.tsv
awk -F'\t' '{ if (split($0, a, "memory_total=") < 2) next; split(a[2], b, "MB");
  ts = substr($1, 1, 15); if (b[1]+0 > mx[ts]) mx[ts] = b[1]+0 }
  END { for (t in mx) printf "%s0  %d MB\n", t, mx[t] }' mem.tsv | sort
# Read the SHAPE of this curve against heuristics §1. Repeat for web.2, worker.1.

# Router latency percentiles for a one-hour window (status/service from heroku router lines)
scripts/papertrail-search.sh --app $APP --query '"heroku/router" "service="' \
  --from <epoch> --to <epoch+3600> --out router.tsv
grep -oE 'service=[0-9]+' router.tsv | cut -d= -f2 | sort -n | \
  awk '{ v[NR] = $1 } END { if (!NR) exit;
    printf "n=%d p50=%d p95=%d p99=%d max=%d\n", NR, v[int(NR*.5)], v[int(NR*.95)], v[int(NR*.99)], v[NR] }'

# App-reported duration for the SAME window (lograge lines) — the queue-time discriminator
scripts/papertrail-search.sh --app $APP --query '"duration="' --from <epoch> --to <epoch+3600> --out app.tsv
grep -oE 'duration=[0-9.]+' app.tsv | cut -d= -f2 | sort -n | \
  awk '{ v[NR] = $1 } END { if (!NR) exit;
    printf "n=%d p50=%.0f p95=%.0f p99=%.0f\n", NR, v[int(NR*.5)], v[int(NR*.95)], v[int(NR*.99)] }'

# H12 path distribution — one bad endpoint or everything?
grep 'H12' router-or-r1x.tsv | grep -oE 'path="[^"]*"' | sed 's/?.*/"/' | sort | uniq -c | sort -rn | head

# What ran just before a memory step / R15? (±90s around a timestamp, all sources)
scripts/papertrail-search.sh --app $APP --query 'web.2' --from <step_epoch-90> --to <step_epoch+90> --out ctx.tsv
```

Searchable retention on small Papertrail plans is about a week; older history lives in
archives. With the user-created API token (Option A) exported as `$PAPERTRAIL_API_TOKEN`:
`curl -sH "X-Papertrail-Token: $PAPERTRAIL_API_TOKEN"
https://papertrailapp.com/api/v1/archives.json` lists daily `.tsv.gz` files with
download URLs — `zgrep`/`awk` them locally, never into context. (Under Option B, ask
the user to pull the relevant archive day from the Papertrail UI instead.)

## 4. log-runtime-metrics (the machine-readable memory/CPU source)

`heroku labs:enable log-runtime-metrics -a $APP` emits, per dyno every ~20s:
`sample#memory_total`, `memory_rss`, `memory_swap`, `memory_quota`,
`sample#load_avg_1m/5m/15m` — into the log stream, hence into Papertrail history.

Caveats:
- Takes effect on the **next restart**, and a restart resets the memory curve you may
  be investigating. If a leak is live right now: capture `heroku logs` and current
  `heroku ps` evidence first, then enable + restart, then diagnose from the fresh curve
  after a few hours of accumulation.
- Enabling is a mutation: confirm-first, though it's routine and zero-risk to traffic.
- The Heroku Metrics **dashboard** (and its language metrics via the `heroku/metrics`
  buildpack + `barnes`) is human-only — there is no supported API. For agent work,
  log-runtime-metrics via Papertrail is the source of truth. If the dashboard is
  needed as a cross-check, ask the user to read specific charts aloud.

## 5. Sentry MCP (app-level truth)

Resolve the project once (find_projects, match on repo/app name). Useful intents:

- **Slowest transactions**: p95 duration by transaction for the window, sorted desc;
  compare against the prior week for regressions. Also throughput per transaction —
  a slow+hot endpoint outranks a slow+cold one.
- **Span breakdown** for the worst transactions: is time in `db`, `http.client`, or
  app code? This routes the latency playbook (heuristics §2).
- **Performance issues**: Sentry auto-detects N+1 queries, slow DB queries,
  consecutive DB queries, large render blocking — list unresolved ones.
- **Profiles** (apps ship `stackprof`): top functions by self-time for CPU-bound
  hypotheses.
- **Release correlation**: error/latency deltas around the release identified in the
  census.
- **Memory adjacency**: R15 kills surface as H13s and job retries, not memory events —
  check for `SIGKILL`/`Errno` error spikes and job-retry bursts at R14/R15 timestamps.

## 6. Postgres

```bash
heroku pg:info -a $APP        # plan, connection limit + current, cache hit, data size vs plan
heroku pg:diagnose -a $APP    # red/yellow report: hit rate, bloat, blocking, long queries, unused indexes
heroku pg:outliers -a $APP    # top queries by total time (pg_stat_statements)
heroku pg:locks -a $APP       # only during an active incident
```

- Cache hit rate belongs ≥ 0.99; below that = working set exceeds RAM → plan upsize or
  bloat/missing-index work (pg:diagnose says which).
- On Essential-tier databases some diagnostics (e.g. pg:outliers) are unavailable —
  fall back to Sentry slow-query spans.
- Connection math lives in heuristics §4; the limit comes from `pg:info`, live.

## 7. In-repo reads (needs the app checkout, or `heroku run cat <path> -a $APP`)

- `config/puma.rb` — threads default, `workers ENV["WEB_CONCURRENCY"]` handling,
  `preload_app!` present?
- `Procfile` — worker process? what runs it (sidekiq/good_job)?
- `config/database.yml` — `pool:` (default `RAILS_MAX_THREADS`)
- Job concurrency: `config/sidekiq.yml` concurrency, or GoodJob
  `GOOD_JOB_MAX_THREADS` / `config.good_job` settings
- `Gemfile` — rack-timeout? puma_worker_killer (a mitigation smell — see guardrails)?
- Recent deploy diff when onset matches a release: `git log --oneline vN-date..vM-date`,
  diff the suspects.

## 8. Optional deeper signal: Puma pool stats (deploy required — deep tuning only)

When thread-pool saturation must be measured directly (heuristics §2 capacity path,
low confidence from the router-vs-app gap alone), offer this snippet as a PR to the
app — logs busy/backlog per worker every 30s, readable via the Papertrail recipes:

```ruby
# config/initializers/puma_stats.rb
return unless defined?(Puma) && Rails.env.production?
Thread.new do
  loop do
    sleep 30
    s = Puma.stats_hash rescue next
    workers = s[:worker_status]&.map { |w| w[:last_status] } || [s]
    busy = workers.sum { |w| w[:busy_threads].to_i }
    backlog = workers.sum { |w| w[:backlog].to_i }
    Rails.logger.info("puma_stats busy=#{busy} backlog=#{backlog} max=#{workers.sum { |w| w[:max_threads].to_i }}")
  end
end
```

Any sustained `backlog > 0` means requests queued behind the thread pool — capacity or
a blocking-I/O problem, per heuristics §2.
