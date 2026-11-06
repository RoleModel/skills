#!/usr/bin/env bash
# Prints a PR's GitHub stack and base branch: {"stack": ..., "base": "..."}.
# Takes only a PR number, so the request is always a read.
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9]+$ ]]; then
  echo "usage: pr-stack.sh <PR number>" >&2
  exit 2
fi

exec gh api -X GET "repos/{owner}/{repo}/pulls/$1" --jq '{stack, base: .base.ref}'
