#!/usr/bin/env bash
# Print the line ranges this change added, one "path:start-end" per line.
# Compares BASE to the working tree, so staged, unstaged, and untracked files all count.
# Usage: new_lines.sh <base-ref>
set -euo pipefail
base="${1:?usage: new_lines.sh <base-ref>}"
cd "$(git rev-parse --show-toplevel)"

git -c core.quotePath=false diff -U0 --no-color --no-ext-diff --dst-prefix=b/ "$base" -- | awk '
  /^\+\+\+ / { line = $0; sub(/^\+\+\+ /, "", line); sub(/\t$/, "", line)
               path = (line == "/dev/null") ? "" : substr(line, 3); next }
  /^@@ / && path != "" {
    split($3, added, ",")
    start = substr(added[1], 2)
    count = (2 in added) ? added[2] : 1
    if (count > 0) print path ":" start "-" (start + count - 1)
  }
'

git ls-files --others --exclude-standard | while IFS= read -r path; do
  lines=$(grep -c '' "$path" || true)
  if [ "$lines" -gt 0 ]; then echo "$path:1-$lines"; fi
done
