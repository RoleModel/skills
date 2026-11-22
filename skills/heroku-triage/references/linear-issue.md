# Linear tracking issue: template and baseline schema

The Linear issue is the durable memory between sessions: apply mode writes it, verify
mode (possibly days later, possibly a different developer's session) finds and settles
it. Everything verify needs must be in the issue — assume the applying session's
context is gone.

## Conventions

- **Title**: `[heroku-triage] <app>: <short change>` — e.g.
  `[heroku-triage] acme-production: set MALLOC_ARENA_MAX=2`.
  The `[heroku-triage]` prefix is how verify mode finds open work; never omit it.
- **Team**: use `team=` if given, else list teams via Linear MCP and ask the user once
  per session. Add the label `heroku-triage` if the team has one (create it if the
  user agrees; don't block on it).
- **One issue per applied change.** An ITERATE verdict adds a comment and later a new
  issue for the next rung — it does not grow the existing issue's scope.

## Issue body template

```markdown
## Symptom
<one paragraph: what was reported/observed, when it started>

## Diagnosis
<root cause statement + confidence (high/medium/low)>

**Evidence**
- <finding> (source: papertrail R14 hourly buckets, 7d)
- <finding> (source: heroku releases / sentry transaction p95 / pg:info …)

## Change applied
```bash
<exact commands, e.g. heroku config:set MALLOC_ARENA_MAX=2 -a acme-production>
```
Applied at: <ISO8601 UTC> (release v<NN>)

## Revert
```bash
<exact commands, e.g. heroku config:unset MALLOC_ARENA_MAX -a acme-production>
```

## Verification
- Earliest verify: <ISO8601 UTC — applied_at + soak from heuristics §7>
- Window to reproduce: <e.g. 48h including Thursday peak>
- Success criteria:
  - [ ] <criterion, e.g. R14/day = 0 (baseline: 37)>
  - [ ] <criterion, e.g. p95 within ±10% of 890ms>
- Run: `heroku-triage verify app=<app>`

## Baseline
```json
<baseline JSON — schema below>
```
```

## Baseline JSON schema (machine-read by verify mode)

Populate every field you measured for the diagnosis; `null` for unmeasured ones — but
each success criterion must have its baseline field populated. Windows in hours;
memory in MB; latency in ms.

```json
{
  "app": "acme-production",
  "captured_at": "2026-07-15T14:30:00Z",
  "window_hours": 48,
  "formation": { "web": { "size": "standard-1x", "count": 2 },
                 "worker": { "size": "basic", "count": 1 } },
  "config": { "WEB_CONCURRENCY": "2", "RAILS_MAX_THREADS": "5",
              "MALLOC_ARENA_MAX": null, "RUBY_YJIT_ENABLE": null },
  "memory": { "web_steady_mb": 480, "web_peak_mb": 545, "quota_mb": 512,
              "worker_steady_mb": 300, "r14_per_day": 37, "r15_per_day": 0 },
  "latency_ms": { "router_p50": 120, "router_p95": 890, "router_p99": 2100,
                  "app_p95": 610, "queue_gap_p95": 280, "h12_per_day": 4 },
  "throughput": { "peak_rpm": 260, "peak_window": "Thu 14:00-15:00 UTC" },
  "load_avg_1m_peak": 1.4,
  "pg": { "plan": "essential-0", "cache_hit": 0.993,
          "connections_peak": 14, "connection_limit": 20 },
  "cost_usd_month": 57,
  "change": {
    "summary": "set MALLOC_ARENA_MAX=2",
    "commands": ["heroku config:set MALLOC_ARENA_MAX=2 -a acme-production"],
    "revert":   ["heroku config:unset MALLOC_ARENA_MAX -a acme-production"],
    "applied_at": "2026-07-15T14:42:00Z",
    "ladder_rung": "memory-1",
    "next_rung_if_iterate": "memory-3 (jemalloc buildpack)"
  },
  "verify": {
    "earliest": "2026-07-17T14:42:00Z",
    "criteria": [
      { "metric": "memory.r14_per_day", "op": "==", "value": 0 },
      { "metric": "memory.web_steady_mb", "op": "<=", "value": 432 },
      { "metric": "latency_ms.router_p95", "op": "within_pct", "value": 10 }
    ]
  }
}
```

## Verify comment template

Post as a comment on the issue (then close it on KEEP):

```markdown
## Verification — <ISO8601 UTC> (<verdict: KEEP | ITERATE | REVERT>)

| Metric | Baseline | Now | Criterion | Result |
|---|---|---|---|---|
| R14/day | 37 | 0 | == 0 | ✅ |
| Steady memory (web) | 480MB | 395MB | ≤ 432MB | ✅ |
| Router p95 | 890ms | 855ms | ±10% | ✅ |

Windows compared: <baseline window> vs <verification window> (matched: Thu peak).

<KEEP: one-line conclusion.>
<ITERATE: what improved, what didn't, and the proposed next rung.>
<REVERT: which criterion regressed, confirmation that revert commands were run at
<time>, new soak deadline for confirming baseline restoration.>
```

State machine: open → KEEP (close) | ITERATE (stays open until superseded or resolved)
| REVERT (close after the revert-soak confirms baseline restored, with a final comment).
