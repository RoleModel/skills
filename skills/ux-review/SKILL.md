---
name: ux-review
description: Reviews UI code (Slim/HTML, CSS, Stimulus/JS) for usability problems against Nielsen's 10 usability heuristics and the Laws of UX, and reports them as a ranked issue log with evidence and fixes. Use when asked for a UX review, UI review, usability audit, heuristic evaluation, or "is this usable", when checking a new screen or flow before it ships, or when the user mentions Nielsen, heuristics, Fitts's Law, Hick's Law, or another Law of UX.
metadata:
  triggers: "ux review, ui review, usability review, usability audit, heuristic evaluation, nielsen heuristics, laws of ux, fitts's law, hick's law, ux audit, is this usable"
---

# UX Review

You already know Nielsen's 10 heuristics and the Laws of UX. This skill sets the procedure, what to look for in this stack, and the report format.

## Scope

Ask for, or infer, what to review: one view, one flow (several views plus the controller actions between them), or a whole feature. Read the templates, their partials, the Stimulus controllers they attach, and the CSS for the blocks they use. Run the app and look at it when a browser tool is available; code alone misses layout, contrast, and timing.

## What to check

Work through the table. Each row is a common failure and the code that reveals it.

| Check | Heuristic / law | Look for |
| --- | --- | --- |
| Async actions show progress | H1 Visibility; Doherty Threshold | Submit buttons without `data-turbo-submits-with` or a disabled state; Turbo Frame loads with no busy state; no `aria-busy` or `aria-live` |
| Language is the user's, not the code's | H2 Real-world match | Model or column names in labels, raw validation keys, HTTP codes, enum values shown verbatim |
| Destructive and multi-step actions can be escaped | H3 User control | Deletes without `data-turbo-confirm` or undo; modals without Escape and a visible close; wizards without Back |
| Same thing looks and behaves the same everywhere | H4 Consistency; Jakob's Law; Similarity | Custom buttons beside Optics buttons, mixed terminology, hard-coded values instead of tokens (see `optics-context`) |
| Bad input is prevented | H5 Error prevention; Postel's Law | Missing `type`, `required`, `min`/`max`, `inputmode`; strict formats the server could normalize (phone, dates, currency) |
| Options are visible, not remembered | H6 Recognition | Placeholder-only labels, icon-only buttons without text or `aria-label`, no breadcrumbs or current-page state |
| Frequent tasks are fast | H7 Efficiency; Pareto | No search or filter on long lists, no bulk actions, primary task buried below secondary ones |
| Screens show only what the task needs | H8 Minimalism; Hick's Law; Miller's Law; Prägnanz | Several competing primary buttons, nav with more than about 7 top-level items, long selects that should be searchable |
| Errors say what happened and how to fix it | H9 Error recovery; Peak-End | Generic flash messages, errors not placed next to the field, form state lost on failed submit |
| Help is where the question comes up | H10 Help | Empty states with no next step, unexplained fields without hint text |
| Targets are easy to hit | Fitts's Law | Interactive elements under 44×44px, unpadded text links, tiny close buttons in corners |
| Related things are grouped | Proximity; Common Region | Related fields spaced like unrelated ones; sections without a container or heading |
| Long flows show progress | Goal-Gradient; Zeigarnik | Multi-step forms without a step indicator; drafts with no "incomplete" marker |

Report one problem once. When a single root cause breaks several rows (a form with no loading state, a generic error, and no cancel), file it as one finding and list every heuristic it touches.

## Severity

- **Critical:** users cannot finish a core task, or can lose data with no recovery.
- **Major:** users finish, but with significant confusion, rework, or risk.
- **Minor:** an annoyance with an easy workaround.
- **Advisory:** an improvement that doesn't block anything.

Rate by impact on the user's task, not by how many rules a finding breaks.

## Report format

Start with the counts, then the findings ordered by severity, then the fix order.

```markdown
## UX Review: <screen or flow>

| Severity | Count |
| --- | --- |
| Critical | 1 |
| Major | 2 |
| Minor | 3 |
| Advisory | 1 |

### 1. <Finding title>
- **Severity:** Critical
- **Breaks:** H3 User control, H9 Error recovery
- **Where:** `app/views/orders/_form.html.slim:24`
- **Problem:** What the user experiences and why it matters.
- **Evidence:** the offending snippet
- **Fix:** the corrected snippet, using Optics components and tokens

## Fix order
1. Now (Critical): 1
2. Next (Major): 2, 3
3. Later (Minor, Advisory): 4–7
```

Every finding needs a file and line, or the exact screen and element. Drop findings you can't point at.

## Writing the fix

Fixes use Optics components and `--op-` tokens (`optics-context`) and BEM class names (`bem-structure`). Prefer the Rails and Turbo built-ins (`data-turbo-confirm`, `data-turbo-submits-with`, Simple Form error placement) over new Stimulus controllers.
