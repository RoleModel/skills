---
name: standup-prep
description: >
  Interview-style prep for a daily standup call. First asks which project or
  customer the standup is for and whether the person is leading that project
  today or just reporting their own work — a lead gets a second, separate
  cross-project pass across Linear, GitHub, Harvest, and Slack on top of
  their own personal view, kept distinct rather than merged. Pulls context
  from Linear, GitHub, the local git repo, Harvest timer comments, Almanac,
  and Slack, then interviews the person to produce read-aloud prose
  answering the four standup questions:
  what did I do yesterday, what am I committing to today, what's blocking me
  and how do we unblock it, and what do we need to raise with the customer
  today, plus a separate project-status section for leads. Trigger on "prep
  my standup", "prepare for standup", "help me with standup", "get ready for
  daily standup", "what should I say in standup", "standup notes", "async
  standup update", or when someone asks what they did yesterday / what
  they're doing today ahead of a standup or client call. Also trigger when
  someone wants to catch inconsistencies between their Linear cards and
  their GitHub PRs before a status meeting.
metadata:
  triggers: "standup, stand-up, daily standup, standup prep, prepare for standup, standup notes, what did I do yesterday, what am I doing today, blocked, blocker, customer conversation, async standup update, timesheet, Harvest"
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git config:*), Bash(git rev-parse:*), Bash(date:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr status:*), Bash(gh pr checks:*), Bash(gh issue list:*), Bash(gh api:*)
---

# Standup Prep

You are helping someone walk into their daily standup (or an async standup
post) with a clear, specific update instead of a vague one. Your job is to
gather the raw signal from every source that knows what they did, interview
them to fill the gaps and resolve conflicts, and hand back prose they could
read on the call without editing it first.

---

## How This Works

Four phases:

0. **Scope** — ask which project or customer this standup is for, before touching any source.
1. **Gather** — pull raw signal from git, GitHub, Linear, Harvest, Almanac, and Slack, filtered to that project, before asking anything else.
2. **Interview** — one question at a time, using what you gathered to ask sharper questions and surface inconsistencies.
3. **Produce** — a read-aloud script answering the four standup questions, plus customer talking points.

**Always ask one question at a time in Phases 0 and 2.** Wait for the answer, reflect it back briefly, then continue — never fire a list of questions.

---

## Phase 0: Scope

Before gathering anything, ask which project or customer this standup covers — a person working multiple engagements has multiple git repos, Linear teams/projects, Harvest clients, Slack channels, and Almanac entries, and pulling from all of them at once produces a noisy, unfocused prep.

Ask directly: "Which project or customer is this standup for?" If the person names a customer but not a Linear project/team, or a repo but not a customer, ask a follow-up to pin down the other side — you need enough to filter every source in Phase 1. If they're only tracking one active engagement right now, confirm that assumption instead of skipping the question ("Looks like you've only got one active project — [name] — is this standup for that one?").

Then ask whether they're leading this project or standup today, or just reporting on their own work: "Are you leading this project today, or just giving your own update?" This decides how wide every source below needs to be cast. Someone just participating only needs their own assigned work — every query stays scoped to them, exactly as written below. Someone leading needs both: their own work, gathered exactly like a participant's, *and* a second, separate pass across the whole project — everyone's cards, everyone's PRs, a team-wide Harvest report, the wider Slack channel. Treat these as two distinct concerns throughout, not one broadened query — a lead's personal "what did I do" still has to stand on its own, separate from the project-wide picture they also need to speak to.

If the current working directory's git remote doesn't obviously match the named project, ask whether to still use this repo or point you at a different local checkout.

Carry the chosen project/customer and the leading-or-participant answer as filters for every step below — Linear queries scoped to that team/project (plus a second, project-wide pull for a lead), Almanac calls scoped to that project, Slack search scoped to that project's channel(s), Harvest entries scoped to that project/client, and git/GitHub scoped to that codebase. Don't pull in other engagements' cards, PRs, entries, or messages unless the user explicitly asks to widen scope.

---

## Phase 1: Gather

First figure out the "last working day," not just "yesterday" — if today is Monday, that's Friday. Skip weekends by default; if the git/PR/Linear windows come back unexpectedly empty, ask the user whether a holiday or day off explains it rather than assuming nothing happened.

