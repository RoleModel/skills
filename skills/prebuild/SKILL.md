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
- **Skip the prerequisite questions** it already answers, such as scope and
  exclusions.
- **Shorten the explain-back** to one line: "Built from your breakdown:
  <approach in a sentence>. Still right?"
- **Turn its scope, approach and estimate into `constraint` facts** with
  `"ref": "BRAVE breakdown"`, so the teammate can challenge them.
- **Put its risks and open questions on the boards** they belong to, as
  pre-filled notes marked Open (see `notes` under Build the deck). These are
  the owner's own words, so this is allowed even in `interviewer` mode.
- **Spend prep finding what the breakdown missed:** stale card text, hidden
  reach, colliding work. Those are the gaps the teammate session is for.

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
it, in no more than three lines plus one diagram. In chat, draw that diagram
with your visual tool if you have one. Otherwise use plain Mermaid. Ask: "Is this the task?" Correct it until they agree. This is
the first check, and it catches misunderstandings before the teammate is in
the room. If you're building from a breakdown, use its one-line form instead
(see Look for a breakdown).

### Build the deck
Make the session folder `~/.prebuild/<ISSUE-ID>/` and write `deck.json` to it.
Read `references/deck.md` for the format before writing it.

Slides, in order (include the ones the tier calls for):

| id | Topic | Context to show | `board` |
|---|---|---|---|
| `picture` | The task in one picture | The corrected explain-back diagram, before and after | `stickies` (corrections) |
| `approach` | Approach | The files and classes that change, and the existing pattern it follows | `steps` |
| `scope` | Scope | The affected areas, with the boundary drawn | `columns` In / Out |
| `done` | Done when | Specs and screens touched, plus the acceptance criteria | `checklist` |
| `risks` | Risks and edge cases | Messy or legacy data, shared code, ordering, scale | `risks` |
| `deps` | Dependencies | Related cards and what must land first | `stickies` |

Rules for slides:
- **One question per slide.** Point it at the evidence, e.g. "Which of these…",
  "What breaks if…". Never ask anything as vague as "Any thoughts on scope?".
- **A diagram on every slide** where there's something to draw. Read
  `references/diagrams.md` before writing the first one.
- **Facts:** two to four per slide, each verified and with a `ref`. Tag each
  `gap`, `constraint` or `context` (defined in `references/deck.md`). A gap is
  anything that would make the owner say "huh, I didn't account for that".
  Aim for at least one per slide. If prep finds none anywhere, tell the
  owner, since that's worth knowing too.
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

At any level, the owner's own breakdown can go on the boards as real notes
(`notes`).

### Owner reviews the deck
Show the owner a short list of the slides (topic, question, a one-line summary
of the diagram) and ask what to cut, reword or add. Rewrite `deck.json` until
they're happy. Don't start the session before they approve the deck.

## 2. Session: owner pass first, then live on what's still Open

The aim is to answer as much as possible before anyone else is pulled in, so
the live session stays short.

Start the server in the background:

```bash
python3 <this skill's folder>/serve.py ~/.prebuild/<ISSUE-ID> --port 8765
```

If port 8765 is taken, pick another and use it in the URLs below.

### 2a. Owner pass (async, owner alone)
Open `http://localhost:8765/` in your client's browser pane if it has one, or
with `open` if not. Tell the owner:
- Go through every slide alone and answer what you can on the boards.
- For anything you can't settle alone, pick **? Open question** in the box
  under each board before writing it (it goes back to Note after each one).
  For an existing note, hover over it and press `?`. Press Enter or **Add**
  to add a note; anything still typed when you change slides is added too.
- Use **Add photo** to snap a real whiteboard, or open the **Whiteboard** row above Notes to draw:
  **Inline** in the slide, or a **Live session** on excalidraw.com for a remote
  teammate (see `references/whiteboard.md`).
- Everything saves as you go. Say "done" when you've been through it all.

Then stay quiet until they say done.

### 2b. Decide whether a live session is needed
Read `board.json` and count the Open notes per slide (ignore untouched drafts).
- **None Open:** say so and go straight to wrap-up. No meeting needed.
- **Some Open:** list them in chat (slide and note, one bullet each) and ask
  whether to run a live session with a teammate now, or to wrap up with them as
  open questions. With `--async`, skip the question and wrap up.

### 2c. Live session (owner and teammate, Open items only)
Open `http://localhost:8765/?open`. That view shows only the slides that still
have Open notes, with settled notes dimmed for context. Tell them:
- Talk through each Open note. When it's settled, turn its `?` off and add the
  answer as a note.
- Anything still unsettled at the end stays Open and becomes an open question.
- Say "done" at the end. If they use Granola, it's worth recording the meeting.

Then stay quiet. Answer questions only if they ask you directly.

## 3. Wrap-up (Claude)

1. Read `~/.prebuild/<ISSUE-ID>/board.json`, and look at every image in
   `photos/`. Describe what each whiteboard photo shows (boxes, arrows, lists)
   and fold that in. For every `whiteboards/<slide>.excalidraw`, compare it
   with its `.seed.excalidraw` as `references/whiteboard.md` describes, and
   fold in what the team added, crossed out or moved.
2. **Granola** (only if you have Granola tools): ask the owner whether the
   meeting was recorded. If it was, find it (search by the card title or the
   session time) and pull in decisions or concerns that never reached the board. Mark
   them *(from discussion)*. If the notes aren't ready yet, say so and carry on.
3. Skip drafts the team left untouched (`draft: true`).
4. Redraw the picture diagram with the team's corrections applied, as plain
   Mermaid (Linear renders it in comments).
5. Stop the server.

Write the summary. Keep it to about half a screen, and leave out empty sections:

````markdown
### Pre-build: <ISSUE-ID> <title>
_<tier> · <live with <names> | async>_

```mermaid
<corrected task diagram>
```

**Approach**
- <step, in order>

**In scope:** <items> · **Out of scope:** <items>

**Done when**
- [ ] <check>

**Risks**
- <risk> (likelihood/impact) — <mitigation, if discussed>

**Open questions**
- <question>
````

Use plain bullets for every list. The only exception is **Done when**, which
uses checkboxes because people tick it off. Never use numbered lists.

Always save the summary to `~/.prebuild/<ISSUE-ID>/summary.md`. It stays on
the owner's machine, so this isn't sharing.

## 4. Share

Show the summary in chat, then ask once:
- **Post to Linear:** add it to the card as a comment
- **Copy as Markdown:** put `summary.md` on the clipboard (`pbcopy <` it on
  macOS; otherwise give its path) so the owner can paste it wherever they like
- **Keep it here:** do nothing more

In live mode, list **Keep it here** first. In async mode, list **Post to
Linear** first. Never post without an explicit yes. Once the owner has chosen,
the skill is done.

The presenter's wrap-up screen has its own **Copy as Markdown** button, which
copies the raw boards straight away. Mention it when someone wants to share
the notes before you've written the summary.
