#!/usr/bin/env bash
set -euo pipefail
# fetch-issues.sh — Query Sentry REST API for unresolved issues, sorted by event frequency.
#
# Emits exactly one JSON object on stdout. Always exits 0.
#
# Inputs:
#   --org <slug>         Sentry organization slug (required)
#   --project <slug>     Sentry project slug (required)
#   --region <url>       Sentry region URL (default: https://sentry.io)
#   --env <name>         Environment filter (default: production)
#   --priority <tier>    Priority tier: high, medium, or low (omit for untiered)
#   --limit <n>          Max results (default: 10)
#
# Requires: SENTRY_AUTH_TOKEN env var, curl, jq
#
# Output schemas:
#   ok:    {"status":"ok","issues":[{"id","title","userCount","count","firstSeen","lastSeen"}, ...]}
#   error: {"status":"error","reason":"..."}

error_exit() {
  jq -cn --arg reason "$1" '{status:"error", reason:$reason}'
  exit 0
}

for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || error_exit "$cmd is not installed"
done

[[ -z "${SENTRY_AUTH_TOKEN:-}" ]] && error_exit "SENTRY_AUTH_TOKEN environment variable is not set"

ORG=""
PROJECT=""
REGION="https://sentry.io"
ENV_NAME="production"
PRIORITY=""
LIMIT=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    --org)      ORG="$2"; shift 2 ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --region)   REGION="$2"; shift 2 ;;
    --env)      ENV_NAME="$2"; shift 2 ;;
    --priority) PRIORITY="$2"; shift 2 ;;
    --limit)    LIMIT="$2"; shift 2 ;;
    *)          error_exit "unknown arg: $1" ;;
  esac
done

[[ -z "$ORG" ]]     && error_exit "--org is required"
[[ -z "$PROJECT" ]] && error_exit "--project is required"
[[ -z "$REGION" ]]  && REGION="https://sentry.io"

QUERY="is:unresolved lastSeen:-7d"
[[ -n "$PRIORITY" ]] && QUERY="$QUERY issue.priority:$PRIORITY"

BASE_URL="${REGION%/}"
API_URL="${BASE_URL}/api/0/projects/${ORG}/${PROJECT}/issues/"

HTTP_RESPONSE=$(curl -s -w '\n%{http_code}' \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -G "$API_URL" \
  --data-urlencode "query=${QUERY}" \
  --data-urlencode "environment=${ENV_NAME}" \
  --data-urlencode "sort=freq" \
  --data-urlencode "limit=${LIMIT}" \
  2>/dev/null) || error_exit "curl request failed"

HTTP_CODE=$(tail -n 1 <<< "$HTTP_RESPONSE")
BODY=$(sed '$d' <<< "$HTTP_RESPONSE")

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  DETAIL=$(jq -r '.detail // empty' <<< "$BODY" 2>/dev/null || true)
  [[ -z "$DETAIL" ]] && DETAIL="HTTP $HTTP_CODE"
  error_exit "Sentry API error ($HTTP_CODE): $DETAIL"
fi

ISSUES=$(jq '[.[:'"$LIMIT"'][] | {
  id: .shortId,
  title: .title,
  userCount: (.userCount // 0),
  count: ((.count // "0") | tonumber),
  firstSeen: .firstSeen,
  lastSeen: .lastSeen
}]' <<< "$BODY" 2>/dev/null) || error_exit "failed to parse Sentry API response"

jq -cn --argjson issues "$ISSUES" '{status:"ok", issues:$issues}'
