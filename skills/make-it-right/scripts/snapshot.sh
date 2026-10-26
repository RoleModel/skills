#!/usr/bin/env bash
# snapshot.sh: print a tree id for the working tree, untracked files included,
# without touching the real index, so the user's staging survives.
set -euo pipefail
idx=$(mktemp); trap 'rm -f "$idx"' EXIT
cp "$(git rev-parse --git-dir)/index" "$idx"
GIT_INDEX_FILE=$idx git add -A
GIT_INDEX_FILE=$idx git write-tree
