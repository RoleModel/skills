#!/usr/bin/env bash
# Paginated Papertrail events search for a Heroku app.
#
# Emits TSV (received_at, source_name, program, message), oldest-first, deduped,
# to --out FILE (or stdout). Progress and totals go to stderr.
#
# Requires: curl, jq, and PAPERTRAIL_API_TOKEN exported.
#
# The token is a Papertrail *API* token, created by the user in Papertrail
# (Settings -> Profile -> "API token"). The old PAPERTRAIL_API_TOKEN Heroku
# config var is legacy and no longer grants API access — do not use it.
#
# Usage:
#   PAPERTRAIL_API_TOKEN=<token> \
#   papertrail-search.sh --app <heroku-app> --query '<papertrail query>' \
#     --from <epoch-seconds> [--to <epoch-seconds>] [--max-events N] [--out FILE]
#
# Epoch helpers: macOS `date -v-24H +%s`, Linux `date -d '24 hours ago' +%s`.
set -euo pipefail

APP="" QUERY="" FROM="" TO="" MAX_EVENTS=50000 OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app)        APP=$2; shift 2 ;;
    --query)      QUERY=$2; shift 2 ;;
    --from)       FROM=$2; shift 2 ;;
    --to)         TO=$2; shift 2 ;;
    --max-events) MAX_EVENTS=$2; shift 2 ;;
    --out)        OUT=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$APP" ] || [ -z "$QUERY" ] || [ -z "$FROM" ]; then
  sed -n '2,13p' "$0" >&2; exit 2
fi
case "$FROM" in ''|*[!0-9]*) echo "--from must be epoch seconds" >&2; exit 2 ;; esac
TO=${TO:-$(date +%s)}
case "$TO" in ''|*[!0-9]*) echo "--to must be epoch seconds" >&2; exit 2 ;; esac

TOKEN=${PAPERTRAIL_API_TOKEN:-}
if [ -z "$TOKEN" ]; then
  echo "PAPERTRAIL_API_TOKEN not set. Create a Papertrail API token in the Papertrail" >&2
  echo "UI (Settings -> Profile -> API token) and export it before running this script." >&2
  echo "The heroku PAPERTRAIL_API_TOKEN config var is legacy and does not work here." >&2
  exit 3
fi

ENC_Q=$(jq -rn --arg q "$QUERY" '$q|@uri')
TMP=$(mktemp) HDRS=$(mktemp)
trap 'rm -f "$TMP" "$HDRS"' EXIT

BASE="https://papertrailapp.com/api/v1/events/search.json"
MAX_ID="" FETCHED=0 PAGES=0 RETRIES=0

while :; do
  URL="$BASE?q=$ENC_Q&min_time=$FROM&max_time=$TO&limit=1000&tail=false"
  [ -n "$MAX_ID" ] && URL="$URL&max_id=$MAX_ID"

  HTTP_CODE=$(curl -sS -o "$TMP.page" -D "$HDRS" -w '%{http_code}' \
    -H "X-Papertrail-Token: $TOKEN" "$URL")

  if [ "$HTTP_CODE" = "429" ]; then
    RETRIES=$((RETRIES + 1))
    [ $RETRIES -gt 5 ] && { echo "rate-limited 5 times in a row; giving up" >&2; exit 4; }
    WAIT=$(awk -F': *' 'tolower($1)=="retry-after" {print int($2)}' "$HDRS")
    sleep "${WAIT:-5}"
    continue
  fi
  RETRIES=0
  if [ "$HTTP_CODE" != "200" ]; then
    echo "papertrail API returned HTTP $HTTP_CODE: $(head -c 300 "$TMP.page")" >&2
    exit 4
  fi

  N=$(jq '.events | length' "$TMP.page" 2>/dev/null) || {
    echo "unparseable response: $(head -c 300 "$TMP.page")" >&2; exit 4; }
  jq -r '.events[] | [(.id|tostring), .received_at, .source_name, (.program // ""), .message] | @tsv' \
    "$TMP.page" >> "$TMP"

  FETCHED=$((FETCHED + N)) PAGES=$((PAGES + 1))
  printf '\rpage %d, %d events' "$PAGES" "$FETCHED" >&2

  REACHED=$(jq -r '.reached_beginning // false' "$TMP.page")
  MIN_ID=$(jq -r '.min_id // empty' "$TMP.page")
  if [ "$REACHED" = "true" ] || [ -z "$MIN_ID" ] || [ "$N" -eq 0 ]; then
    break
  fi
  if [ "$FETCHED" -ge "$MAX_EVENTS" ]; then
    printf '\nhit --max-events cap (%d) — window not fully covered; narrow --from/--to\n' \
      "$MAX_EVENTS" >&2
    break
  fi
  MAX_ID="$MIN_ID"
  sleep 0.3
done
rm -f "$TMP.page"
printf '\nfetched %d events in %d pages\n' "$FETCHED" "$PAGES" >&2

# Dedupe on id (page boundaries can overlap), oldest-first, then drop the id column.
if [ -n "$OUT" ]; then
  sort -t "$(printf '\t')" -k1,1n -u "$TMP" | cut -f2- > "$OUT"
  echo "wrote $(wc -l < "$OUT" | tr -d ' ') lines to $OUT" >&2
else
  sort -t "$(printf '\t')" -k1,1n -u "$TMP" | cut -f2-
fi
