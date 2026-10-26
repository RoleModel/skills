#!/usr/bin/env bash
set -euo pipefail
# mine_review_comments.sh: pull human reviewer feedback from a repo's recent merged PRs.
#
# Fetches both inline (path/line) review comments and top-level review verdicts,
# drops bot accounts and the PR author's own replies, and emits one JSON object
# per remaining comment. Clustering that output into recurring themes is the
# caller's job. This script only fetches and filters.
#
# Usage:
#   mine_review_comments.sh [--repo owner/name] [--limit 100] [--exclude 'pattern|pattern']
#
#   --repo     Defaults to the current directory's repo (gh repo view).
#   --limit    Number of most-recently-merged PRs to scan. Default 100.
#   --exclude  Case-insensitive regex of reviewer logins to drop, in addition to
#              anything the GitHub API marks as a bot. Default covers common
#              review bots (CodeRabbit, Copilot, Sonar, Codecov, Renovate).
#
# Requires: gh, jq
#
# Output: NDJSON on stdout, one line per comment:
#   {"pr":123,"url":"...","reviewer":"login","path":"app/foo.rb"|null,"line":42|null,
#    "reply":false,"body":"..."}
# "reply" marks a comment answering another comment rather than opening a thread.
# Progress ("PR #123 (n/100)") goes to stderr so it doesn't pollute the NDJSON.
#
# Two paginated requests per PR, serially: ~200 calls at the default limit against
# an authenticated budget of 5000/hr. Large --limit values can trip GitHub's
# per-minute secondary limit. A failed request aborts the run instead of skipping the
# PR, since silent holes would skew the caller's counts. Lower --limit and retry.
#
# Exit codes: 0 success, 1 missing tool, 2 invalid args, 3 gh command failed

for cmd in gh jq; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required by mine_review_comments.sh" >&2; exit 1; }
done

REPO=""
LIMIT=100
EXCLUDE_LOGINS="bot|coderabbit|copilot|sonarcloud|codecov|renovate|greenkeeper|snyk"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)    REPO="$2"; shift 2 ;;
    --limit)   LIMIT="$2"; shift 2 ;;
    --exclude) EXCLUDE_LOGINS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$REPO" ]] && REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

PRS=$(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" --json number,url,author) \
  || { echo "failed to list merged PRs for $REPO" >&2; exit 3; }

TOTAL=$(jq 'length' <<< "$PRS")
echo "Scanning $TOTAL merged PRs on $REPO for human review comments..." >&2

# Fetch one endpoint for one PR. Aborts the run on failure, per the note above.
fetch() {
  local endpoint="$1" num="$2" out
  if ! out=$(gh api "repos/$REPO/pulls/$num/$endpoint" --paginate 2>&1); then
    echo "failed to fetch $endpoint for PR #$num:" >&2
    echo "$out" >&2
    echo "aborting: a partial corpus would skew the counts. Try a smaller --limit." >&2
    exit 3
  fi
  printf '%s' "$out"
}

I=0
while read -r pr; do
  I=$((I + 1))
  NUM=$(jq -r '.number' <<< "$pr")
  URL=$(jq -r '.url' <<< "$pr")
  PR_AUTHOR=$(jq -r '.author.login' <<< "$pr")
  echo "  PR #$NUM ($I/$TOTAL)" >&2

  fetch comments "$NUM" \
    | jq -c --arg pr "$NUM" --arg url "$URL" --arg prauthor "$PR_AUTHOR" --arg exclude "$EXCLUDE_LOGINS" '
        .[] | select(.user.type != "Bot")
            | select(.user.login != $prauthor)
            | select((.user.login | ascii_downcase | test($exclude)) | not)
            | select(.body | length > 0)
            | {pr: ($pr | tonumber), url: $url, reviewer: .user.login, path: .path, line: .line,
               reply: (.in_reply_to_id != null), body: .body}
      '

  fetch reviews "$NUM" \
    | jq -c --arg pr "$NUM" --arg url "$URL" --arg prauthor "$PR_AUTHOR" --arg exclude "$EXCLUDE_LOGINS" '
        .[] | select(.user.type != "Bot")
            | select(.user.login != $prauthor)
            | select((.user.login | ascii_downcase | test($exclude)) | not)
            | select(.body | length > 0)
            | {pr: ($pr | tonumber), url: $url, reviewer: .user.login, path: null, line: null,
               reply: false, body: .body}
      '
done < <(jq -c '.[]' <<< "$PRS")
