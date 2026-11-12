# Heuristics: decision trees, sizing rules, verification criteria

Section numbers are referenced from SKILL.md and signals.md.

## 1. Memory playbook (R14/R15)

Start from the **shape of the memory curve** (signals §3, 10-min buckets, per dyno,
48h+). The shape is the discriminator; each row names its confirmation signal —
remember the two-signal rule.

| Curve shape | Likely cause | Confirm with | Fix (see ladder) |
|---|---|---|---|
| Steady climb over hours, resets on restart, R14s late in the cycle | Ruby heap growth: glibc malloc fragmentation (most common on Heroku) or a true leak | Fragmentation plateaus/slows near an asymptote; a true leak climbs unbounded into R15. Cheapest confirm: the ladder's step 1 *is* the experiment | Ladder step 1 → 3 |
| Sharp step(s) at repeatable times or after specific requests | Request-driven bloat: an endpoint loading a huge dataset (missing `find_each`, giant `includes`, file processing in-request, big export) | ±90s context fetch around each step (signals §3); Sentry transaction spans at those timestamps; router `bytes=` outliers | Fix the endpoint: stream/batch/paginate, or move to a background job |
| Already at 60–70%+ of quota at boot, before traffic | Too many Puma workers for the dyno, or boot-time bloat (heavy initializers, preloaded data) | Boot math: master + per-worker RSS × `WEB_CONCURRENCY` vs. quota; compare curve minutes after deploy vs. steady state | Reduce `WEB_CONCURRENCY` (mind capacity, §4) or audit initializers; bigger dyno last |
| Sawtooth of climbs ending in R15 kills every few hours | Runaway individual requests/jobs (unbounded query, huge upload/report) | Last requests before each kill (±90s fetch); H13s and job retries at kill times | Find and bound the runaway (limits, streaming, timeouts) |
| Worker dyno climbs; web flat | Job-driven: per-job allocations retained, or concurrency × per-job RSS exceeds quota | Correlate curve with job schedule; job runtimes in Sentry | Reduce job concurrency, split the heavy queue to its own dyno, batch differently |
| `memory_swap` high while RSS under quota | Same as R14 — quota counts swap; treat by shape as above | — | — |

When memory *and* latency problems co-occur, fix memory first: a swapping dyno is slow
at everything, and the latency signal is unreadable until swap stops.

**Fix ladder** (web memory; cheapest and most reversible first — one rung per apply):

1. `heroku config:set MALLOC_ARENA_MAX=2 -a $APP` — Heroku's own recommendation for
   glibc arena fragmentation. Free, instant, low risk; commonly cuts steady RSS
   10–30%. This doubles as the fragmentation diagnosis: if the curve flattens lower,
   fragmentation confirmed.
2. Right-size workers: `workers = floor((quota × 0.85 − master_RSS) / per_worker_RSS)`.
   If lower than current `WEB_CONCURRENCY`, reduce it — but check the capacity math
   (§4) and pair with a dyno-count/threads adjustment if throughput needs it.
3. jemalloc buildpack (`gaffneyc/heroku-buildpack-jemalloc`, needs a deploy) — the
   stronger allocator fix. Don't stack with step 1 in a single apply; measure one
   change at a time.
4. Hunt the bloat in code: Sentry profiles (hot allocators), fattest responses
   (router `bytes=`), heaviest transactions; locally `derailed bundle:mem` (gem cost at
   boot) and `derailed exec perf:mem_over_time`. Output is a PR, not a config change.
5. Bigger dyno (e.g. standard-1x → standard-2x). Legitimate when per-worker RSS is
   irreducible; state the monthly cost in the proposal.
6. Rolling restarts / `puma_worker_killer` — **mitigation, not fix** (guardrails):
   allowed to stop the bleeding, but files a follow-up Linear issue naming the
   unresolved root cause.

## 2. Latency playbook (H12, high p95)

**Discriminator 1 — queued or slow?** For the same window compute router `service=`
p95 vs. lograge `duration=` p95 (signals §3). Router time ≈ queueing + app time.

