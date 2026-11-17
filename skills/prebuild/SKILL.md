---
name: prebuild
description: >
  Run a pre-build session on a Linear card before implementation starts. The
  card owner and a teammate go through a short browser presenter together.
  Each slide pairs context Claude has verified (a diagram, plus facts with
  file or card refs) with one pointed question, and gives the team a board for
  notes and whiteboard photos. Depth scales with the card's estimate. Afterwards
  Claude writes a short summary of decisions and open questions, and posts it
  to Linear only if asked. This is the teammate stage after brave-breakdown.
  Trigger when someone runs `/prebuild <ISSUE-ID>`, or says "prebuild this",
  "pre-build session", "let's talk this card through with <teammate>", "get a
  second set of eyes on this before I build it", "validate the approach with
  the team", or "walk my teammate through this card".
compatibility: Designed for Claude Code. Needs Linear MCP tools and python3 (for serve.py). Uses a browser pane and Granola tools when available. The presenter works offline.
metadata:
  triggers: "prebuild, pre-build, second set of eyes, talk through a card, validate the approach, scope review, before building, pair on planning"
---

# Pre-build session

This skill gets two people talking about the same task, using real information.
Claude does the homework, and each slide gives that homework a diagram, a few
facts and one question. The team discusses it and writes on the board. Keep
text short and prefer diagrams. Never hand the team a document to read.

Usage: `/prebuild <ISSUE-ID> [--assist interviewer|nudge|strawman] [--async]`

Phases: **Prep** (owner and Claude, in chat) → **Owner pass** (owner alone, in
the presenter) → **Live session** on what's still Open (owner and teammate, only
if needed) → **Wrap-up** (Claude) → **Share**.

## 1. Prep (owner and Claude, about 15 minutes)

### Gather
Read the card (title, description, estimate, labels, acceptance criteria), its
parent, the other cards in its project, and any blocking cards. Then look at
the code the card touches: models, controllers, jobs, specs, and anything else
that uses them.

### Look for a breakdown
Check whether the owner already ran `brave-breakdown` on this card. Don't ask:
look for a "BRAVE Breakdown" heading in this conversation first, then in the
card's description and comments.

**When there is one, build from it:**
- Skip questions it already answers, and shorten the explain-back to "Built
  from your breakdown: <approach in a sentence>. Still right?", plus the
  Assumed and Gaps lists from Explain it back.
- Its scope, approach and estimate become `constraint` facts
  (`"ref": "BRAVE breakdown"`), so the teammate can challenge them.
- Its risks and open questions go on their boards as `notes` marked Open.
  They're the owner's own words, so this is allowed even in `interviewer` mode.
- Spend prep on what it missed: stale card text, hidden reach, colliding
  work. Those are the gaps the teammate session is for.

**When there isn't one** and the card is 8 points or more, offer to run
`brave-breakdown` first. Don't insist.

### Size it
| Size | Session |
|---|---|
| 1–2 pts | No session. Ask "Anything surprising here?" in chat, then stop. |
| 4 pts | Picture, Approach, Done when |
| 8 pts | + Scope, Risks, Dependencies |
| 16–32 pts or `Epic` | All six slides, with fuller diagrams. Consider splitting the card. |
| No estimate | Ask the owner to size it first. |

The owner may move the tier up or down by one. Record their reason.

### Explain it back
Before building anything, tell the owner what the task is, as you understand
it, in no more than three lines plus one diagram. Chat doesn't render
Mermaid, so draw that diagram with your visual tool if you have one.
Otherwise draw it as plain text with box-drawing characters, inside a code
block:

```
Drawing set PDF ──┬──▶ Top
                  ├──▶ Front
                  ├──▶ Left ──▶ hidden by a passive object
                  └┄┄▶ Right?  (new, the card's ask)
```

Draw anything you assumed dashed (`┄` in text). Under the diagram, add up to
three bullets each, and leave a list out when it's empty:
- **Assumed:** what the summary relies on that neither the card nor the
  code confirms, e.g. "Archiving can be undone (the card doesn't say)".
- **Gaps so far:** facts prep found that could change the plan (a `gap` in
  `references/deck.md`), each with its ref.

Ask: "Is this the task, and are the assumptions right?" Correct it until they
agree. A corrected assumption becomes a `constraint` fact, one still unsure
becomes an Open note, and each gap carries into the deck as a `gap` fact.

### Build the deck
Make the session folder `~/.prebuild/<ISSUE-ID>/` and write `deck.json` to it.
Read `references/deck.md` for the format before writing it.

Slides, in order (include the ones the tier calls for):

