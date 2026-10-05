#!/usr/bin/env bash
# Print the line ranges this change added, one "path:start-end" per line.
# Compares BASE to the working tree, so staged, unstaged, and untracked files all count.
# Usage: new_lines.sh <base-ref>
set -euo pipefail
base="${1:?usage: new_lines.sh <base-ref>}"

git diff -U0 --no-color --no-ext-diff "$base" -- | awk '
  /^\+\+\+ / { path = ($2 == "/dev/null") ? "" : substr($2, 3); next }
  /^@@ / && path != "" {
    split($3, added, ",")
    start = substr(added[1], 2)
    count = (2 in added) ? added[2] : 1
    if (count > 0) print path ":" start "-" (start + count - 1)
  }
'

git ls-files --others --exclude-standard | while IFS= read -r path; do
  lines=$(wc -l < "$path" | tr -d " ")
  [ "$lines" -gt 0 ] && echo "$path:1-$lines"
done
exit 0