- **Gap ≫ 0 (router p95 − app p95 > ~100ms): requests queue at the dyno → capacity.**
  - CPU-bound? `sample#load_avg_1m` sustained ≥ ~1.0 on standard dynos (they're
    single-core-ish shared) → more dynos/workers, or YJIT if not enabled
    (`RUBY_YJIT_ENABLE=1`, Ruby 3.3+ — small memory cost, real CPU win).
  - CPU idle but queueing → threads blocked on I/O: check DB pool waits (Papertrail:
    `"could not obtain a connection"`), slow external calls holding threads. Raise
    threads modestly (3 → 5) only with this evidence, and re-check connection math §4.
  - Utilization math (Little's law): `concurrent demand ≈ peak_rps × avg_service_s`;
    `capacity = dynos × workers × threads`. Sustained demand/capacity > ~0.7 → add
    capacity (another dyno) or reduce service time.
  - Spiky traffic (short queueing bursts, quiet otherwise) → mention Judoscale
    (queue-time-based autoscaling) as the structural fix instead of permanent
    overprovisioning.
- **Gap ≈ 0: the app itself is slow → route by Sentry span breakdown** (signals §5):
  - **db-dominant** → `pg:outliers` + Sentry N+1/slow-query issues + `pg:diagnose`
    (missing/unused indexes, bloat). Single endpoint → fix its query (PR). Global +
    cache hit < 0.99 → working set outgrew the Postgres plan (§5 economics).
  - **http.client-dominant** → an external API: add/lower timeouts, move to a job,
    circuit-break. The fix is a PR.
  - **app/CPU-dominant** → Sentry profile hotspots; YJIT; memoize/cache the hotspot.
- **H12 pattern shortcuts** (path distribution, signals §3):
  - One path dominates → that endpoint (usually a report/export/upload) → background
    job + polling or Turbo stream; never a bigger timeout.
  - Clustered right after deploys/restarts → boot storm: confirm `preload_app!` in
    puma.rb, check boot duration in logs ("Listening on" minus start), H19/R10 nearby.
  - Spread across paths at peak → saturation → capacity branch above.
- **Rack::Timeout note**: a service timeout of 15–25s (< the router's 30s) converts
  opaque H12s into in-app exceptions with Sentry traces. Recommend when H12 cause is
  unclear; flag that it must be an intentional, tested addition (mid-request raises
  have sharp edges), and it never substitutes for fixing the slow path.

## 3. Availability playbook (H10 / R10 / crash loops)

1. `heroku ps` — crashed/restarting dynos and their ages; `heroku releases -n 5` — did
   it start with a release?
2. Boot exception: `heroku logs --dyno web --num 300` → the stack trace is almost
   always right there. Release-correlated → propose `heroku releases:rollback`
   (confirm-first) while the fix is developed; otherwise fix forward.
3. R10 (60s boot timeout): slow boot — measure "Listening on" delta; usual suspects
   are heavy initializers, remote calls at boot, or migrations run in-process instead
   of the release phase.
4. One dyno crashing while siblings are healthy → almost always R15 kills (memory
   playbook), not code.

## 4. Puma sizing and connection math

- **Threads**: 3 (Rails 7.2+ default) to 5. More than 5 rarely helps a Rails app —
  GVL contention and DB pool pressure eat the gains. Raise only on I/O-wait evidence
  (§2); lower toward 3 when CPU-bound or memory-tight.
- **Workers (`WEB_CONCURRENCY`)**: as many as fit `steady_total ≤ 85% of quota`
  (ladder step 2 formula). On shared-CPU dynos (basic/standard) load_avg is the
  ceiling check, not core counts. Always `preload_app!` (copy-on-write).
- **DB pool**: Rails defaults `pool = RAILS_MAX_THREADS` — correct; don't hand-tune
  pool per-app without cause.
- **Connection ceiling** (the classic Heroku trap):
  `total ≈ web_dynos × workers × threads + worker_dynos × job_threads (+ ~2 for
  console/one-offs)`. Keep under ~80% of the `pg:info` connection limit. Essential
  plans allow only ~20 — e.g. 2 web dynos × 2 workers × 5 threads = 20 = saturated
  before the worker dyno connects. Fixes in order: lower threads, upgrade the
  Postgres plan, pgbouncer buildpack (transaction pooling; check
  prepared-statement compatibility).
- **Worker dynos**: job concurrency counts against both memory (per-thread job RSS)
  and connections (GoodJob threads each hold one).

## 5. Formation economics

Fallback table (confirm live: `heroku ps` for current, Heroku pricing page for rates —
flag any recommendation whose price you couldn't verify):

| Dyno | RAM | ~$/mo | Notes |
|---|---|---|---|
| eco | 512MB | 5 (pool) | sleeps; never for client production |
| basic | 512MB | 7 | no autoscaling, 1 dyno per process type honest floor |
| standard-1x | 512MB | 25 | shared CPU |
| standard-2x | 1GB | 50 | shared CPU, 2× share |
| performance-m | 2.5GB | 250 | dedicated CPU |
| performance-l | 14GB | 500 | dedicated, big memory |

Rules of thumb:
- **2× standard-1x vs 1× standard-2x (same $50)**: prefer two 1x for redundancy and
  zero-downtime restarts — *unless* per-worker RSS forces the 1GB quota.
- Performance tier: justified when ~4–5 standard-2x can't hold p95 (CPU-bound) or a
  single process legitimately needs >1GB. Below that, scale standard horizontally.
- **Downsize candidates** (review mode): steady memory < 50% of quota for 14 days AND
  p95 well under target AND queue gap ≈ 0 → step down one rung (size or count, not
  both), verify per §7.
- **Postgres plan**: upgrade triggers are the connection ceiling (§4), cache hit
  < 0.99, or data size > ~75% of plan limit (`pg:info`). Essential tiers also lack
  diagnostics and followers — growing apps outgrow them operationally, not just on
  size.
- **Papertrail plan**: check usage vs. plan in the Papertrail account (API:
  `/api/v1/accounts.json`, needs the user-created API token — signals.md §3 Option A);
  chronic overage or truncated retention → one plan up is
  usually cheap insurance for exactly the debugging this skill does.
- **Scheduler vs. always-on worker**: a worker dyno that's idle outside a few
  scheduled jobs can often become Heroku Scheduler one-off runs (pay per second).

## 6. Review-mode targets (defaults; override via args, e.g. `target-p95=`)

| Signal | Healthy | Watch | Act |
|---|---|---|---|
| Steady memory / quota | 60–85% | 50–60% or 85–95% | <50% (downsize) / >95% or any R14 (memory playbook) |
| R14 or R15 in window | 0 | — | any |
| p95 latency | < target (default 500ms) | within 20% | above |
| H12 in window | 0 | — | any |
| Queue gap p95 (router − app) | < 50ms | 50–100ms | > 100ms (capacity) |
| load_avg_1m sustained | < 0.7 | 0.7–1.0 | > 1.0 (standard dynos) |
| PG cache hit | ≥ 0.99 | 0.985–0.99 | < 0.985 |
| PG connections peak / limit | < 60% | 60–80% | > 80% |
| Monthly cost | — | — | any Act/downsize finding → quantify $ delta |

Score every process type and the database; report "healthy" rows too (the value of a
review is knowing what was checked). Weekend-vs-weekday and seasonal peaks: compare
like windows before declaring headroom.

## 7. Verification criteria and soak periods (verify mode)

General: match the baseline's window shape (same weekday/peak coverage). "±10%" means
relative to baseline, not target.

| Change type | Soak | Success criteria |
|---|---|---|
| MALLOC_ARENA_MAX / jemalloc | 48h | R14/day → 0 (or ≥90% drop); steady memory down ≥10%; p95 within ±10% |
| WEB_CONCURRENCY reduced | 48h incl. a weekday peak | zero R14; queue gap p95 < 50ms; p95 ±10%; throughput unchanged |
| Threads changed | 48h | as above, plus zero pool-timeout log lines and PG connections < 80% limit |
| Dyno size/count reduced | 72h incl. peak | p95 ±10%; zero new H12; load_avg within Healthy; memory < 85% |
| Dyno size/count increased (incident) | 24h | symptom gone (R14/H12 = 0); note follow-up: revisit cost in next review |
| Query/index fix (PR) | 24h post-deploy | target endpoint p95 improved by the amount predicted in the diagnosis |
| Job concurrency / queue split | 48h | worker memory < 85%; queue latency (oldest-job age) within target; zero R14 |

Verdicts:
- **KEEP**: all criteria met → close the Linear issue with the before/after table.
- **ITERATE**: direction right, magnitude short → keep the issue open, propose the
  next ladder rung as a fresh apply (new baseline = current state).
- **REVERT**: any criterion regressed beyond its bound → confirm, run the recorded
  revert, restart the soak clock to confirm the revert restored baseline.