| id | Topic | Context to show | `board` |
|---|---|---|---|
| `picture` | The task in one picture | The corrected explain-back diagram, before and after | `stickies` (corrections) |
| `approach` | Approach | The files and classes that change, and the existing pattern it follows | `stickies` |
| `scope` | Scope | The affected areas, with the boundary drawn | `columns` In / Out |
| `done` | Done when | Specs and screens touched, plus the acceptance criteria | `stickies` |
| `risks` | Risks and edge cases | Messy or legacy data, shared code, ordering, scale | `risks` |
| `deps` | Dependencies | Related cards and what must land first | `stickies` |

Rules for slides:
- **One question per slide.** Point it at the evidence, e.g. "Which of these…",
  "What breaks if…". Never ask anything as vague as "Any thoughts on scope?".
- **A diagram on every slide** where there's something to draw. Read
  `references/diagrams.md` before writing the first one, and render-check
  every slide with its `diagramCheck()` before showing the owner the deck.
- **Facts:** two to four per slide, each verified and with a `ref`, tagged
  `gap`, `constraint` or `context` (see `references/deck.md`). Aim for a gap
  per slide; if prep finds none anywhere, tell the owner.
- **No prose paragraphs.** If something needs explaining, it belongs in the
  diagram.

### Assist level
Use `--assist` if given. Otherwise use `assist:` from `~/.claude/prebuild.yml`.
If neither is set, use `interviewer`.
- **`interviewer`** (default): facts and diagrams only. No opinions, and
  nothing pre-filled on the boards.
- **`nudge`**: one hidden "Did you consider…" hint per slide (`consider`).
- **`strawman`**: draft answers on the boards for the team to keep, edit or
  delete (`seed`).
- At any level, the owner's own breakdown can go on as real `notes`.

### Owner reviews the deck
Show the owner a short list of the slides (topic, question, a one-line summary
of the diagram) and ask what to cut, reword or add. Rewrite `deck.json` until
they're happy. Don't start the session before they approve the deck.

## 2. Session: owner pass first, then live on what's still Open

Start the server in the background:

```bash
python3 <this skill's folder>/serve.py ~/.prebuild/<ISSUE-ID> --port 8765
```

If port 8765 is taken, pick another and use it in the URLs below.

### 2a. Owner pass (async, owner alone)
Open `http://localhost:8765/` in your client's browser pane if it has one, or
with `open` if not. Tell the owner to go through every slide alone, answer
what they can on the boards, write anything they can't settle as an **Open
question** (or press **Open** on an existing note), and say "done" at the
end. Everything saves as they go. The whiteboard is in
`references/whiteboard.md` if they ask. Then stay quiet until they say done.

### 2b. Live session, only if something is Open
Read `board.json` and count the Open notes per slide, ignoring untouched
drafts. If none are Open, say so and go straight to wrap-up. Otherwise list
them in chat (slide and note, one bullet each) and ask whether to run a live
session with a teammate now or wrap up with them as open questions. With
`--async`, skip the question and wrap up.

For a live session, open `http://localhost:8765/?open`. It shows only slides
with Open notes, with settled notes dimmed. Tell them to talk through each
one, turn **Open** off and add the answer once it's settled, and say "done"
at the end. Anything still Open becomes an open question. If they use
Granola, it's worth recording. Then stay quiet unless asked directly.

## 3. Wrap-up (Claude)

1. Read `~/.prebuild/<ISSUE-ID>/board.json`, and look at every image in
   `photos/`. Describe what each whiteboard photo shows (boxes, arrows, lists)
   and fold that in. For every `whiteboards/<slide>.excalidraw`, compare it
   with its `.seed.excalidraw` as `references/whiteboard.md` describes, and
   fold in what the team added, crossed out or moved.
2. **Granola** (only if you have Granola tools): ask the owner whether the
   meeting was recorded. If it was, find it (search by the card title or the
   session time) and pull in decisions or concerns that never reached the
   board. If the notes aren't ready yet, say so and carry on.
3. Redraw the picture diagram with the team's corrections applied.
4. Stop the server.

Write the summary in the format in `references/summary.md`, and always save
it to `~/.prebuild/<ISSUE-ID>/summary.md`. It stays on the owner's machine,
so this isn't sharing.

## 4. Share

Show the summary in chat, then ask once:
- **Post to Linear:** add it to the card as a comment
- **Copy as Markdown:** put `summary.md` on the clipboard (`pbcopy <` it on
  macOS; otherwise give its path) so the owner can paste it wherever they like
- **Keep it here:** do nothing more

In live mode, list **Keep it here** first. In async mode, list **Post to
Linear** first. Never post without an explicit yes. Once the owner has chosen,
the skill is done.

If someone wants to share the notes before the summary exists, the
presenter's wrap-up screen has its own **Copy as Markdown** button.
