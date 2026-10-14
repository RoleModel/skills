# Gathering the diff to review

Recipes for turning whatever the user hands you into the arguments for
`build-review.cjs`. Adapt them to the tools that are actually there: check
`gh auth status` before relying on GitHub, and use a Linear MCP only if one is
connected. The goal for every input type is the same three things:

1. **The diff**: a commit-ish, a range, or `--pr`.
2. **The PR, if there is one**: pass `--pr` so comments can be posted. If there
   isn't one, the review still works, it just stays local.
3. **The intent**: the PR body, ticket, or commit message. You need it to group
   files by relevance and to decide what is "unrelated" enough to auto-review.

Always try to find a PR, even when the user gave you a commit or a branch,
because that is what decides whether Submit is offered. Say which PR you found
(or that there isn't one) when you report the page.

## A GitHub PR (number, URL, or `owner/repo#N`)

```bash
gh pr view 640 --json number,title,body,url,headRefName,baseRefName,headRefOid,baseRefOid,author,state,files
node build-review.cjs --pr 640            # diff is base...head, fetched if missing
node build-review.cjs --pr https://github.com/org/repo/pull/640
```

`--pr` with no ref fetches `pull/N/head` when the head commit isn't local. For a
PR in another repo, run from a clone of that repo: `git diff` needs the objects.

## Re-reviewing a PR you reviewed before

```bash
node build-review.cjs --pr 640                 # full PR; files changed since your review are badged
node build-review.cjs --pr 640 --since last    # only the commits since your last review
```

The build reads your last submitted review with `gh api .../pulls/N/reviews`
and fetches that commit if it's missing (after a force-push, GitHub usually
still serves it by SHA). If it can't, the `re-review:` line says so; fall back
to the full page.

## A single commit

```bash
git show --stat --format='%H%n%s%n%n%b' <sha>
# Which PR contains it? (works for merged and open PRs)
gh api "repos/{owner}/{repo}/commits/<sha>/pulls" --jq '.[] | "\(.number) \(.state) \(.title)"'
node build-review.cjs <sha> --pr <N>      # the commit's own diff, comments post to the PR
```

Comments on a commit inside a PR are anchored at that commit. If the PR has
moved on since, GitHub may show them as outdated; the submit step says so.

## A commit range

```bash
git log --oneline A..B
node build-review.cjs A..B                # changes in B not in A
node build-review.cjs A...B               # from the merge base, like GitHub shows a PR
```

## A branch name

```bash
base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null \
  || git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')
git fetch --quiet origin "$base" <branch>
gh pr list --head <branch> --state all --json number,title,state --limit 5
node build-review.cjs "origin/$base...origin/<branch>" --pr <N>   # or omit --pr if none
```

Prefer `origin/<branch>` over a local branch the user may not have pulled.

## A ticket ID (Linear, Jira, ...), e.g. `KATT-2169`

Teams put the ID in branch names, commit subjects, and PR titles, in either case.

```bash
id=KATT-2169
gh pr list --state all --search "$id in:title,body" --json number,title,state,headRefName --limit 10
git branch -a --list "*$(echo $id | tr A-Z a-z)*" "*$id*"
git log --all --oneline -i --grep "$id"
```

If a Linear MCP is connected, the issue gives the description (intent), and
often its attachments link the PR and its `branchName`. One PR: use `--pr`.
Several PRs or none: show what you found and ask which to review.

## Uncommitted work

```bash
git diff HEAD | node build-review.cjs --stdin -o tmp/review/wip.html --title "Work in progress"
```

There is no `--numstat` to check against, so the self-check is skipped, and
with no commit there is nothing to post to; Copy as Markdown is the output.

## Gotchas

- `gh` and `git` may point at different repos: a fork, or a clone with
  several remotes. Check `gh repo view --json nameWithOwner` and pass
  `owner/repo#N` explicitly if they disagree.
- `gh pr diff` refuses very large PRs. The builder and the submit script both
  use local `git diff`, which doesn't have that limit, as long as the commits
  are fetched.
- A shallow clone (common in CI) may not have the merge base. `git fetch
  --unshallow` or `--deepen` fixes it.
