#!/usr/bin/env bash
set -euo pipefail
# make-branch-names.sh — Produce validated branch / commit names for a Sentry fix.
#
# Required: --issue-id <ID>       (e.g. "PROJECT-123", "WIDGETS-1G", or "1G")
#           --description <text>  (imperative short description)
# Optional: --permalink <url>     (added to commit body when provided)
#           --linear-branch <name> (override generated branch with Linear's branch name)
#           --linear-id <ID>      (e.g. "ENG-123"; added to commit body when provided)
#
# Output: JSON with {branch, commitSubject, commitBody}.
# Exit codes: 0 success, 2 invalid args, 3 subject failed /^\[SENTRY [A-Za-z0-9]+\] .+/.

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required by make-branch-names.sh — install jq (e.g. 'brew install jq' or 'apt install jq') and re-run" >&2
  exit 2
fi

ISSUE_ID=""
DESCRIPTION=""
PERMALINK=""
LINEAR_BRANCH=""
LINEAR_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)       ISSUE_ID="$2"; shift 2 ;;
    --description)    DESCRIPTION="$2"; shift 2 ;;
    --permalink)      PERMALINK="$2"; shift 2 ;;
    --linear-branch)  LINEAR_BRANCH="$2"; shift 2 ;;
    --linear-id)      LINEAR_ID="$2"; shift 2 ;;
    *)                echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$ISSUE_ID"    ]] && { echo "--issue-id required" >&2; exit 2; }
[[ -z "$DESCRIPTION" ]] && { echo "--description required" >&2; exit 2; }
[[ "$DESCRIPTION" == *$'\n'* || "$DESCRIPTION" == *$'\r'* ]] && {
  echo "--description must be a single line" >&2
  exit 2
}
DESCRIPTION="$(printf '%s' "$DESCRIPTION" | LC_ALL=C sed -E 's/^[[:blank:]]+//; s/[[:blank:]]+$//')"
[[ -z "$DESCRIPTION" ]] && { echo "--description required" >&2; exit 2; }
[[ "$DESCRIPTION" == *$'\n'* || "$DESCRIPTION" == *$'\r'* ]] && {
  echo "--description must be a single line (no CR/LF)" >&2
  exit 2
}
DESCRIPTION="$(printf '%s' "$DESCRIPTION" | LC_ALL=C sed -E 's/^[[:blank:]]+//; s/[[:blank:]]+$//')"
[[ -z "$DESCRIPTION" ]] && { echo "--description required" >&2; exit 2; }

if [[ "$ISSUE_ID" =~ ^([A-Za-z0-9]+)-([A-Za-z0-9]+)$ ]]; then
  PROJECT="${BASH_REMATCH[1]}"
  SUFFIX="${BASH_REMATCH[2]}"
elif [[ "$ISSUE_ID" =~ ^[A-Za-z0-9]+$ ]]; then
  PROJECT=""
  SUFFIX="$ISSUE_ID"
else
  echo "invalid --issue-id: expected 'PROJECT-ABC123' or alphanumeric" >&2
  exit 2
fi

SLUG="$(printf '%s' "$DESCRIPTION" \
  | LC_ALL=C tr '[:upper:]' '[:lower:]' \
  | LC_ALL=C sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
  | cut -c1-60)"

[[ -z "$SLUG" ]] && { echo "description produced empty slug" >&2; exit 2; }

if [[ -n "$LINEAR_BRANCH" && "$LINEAR_BRANCH" != "null" ]]; then
  BRANCH="$LINEAR_BRANCH"
else
  BRANCH="sentry-$(printf '%s' "$SUFFIX" | LC_ALL=C tr '[:upper:]' '[:lower:]')-${SLUG}"
fi
SUBJECT="[SENTRY ${SUFFIX}] ${DESCRIPTION}"

if [[ ! "$SUBJECT" =~ ^\[SENTRY\ [A-Za-z0-9]+\]\ .+ ]]; then
  echo "subject failed /^\\[SENTRY [A-Za-z0-9]+\\] .+/ validation" >&2
  exit 3
fi

BODY="$SUBJECT"

# Sentry auto-resolves issues on release when the commit body contains
# "Fixes PROJECT-SHORTID" (canonical short-ID form). Only emit when the caller
# provided the full ID; callers who pass just the suffix get no trailer.
if [[ -n "$PROJECT" ]]; then
  BODY="$(printf '%s\n\nFixes %s-%s' "$BODY" "$PROJECT" "$SUFFIX")"
fi

if [[ -n "$PERMALINK" ]]; then
  BODY="$(printf '%s\n\nSentry: %s' "$BODY" "$PERMALINK")"
fi

if [[ -n "$LINEAR_ID" && "$LINEAR_ID" != "null" ]]; then
  BODY="$(printf '%s\n\nLinear: %s' "$BODY" "$LINEAR_ID")"
fi

jq -cn \
  --arg branch "$BRANCH" \
  --arg subject "$SUBJECT" \
  --arg body "$BODY" \
  '{branch:$branch, commitSubject:$subject, commitBody:$body}'
