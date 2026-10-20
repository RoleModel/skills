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
compatibility: Designed for Claude Code. Needs Linear MCP tools and python3 (for serve.py). Uses a browser pane and Granola tools when available. The presenter loads Mermaid from a CDN.
metadata:
  triggers: "prebuild, pre-build, second set of eyes, talk through a card, validate the approach, scope review, before building, pair on planning"
---

# Pre-build session

This skill gets two people talking about the same task, using real information.
Claude does the homework, and each slide gives that homework a diagram, a few
facts and one question. The team discusses it and writes on the board. Keep
text short and prefer diagrams. Never hand the team a document to read.

Usage: `/prebuild <ISSUE-ID> [--assist interviewer|nudge|strawman] [--async]`

Phases: **Prep** (owner and Claude, in chat) → **Session** (owner and teammate,
in the presenter) → **Wrap-up** (Claude) → **Share**.

## 1. Prep (owner and Claude, about 15 minutes)

### Gather
Read the card (title, description, estimate, labels, acceptance criteria), its
parent, the other cards in its project, and any blocking cards. Then look at
the code the card touches: models, controllers, jobs, specs, and anything else
that uses them.

If the owner already ran the `brave-breakdown` skill on this card, ask for that
breakdown and build on it rather than asking those questions again. If they
haven't and the card is 8 points or more, offer to run it first. Don't insist.

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
with your visual tool if you have one. Otherwise use plain Mermaid without
the `:::` colour classes, which only the presenter defines and which break the
chart in chat. Ask: "Is this the task?" Correct it until they agree. This is the first check, and it catches
misunderstandings before the teammate is in the room.

### Build the deck
Make the session folder `~/.prebuild/<ISSUE-ID>/` and write `deck.json` to it:

```json
{
  "issue": {"id": "APP-123", "title": "Enable service options for AU projects", "tier": "4 pts · live"},
  "slides": [
    {
      "id": "scope",
      "topic": "Scope",
      "question": "AU will see this whole card. Which of these should they actually get?",
      "diagram": "flowchart LR\n  E[\"Service options card\"] --> F[\"Fixed options\"]:::good\n  E --> Q[\"Quote lines\"]:::warn",
      "facts": [{"text": "Quote lines render inside the same form", "ref": "app/views/projects/_service_options_form.html.slim:6", "kind": "gap"}],
      "board": "columns",
      "columns": ["In", "Out"]
    }
  ]
}
```

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
- **A diagram on every slide** where there's something to draw. Use Mermaid
  with ten or fewer nodes, and draw what's actually in the code. A chain of
  more than four nodes goes top-down (`flowchart TB`); left-to-right squashes
  it into an unreadable strip. Trees and fans (one node pointing at several)
  go left-to-right (`flowchart LR`), so the leaves stack instead of spreading.
- **Colour carries meaning.** The presenter adds five node classes to every
  flowchart: `:::accent` (the thing being changed), `:::good` (yes / in scope),
  `:::warn` (undecided, the thing to discuss), `:::bad` (no / out of scope) and
  `:::muted` (context). Leave other nodes plain, and use `warn` for the
  question the slide is asking.
- **Facts:** two to four per slide. Each has a `ref` (file path or card ID)
  and a `kind`. Only include facts you verified. Write each one as a single
  sentence with no recommendation attached.
  - **`gap`:** a fact that could change the plan if the team didn't
    know it. Either it contradicts what the card assumes, or it touches
    something the card never mentions. The test: the owner would say "huh, I
    didn't account for that". Common sources are a stale card (the code moved
    on), a card that's wrong or incomplete, hidden reach (a shared form, a
    second app, a job, a URL, stored data), and related work that collides.
    A risk with no evidence isn't a gap; that's a question for the board.
  - **`constraint`:** a rule the work has to respect, such as acceptance
    criteria, exclusions or contracts. This includes anything the card
    already says, however important.
  - **`context`** (default): useful background that needs no decision.

  The presenter shows gaps first, in amber. Aim for at least one per
  slide. If prep finds none anywhere, tell the owner, since that's worth
  knowing too.
- **No prose paragraphs.** If something needs explaining, it belongs in the
  diagram.

### Assist level
Use `--assist` if given. Otherwise use `assist:` from `~/.claude/prebuild.yml`.
If neither is set, use `interviewer`.
- **`interviewer`** (default): facts and diagrams only. No opinions, and
  nothing pre-filled on the boards.
- **`nudge`**: add `"consider": "…"` to a slide. It stays hidden until someone opens it.
- **`strawman`**: add `"seed": [{"text": "…", "col": "In"}]`. Seeds appear
  on the board as dashed drafts for the team to keep, edit or delete.

### Owner reviews the deck
Show the owner a short list of the slides (topic, question, a one-line summary
of the diagram) and ask what to cut, reword or add. Rewrite `deck.json` until
they're happy. Don't start the session before they approve the deck.

## 2. Session (owner and teammate)

Start the server in the background:

```bash
python3 <this skill's folder>/serve.py ~/.prebuild/<ISSUE-ID> --port 8765
```

If port 8765 is taken, pick another and use it in the URL. Open
`http://localhost:8765/` in your client's browser pane if it has one, or with
`open` if not. Then tell the owner:
- Go through the slides together. Type notes on each board.
- Mark anything unsettled with `?`.
- Use **Add photo** to snap a real whiteboard.
- Everything saves as you go. Say "done" at the end.
- If they use Granola, it's worth recording the meeting.

Then stay quiet. The people discuss and the board records. Answer questions
only if they ask you directly.

**`--async`** (no teammate free): the owner goes through the deck alone and
marks anything that needs a second opinion with `?`. Those become the open
questions in the shared summary. Never let async mode hold up the work.

## 3. Wrap-up (Claude)

1. Read `~/.prebuild/<ISSUE-ID>/board.json`, and look at every image in
   `photos/`. Describe what each whiteboard photo shows (boxes, arrows, lists)
   and fold that in.
2. **Granola** (only if you have Granola tools): ask the owner whether the
   meeting was recorded. If it was, find it (search by the card title or the
   session time) and pull in decisions or concerns that never reached the board. Mark
   them *(from discussion)*. If the notes aren't ready yet, say so and carry on.
3. Skip drafts the team left untouched (`draft: true`).
4. Redraw the picture diagram with the team's corrections applied.
5. Stop the server.

Write the summary. Keep it to about half a screen, and leave out empty sections:

````markdown
### Pre-build: <ISSUE-ID> <title>
_<tier> · <live with <names> | async>_

```mermaid
<corrected task diagram>
```

**Approach**
1. <step>

**In scope:** <items> · **Out of scope:** <items>

**Done when**
- [ ] <check>

**Risks**
- <risk> (likelihood/impact) — <mitigation, if discussed>

**Open questions**
1. <question>
````

## 4. Share

Show the summary in chat, then ask once:
- **Post to Linear:** add it to the card as a comment
- **Keep it here:** write it nowhere

In live mode, list **Keep it here** first. In async mode, list **Post to
Linear** first. Never post without an explicit yes. Once it's posted or kept,
the skill is done.
