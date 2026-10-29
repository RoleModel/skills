# deck.json

The presenter reads `~/.prebuild/<ISSUE-ID>/deck.json` and writes everything
the team adds to `board.json` next to it. Never edit `board.json` by hand
while a session is running.

```json
{
  "issue": {"id": "APP-123", "title": "Enable service options for AU projects", "tier": "4 pts · live"},
  "slides": [
    {
      "id": "scope",
      "topic": "Scope",
      "question": "AU will see this whole card. Which of these should they actually get?",
      "diagram": {
        "kind": "structure", "title": "What AU would see",
        "layers": ["card", "groups"],
        "nodes": [
          {"id": "card", "label": "Service options card", "layer": "card"},
          {"id": "fixed", "label": "Fixed options", "layer": "groups", "status": "new"},
          {"id": "lines", "label": "Quote lines", "sub": "AU?", "layer": "groups", "status": "changed"}
        ],
        "edges": [["card", "fixed"], ["card", "lines"]],
        "legend": {"new": "Yes", "changed": "To discuss"}
      },
      "facts": [
        {"text": "Quote lines render inside the same form", "ref": "app/views/projects/_service_options_form.html.slim:6", "kind": "gap"}
      ],
      "board": "columns",
      "columns": ["In", "Out"]
    }
  ]
}
```

## `issue`

- `id`, `title`: from the card.
- `tier`: a short label for the header, e.g. `"8 pts · live"`.

## Each slide

- `id`: one of `picture`, `approach`, `scope`, `done`, `risks`, `deps`. The
  board's notes are saved under it, so don't rename it mid-session.
- `topic`: the slide's short name.
- `question`: one question, pointed at the evidence on the slide.
- `diagram`: optional. A `diagrams.js` object; see `diagrams.md`.
- `facts`: two to four. Each is `{text, ref, kind}`.
- `board`: what the team writes on.
  - `stickies`: a plain list
  - `columns`: one list per entry in `columns` (default `["In", "Out"]`).
    With two columns they're tinted green and red, unless `tones` says
    otherwise. Underneath is a plain **General notes** list for anything
    that fits no column; its notes have `"col": "General"`, so `seed` and
    `notes` can put things there too. Notes can be dragged between all of
    these by their ⠿ grip.
  - `risks`: items with likelihood and impact ratings (L, M or H)
- `consider`: `nudge` assist level only. A hint that stays hidden until someone
  opens it.
- `seed`: `strawman` assist level only. `[{"text", "col"}]`, shown as dashed
  drafts. A draft becomes a real note as soon as anyone touches it, or with ✓
  Keep. Drafts nobody touched are left out of the summary.
- `notes`: any assist level, but only for the owner's own words (from their
  BRAVE breakdown). `[{"text", "col", "open", "from"}]`. These are real notes,
  not drafts, and each one shows its `from` label.

## Fact kinds

- **`gap`**: a fact that could change the plan if the team didn't know it.
  Either it contradicts what the card assumes, or it touches something the
  card never mentions. The test: the owner would say "huh, I didn't account
  for that". Common sources:
  - a stale card (the code moved on since it was written)
  - a card that's wrong or incomplete
  - hidden reach: a shared form, a second app, a job, a URL, stored data
  - related work that collides

  A risk with no evidence isn't a gap; that's a question for the board.
- **`constraint`**: a rule the work has to respect, such as acceptance
  criteria, exclusions or contracts. This includes anything the card already
  says, however important, and anything taken from the owner's breakdown
  (`"ref": "BRAVE breakdown"`).
- **`context`** (default): useful background that needs no decision.

The presenter shows gaps first, in amber, then constraints, then context.
