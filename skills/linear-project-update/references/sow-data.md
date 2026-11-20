# SOW data for the budget & runway signal

Read this before step 1. Every mistake below fails silently: a hand-written query runs and returns believable numbers that are wrong, and agents writing one from scratch spent several calls guessing column names.

## Run the saved query

Run Almanac's saved Blazer query **"Project Update: SOW Burn and Runway by Craftsman"** (id 1079) with `blazer_run_query`. If the id doesn't resolve, find it by name with `blazer_search_query`. Pass:

- `craftsman_id`: the craftsman's Almanac person id, from `person.index` with a `name` `i_cont` filter.
- `window_start`, `window_end`: `YYYY-MM-DD`. In step 1, before the window is confirmed, use the earliest default window start across their projects and today. Run it again only if the craftsman picks a different window; it takes milliseconds.

It returns one row per billable external SOW the craftsman leads, active or ending inside the window.

- **Never `blazer_write_query`.** It adds a query to the shared Blazer library, which isn't yours to grow during a weekly update.
- **Never `billable_report`** for budget or burn. It reports per-person hours for a date range and knows nothing about SOWs.
- If the saved query is gone and Blazer is unavailable, turn the budget check into a question for the craftsman rather than rebuilding it by trial and error.

## What the columns already get right

- **Who leads a SOW:** `sows.craftsman_id`, falling back to the partner's craftsman (`craftsman_from_partner` says which). Most SOWs have no craftsman of their own; matching on `sows.craftsman_id` alone drops nearly all of them.
- **`spent`:** billable hours × `billable_rate` through `window_end` (the app's `LoggedTime.spent_budget`). `spent_in_window` is the same inside the window, which is what a cycle-scoped update should cite.
- **`pct_spent`:** null when `cost_budget` is null or 0, common on `iteration_based_pricing` SOWs. Report those as "no fixed budget", never as 0% or 100%.
- **`pct_timeline`:** days elapsed at `window_end` over `starts_on`..`ends_on`.
- **`has_later_active_sow`:** false means the partner has nothing signed past this SOW's `ends_on`. With `ends_on` approaching, that's the runway signal.

## Thresholds

≥80% spent is a warning and ≥100% is danger (`BudgetSpendingPresenter`). Use those instead of picking your own, so the update and the partner page never disagree. Don't project a finish-line overage from the current pace; report the numbers and ask.

## The one suppression

An overage on a SOW already past its `ends_on`, when its Linear project is also completed, is history, not a live risk, and it doesn't belong in scope. If that SOW is still marked active in Almanac, it's a data-hygiene note for the wrap-up ("SOW ended May 31 but still active — deactivate?").

The live case is the opposite, and it's exactly what the budget signal exists to catch: an ended or overspent SOW with work still continuing.