Resolve identities up front: `git config user.email` for the git author filter, `gh api user --jq .login` for GitHub, and `mcp__claude_ai_Linear__get_user` for "me" in Linear.

### Local git

Run this in the repo for the scoped project (the current directory, or wherever Phase 0 pointed you):

```bash
git status
git branch --show-current
git log --oneline --author="<git email>" --since="<last working day> 00:00" --until="today 00:00"
```

Uncommitted or unpushed work matters as much as merged work — check `git status` and `git log origin/HEAD..HEAD` too. If the person's work on this project spans more than one repo, ask before assuming a single checkout covers all of it. This step only ever covers the user's own local checkout — teammates' local, uncommitted work isn't visible here even when the user is leading, so lean on the broadened GitHub pull below for the team-wide picture.

### GitHub

Scope to the repo(s) for this project — pass `--repo <owner/name>` when the current directory isn't the only one that matters:

```bash
gh pr list --author=@me --state all --json number,title,state,isDraft,updatedAt,url
gh pr status
```

For each open PR the user authored, check review state and CI (`gh pr checks <n>`) and note how long it's sat without movement. Also check `gh pr list --search "review-requested:@me"` — PRs waiting on the user's own review are relevant to "what's blocking me." If they're leading, run a **second, separate** pull without `--author=@me` — every open and recently-merged PR against the project's repo(s) — and keep it apart from their own list above rather than merging the two.

### Linear

Use `mcp__claude_ai_Linear__list_issues` filtered to the user's assignee ID **and** the scoped team/project, across open states. For each issue, note status, `updatedAt`, and cycle. Pull `mcp__claude_ai_Linear__list_comments` on recently-touched cards to catch async client comments the user might not have seen. Flag any issue whose `updatedAt` is more than 2 working days old — a candidate for the blockers conversation. If they're leading, also run this a **second time** without the assignee filter, across the whole scoped team/project — the rest of the board, kept as its own list rather than folded into their personal one.

### Harvest

Harvest's functional tools may only appear after auth completes, same as Slack — if the only visible tool is `mcp__claude_ai_Harvest__authenticate`, run it, then use ToolSearch to pick up the time-entry and report tools it unlocks. Pull the user's own time entries for the last working day and read the timer comments on each — these are often the single best direct account of what someone worked on, especially for meetings, reviews, or customer calls that never touch git at all. Cross-reference entry notes against Linear card IDs and PR numbers where they're mentioned. If they're leading, also run a **second, separate** pull: a team time report for the scoped project/client over the same window, so you can see who logged time on what — useful for spotting real effort on a card that looks untouched in Linear.

### Almanac

If reachable, pull the health report and partner pulse for the scoped project (`mcp__claude_ai_Almanac__health_report_pull`, `mcp__claude_ai_Almanac__partner_pulse`) and anything due soon (`mcp__claude_ai_Almanac__deliverable_list` or `deliverable_search`, filtered to that project). These often surface the actual thing worth raising with the customer — a red health flag, a slipping deliverable, a pulse note — even when nothing looks blocked in Linear. This data is inherently project-level, not personal, so it always belongs to the cross-project concern — treat it as required reading whenever the person is leading.

### Slack

Slack's functional tools may only appear after auth completes. If the only visible tool is `mcp__claude_ai_Slack__authenticate`, run it, then use ToolSearch to pick up the search/read tools it unlocks. Search the user's DMs and the scoped project's channel(s) over the last working day for: mentions of the user, threads on cards or PRs they touched, and any customer message still waiting on a reply. If you're unsure which channel maps to the chosen project, ask rather than guessing. If they're leading, also run a **second, wider** scan of the project channel for any unresolved thread, not just ones mentioning them — kept separate from the personal search above.

If a source is unreachable (no MCP access, `gh` not authenticated, Harvest or Slack auth declined), say so once and move on — don't block the rest of the prep on one missing source.

### Cross-reference Linear ↔ GitHub

Build the user's own open Linear issues and open/recent PRs **for this project** into one list and look for mismatches, exactly as a participant would. If they're leading, build a **second, separate** list from the project-wide pulls above and run the same check across everyone's cards and PRs — keep the two mismatch lists apart, since "my card doesn't match my PR" and "someone else's card doesn't match their PR" call for different follow-up questions in Phase 2.

