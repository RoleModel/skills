#!/usr/bin/env bash
set -euo pipefail
# filter-candidates.sh — Drop Sentry issue IDs that already have an open GitHub PR
# or a closed GitHub PR within the last 30 days (indicating a prior failed attempt).
#
# Usage: filter-candidates.sh <id1> [<id2> ...]
# Output: surviving IDs, one per line. Empty output is valid (all filtered).
#
# Matches both `[SENTRY <suffix>]` (canonical space form) and `[SENTRY-<suffix>]`
# (legacy hyphen form) in PR titles, where <suffix> is everything after the
# first `-` in the issue ID (e.g. WIDGETS-1G → 1G). Bare alphanumeric IDs
# (no prefix) are used as-is.
#
# Degrades gracefully: if gh is missing or unauthenticated, prints a one-line
# warning to stderr and echoes all inputs unchanged, matching the skill's
# "never block on PR filter" contract.

if [[ $# -eq 0 ]]; then exit 0; fi

if ! command -v gh >/dev/null 2>&1; then
  echo "warn: gh not installed; skipping PR filter" >&2
  printf '%s\n' "$@"
  exit 0
fi

# Single API call: fetch all open PR titles once, then filter locally.
# --search '[SENTRY' narrows results to Sentry PRs so the 200-item limit is never a bottleneck.
if ! open_titles="$(gh pr list --state open --search '[SENTRY' --limit 200 --json title --jq '.[].title' 2>/dev/null)"; then
  echo "warn: gh pr list failed; skipping PR filter" >&2
  printf '%s\n' "$@"
  exit 0
fi

# Fetch recently closed PR titles (last 30 days) to catch prior failed attempts.
# Constrain the GitHub query by close date so the result limit applies only to
# relevant PRs, avoiding false negatives in busy repositories.
closed_titles=""
cutoff="$(date -u -v-30d '+%Y-%m-%d' 2>/dev/null \
  || date -u -d '30 days ago' '+%Y-%m-%d' 2>/dev/null \
  || echo '')"
if [[ -n "$cutoff" ]]; then
  if ! closed_titles="$(gh pr list --state closed --search "[SENTRY closed:>=$cutoff" --limit 200 --json title --jq '.[].title' 2>/dev/null)"; then
    echo "warn: gh pr list (closed) failed; skipping closed-PR filter" >&2
    closed_titles=""
  fi
else
  echo "warn: could not compute 30-day cutoff date; skipping closed-PR filter" >&2
fi

_pr_matches() {
  local titles="$1" suffix="$2"
  # Match both "[SENTRY 49]" (canonical space form) and "[SENTRY-49]" (hyphen form).
  grep -Fq -- "[SENTRY ${suffix}]" <<<"$titles" || grep -Fq -- "[SENTRY-${suffix}]" <<<"$titles"
}

for id in "$@"; do
  suffix="${id#*-}"   # strip through first `-`; bare IDs stay unchanged
  if _pr_matches "$open_titles" "$suffix"; then
    continue  # already has an open PR
  fi
  if [[ -n "$closed_titles" ]] && _pr_matches "$closed_titles" "$suffix"; then
    continue  # closed PR exists within last 30 days — prior failed attempt
  fi
  printf '%s\n' "$id"
done
