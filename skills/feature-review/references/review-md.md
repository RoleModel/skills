# REVIEW.md: a project's review rules

A repo can keep a `REVIEW.md` at its root. It says what this project's reviews
should look for, and which shared team guides apply. It is plain Markdown for
people as much as agents, so AGENTS.md can link to it and a new teammate can
read it.

```markdown
# Code review

## Shared guides
- rolemodel/review-guides: code-review-principles.md
- rolemodel/review-guides: lcad-code-review-principles.md
- rolemodel/review-guides@v2: lcad-structure-guidelines.md — pinned while v3 settles
- [Pricing review notes](docs/review/pricing.md)

## This project
- Portal pushes changes to Builda and Roofs by webhook; flag anything that skips it.
- Pricing changes need a spec under spec/services/pricing.
```

## Shared guides

List items under a heading that contains "Shared guides":

- `owner/repo: path`: a file in a GitHub repo, at its default branch.
- `owner/repo@ref: path`: the same at a tag, branch or commit. Pin when you want
  a change to the guides to reach this project only when someone moves the pin.
- `path`: a file in this repo.
- `[Title](path)`: a file in this repo, as a Markdown link, so the list reads and
  clicks through on GitHub. Prefer this for local guides.

Text after a dash is a note for people and is ignored.

`scripts/review-guides.cjs` fetches remote guides with `gh api`, so GitHub
decides who can read them, and caches them under
`~/.cache/feature-review/guides`. A listed guide's relative links to other `.md`
files in its repo are fetched too, one hop only, so a guide that builds on
another brings it along. When GitHub can't be reached it uses the cached copy
and says so; `--offline` uses only the cache. It prints:

```
project rules: /path/to/repo/REVIEW.md
guide: rolemodel/review-guides@default:code-review-principles.md -> ~/.cache/...
guide: rolemodel/review-guides@default:clean-code-principles.md (linked) -> ~/.cache/...
review-guides: 2 guide(s)
```

## This project

Everything else in the file is the project's own review rules. Keep them to
things a reviewer of this codebase would not know otherwise: invariants, risky
areas, conventions that differ from the shared guides, and what a past bug
taught. A rule that applies to every project belongs in a shared guide.

## How the skill uses it

The agent reads `REVIEW.md` and every guide before it writes the review.
Recommendations and suggested comments should follow from them, and the
project's rules win over the reviewer's personal preferences when they
conflict. Without a `REVIEW.md` the skill reviews on general judgement.