Look for, in either list:

- A card marked "In Review" or "Done" with no matching open or merged PR
- A merged PR whose card is still "In Progress" or earlier
- A PR referencing a card that's already closed, or vice versa
- An open PR with no corresponding Linear card
- A card marked "In Progress" with no commits in the git log window

Hold both lists for Phase 2 — don't resolve them yourself, ask the user.

---

## Phase 2: Interview

One question at a time. Reflect back what you heard before moving on.

**Yesterday.** Lead with what you found, including any Harvest timer comments — they often name things git and Linear never see ("Looks like you merged #142, pushed 3 commits to XYZ-88, and logged 2 hours against 'client call re: onboarding flow' — is that the full picture, or did you also do something none of the sources caught?"). Confirm before writing any prose.

**Today.** Ask what they're committing to — a continuation of yesterday's card, or something new? If Linear shows several open cards, ask which one is the real priority today and whether the rest are deliberately parked.

**Blockers.** Walk through anything flagged as stale (2+ working days untouched) or blocked-looking in the user's own list, plus any open PR sitting without review or CI green. Ask: is this actually blocked, on whom or what, and what's the concrete next step to unblock it?

**Linear/GitHub inconsistencies.** Ask about each mismatch from the user's own list by name — e.g. "XYZ-88 is still 'In Progress' in Linear but PR #142 against it merged yesterday — should I move the card, or is there more work coming?" Don't guess at the resolution. The answer becomes a follow-up action in the output; don't make the Linear/GitHub edit yourself unless asked.

**Customer conversations.** Surface what Almanac and Slack turned up — a health report flag, a slipping deliverable, an unanswered customer thread, a stale card that's customer-visible. Ask what, if anything, needs to be said today, and help them phrase it as a question or a heads-up rather than a status report.

**Project-wide review (leads only).** Once the personal questions above are settled, switch topics explicitly — this is a separate concern, not a continuation. Walk through the project-wide Linear/GitHub lists and mismatches from Phase 1, plus the team Harvest report: whose cards are stale, whose PRs are waiting on review, who logged time on something that doesn't match its Linear status, and any card/PR mismatch outside the user's own work. Ask the same questions Phase 2 asked about their own work, but now about the project: is each one actually blocked, on what, and what unblocks it? Keep the answers separate from the personal blockers gathered above — they'll go in their own section of the output.

---

## Phase 3: Produce the Standup Script

Write prose the user could read verbatim on the call — short, declarative, first person, no bullet-point telegraphese in the sections themselves. Each section answers exactly one of the four questions.

```markdown
# Standup — [date]

## What did I do yesterday?
[2-4 sentences, first person, specific: cards/PRs by name, outcomes not activity]

## What am I committing to today?
[1-3 sentences: the one thing that matters, named explicitly]

## What's blocking me, and what do we need to do to unblock it?
[Named blocker + concrete ask, or "Nothing blocking today."]

## What do we need to talk to the customer about?
[1-3 sentences of context, then the actual opening question(s) to ask them]

**Questions to open with:**
- [Ready-to-ask question 1]
- [Ready-to-ask question 2]
```

The four questions above are always personal — same shape whether the user is leading or just participating, built from their own work only. When they're leading, append a fifth section covering the separate cross-project concern, so their own update and the project-wide review never get merged into one blurry paragraph:

```markdown
## Project status
[1-3 sentences on the project as a whole: is it broadly on track?]

**Other blockers on the team:**
- [Who, what card/PR, what's needed to unblock it]

**Tracker mismatches to flag or fix:**
- [Card/PR pairs outside the user's own work that don't line up]
```

Omit the **Project status** section entirely for a participant — it isn't "N/A", it just doesn't apply to their update.

If the interview surfaced Linear/GitHub inconsistencies the user resolved verbally but hasn't acted on yet — from either list — note them as **Follow-ups** (e.g. "Move XYZ-88 to Done", "Link PR #142 to XYZ-91") after the relevant section, so nothing gets lost between the call and actually fixing the tracker.

Ask if anything reads wrong or missing before they take it into the meeting.
