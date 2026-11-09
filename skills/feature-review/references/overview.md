# Writing the overview (the Story, Checks and Shape steps)

The page reviews in steps: **Story**, **Checks**, **Shape**, **Recommendations**
and **Submit**, with the code one button away. The overview feeds the first
three. A reviewer who reads them should know what the change does for the
user, whether it does it right, and how it rearranges the code. The diff is the
fallback: the place to confirm what the overview says.

## Story and Checks: concepts, not code

The first two steps are about the *outcome*: does the change produce the right
result, and does it behave correctly? The reviewer is building a picture of the
concepts at play (who does what, what they see, what happens next), not of the
implementation. So everything that shows in them is written in product
language:

- **No code.** No class, method, file, table, column, route, param, job or
  gem names, no backticks, no file paths. Say "the order's shipping method",
  not `Order#shipping_mode`; "the Projects page", not `ProjectsController#index`;
  "saving the order", not "the PATCH to `update`".
- **Outcomes and behaviour.** What a person can now do, what they see, what
  changes for them, what happens at the edges (a second tab, no permission, an
  empty list, an existing record).
- **The technical story goes later.** Objects, layers and structure belong in
  the **Shape** step (`shape`, structure diagrams); how a piece is built, and
  what to change, belongs in the groups and recommendations.

This covers `author`, `feature` (with its checks and `"section": "feature"`
diagrams) and `connection`. Where those keys below mention code, leave it out.

It goes in the same `tmp/review/<slug>.groups.json` as the reading guide, under
`overview`. Every key is optional. Leave out what you have nothing true to say
about: an empty section is better than filler.

```json
{
  "groups": [ ... ],
  "suggestions": [ ... ],
  "overview": {
    "author": {
      "summary": "The author says this fixes **account admins not seeing their orders** and makes the order statuses clearer.",
      "points": ["Two specs marked obsolete, kept for later"],
      "differs": "The description says the specs were *marked* obsolete; the diff deletes them."
    },
    "feature": {
      "summary": "Rotating a **shape** turns it about its centre instead of its corner.",
      "behavior": "Before: the shape swung around its corner and left the canvas. After: it turns in place.",
      "checks": [
        { "id": "centre", "text": "Rotating a shape 90° keeps its centre in place",
          "how": "Place a shape, rotate it with the handle, compare the centre before and after.",
          "path": "app/javascript/drawing/RectangleFigure.js" },
        "Undo after a rotation restores the original position"
      ]
    },
    "connection": {
      "summary": "The user drags the handle; the editor asks the figure for its handles, which now pivot on the centre.",
      "technical": "`DrawingEditor` routes the drag to `RectangleFigure#handlesAt`, which ...",
      "steps": [
        { "title": "Drag the rotate handle", "user": "The shape turns in place.",
          "tech": "`handlesAt(options)` returns the centre as the pivot.",
          "visuals": [{ "kind": "video", "src": "tmp/review/ABC-123/rotate.webm" }],
          "groups": ["The rotation fix"], "files": ["app/javascript/drawing/RectangleFigure.js"],
          "checks": ["centre"] }
      ]
    },
    "shape": {
      "summary": "A one-line change repeated in four figures; no new objects.",
      "layers": ["drawing"],
      "objects": [
        { "name": "RectangleFigure#handlesAt", "status": "changed", "note": "takes options instead of a bare scale",
          "path": "app/javascript/drawing/RectangleFigure.js" }
      ],
      "dependencies": [],
      "departures": ["The same signature change is copied into four figures; `CompositeFigure` could own it."],
      "codebase": "Nothing grows. The figures now agree with `CompositeFigure`'s signature, which removes a special case.",
      "areas": [{ "label": "figures", "prefix": "app/javascript/drawing/" }]
    },
    "diagrams": [
      { "kind": "sequence", "title": "Rotating a shape", "section": "feature", "actors": [...], "messages": [...] },
      { "kind": "structure", "title": "Who calls handlesAt", "section": "shape", "layers": [...], "nodes": [...], "edges": [...] },
      { "kind": "compare", "title": "Pivot point", "group": "The rotation fix", "before": {...}, "after": {...} }
    ]
  }
}
```

## The feature

- **`summary`**: what someone using the product can now do, or what was broken
  and now isn't. Product language, one or two sentences. Take it from the
  ticket or PR body, then check it against the diff: if the code does more,
  less, or something else than the ticket says, say so here. That mismatch is
  the most valuable thing the overview can surface.
- **`behavior`**: the walkthrough, before and after, from the user's side, in
  product language.
  Markdown. Use it when the change alters a flow; skip it for a pure refactor.
- **`checks`**: the behaviour worth confirming, each with a `kind`:
  - `"does"` (the default): behaviour the change actually implements, read from
    the code but written as what a person sees ("Opening the old All Projects
    page now shows a not-found page"). The page tags it **Does**; the
    reviewer confirms it works and is wanted.
  - `"should"`: behaviour the change ought to have but doesn't, a gap you found
    ("A placed order should not be reopened from a second tab, but nothing
    stops it"). The page tags it **Should**. Usually pair it with a
    recommendation that names the fix.
  Never write a `does` check for something you haven't seen in the code. Things a reviewer can verify
  in the app or by reasoning, not code-style remarks. Edge cases the change
  touches (empty, the largest case, undo, permissions, a second user, an
  existing record created before this change), interactions with neighbouring
  features, and anything the ticket asked for that you couldn't find in the
  diff. 3 to 7 is the usual range; zero is fine for a trivial change. Each has
  `text` (Markdown, product language, no code) and optional `how` (steps to
  check in the app, as a person would: "Open the order in two tabs, place it in
  one, edit it in the other"). Leave out `path`: the file behind a check is a
  code detail, and the recommendations link to it. The reviewer marks each **Looks right** or **Concern**;
  concerns and their notes are added to the review summary when it is posted.

  Write checks you actually have reason to raise. Follow the user's
  suggested-comments preference here too: no hypotheticals if they asked for
  none.

## CI

With `--pr`, the build reads the PR's checks (`gh pr checks`) and the page
puts them at the top of the overview: failing and running checks listed with
links, passing ones folded away. The sidebar shows the same in a word, and the
submit page warns before approving a red build. The status is as of the build;
rebuild to refresh it. You don't write anything for this, but when a check
fails, say so in your report, and look at whether the failure is in the code
under review before writing recommendations about it.

## From the PR description

With `--pr`, the build pulls in the PR's description and downloads its
screenshots and recordings (GitHub attachments, with the `gh` token). The page
shows them in a strip, and keeps the full description folded away under them.
You write the digest above them under `author`:

- **`summary`**: what the author says the change does and why, condensed to a
  sentence or two, in product language even when the author wrote in code. Keep their reasoning and any context the diff can't show:
  the feedback that prompted it, what they tested, what they left for later.
- **`points`**: up to four short bullets for the rest worth keeping (testing
  notes, known gaps, follow-ups, deploy steps).
- **`differs`**: where the code does something the description doesn't say,
  or doesn't do something it says. Shown in a warning box, so only real ones.

Run `scripts/pr-media.cjs --pr <N>` while gathering, before writing the
overview: it saves the description's media to `tmp/review/pr-<N>/description/`
and prints each file with the heading it sat under. Reuse those files as
`image`/`video` visuals in the feature overview; the build reads the same
cache. If the description is empty, there is nothing to digest: leave `author` out.

## The feature overview

(It goes under the `connection` key, its name before it was renamed.)

The section that pulls it all together: how the feature works end to end, for
the person using it, in one place. A reviewer who reads it
should be able to say how the pieces connect, and the checks should read as
part of that story rather than a separate list. Make it **as visual as you
can**: a screenshot or short recording for each step a person can see. For a
step that happens out of sight (a sync, an email, a background job), draw it
as what the person would notice, in plain words, not as objects calling each
other; object diagrams belong in the shape.

- **`summary`**: the whole flow in one or two sentences, from the user's
  action to the result.
- **`technical`**: leave it out. How it works underneath belongs in the shape
  and the recommendations.
- **`steps`**: the flow in order, usually 2 to 6. Each step has:
  - `title`: the step, in the user's words where there is a user;
  - `user`: what the person sees or does (Markdown);
  - `tech`: no longer shown. The step's group links lead to the
    recommendations and the code, which carry the technical detail; leave it out;
  - `visuals`: diagrams or media for this step (any diagram kind, including
    `image` and `video`). Screenshots from the PR description are often the
    right picture here. A step with no visuals takes the full width;
  - `groups`: reading-guide group titles that implement it. They link to the
    group's Recommendations card;
  - `files`: leave out; the group links lead to the code;
  - `checks`: ids of feature checks (give those checks an `id`). They show in
    the step instead of under the feature.
- Diagrams with `"section": "connection"` show above the steps: the place for
  one end-to-end sequence diagram.

Capture screenshots and recordings with Playwright or the Chrome extension
(recipes in `references/recommendations.md`). When the app can't run, use the
PR description's media and diagrams, and say in your report that nothing was
captured.

## The shape

The shape is the structure of the change and what it does to the code around
it. It answers: which layers and objects, which direction the dependencies run,
and whether the code is better or worse arranged afterwards.

- **`summary`**: the shape of *this change* in a sentence or two, e.g. "Discount
  math moved from the PDF template into `InvoiceTotals`; the PDF now only
  formats."
- **`layers`**, **`objects`** (`name`, `status`: new / changed / removed,
  `note`: its responsibility in one line, optional `path`), **`dependencies`**
  (new libraries or new cross-layer imports, as strings or `{name, note}`):
  the same mapping as the `code-shape` pipeline skill.
- **`departures`**: where the change breaks the project's architecture
  instructions (AGENTS.md / CLAUDE.md and their modules): logic in the wrong
  layer, an object with two jobs, a new pattern where an existing one fits,
  duplication that wants a shared home. Strings, or `{text, path, line}`. Shown
  in a warning box, so only list real ones.
- **`codebase`**: how the change moves the shape of the codebase *as a whole*,
  not just the diff. Did a file that was already large grow, did responsibility
  spread across more places or consolidate into fewer, did a layer gain a
  dependency it didn't have, did a special case disappear? Read the touched
  files at the head, not only the hunks, to answer this.
- **`areas`**: optional `{label, prefix}` buckets for the "Where the change
  lands" bars. Without them, files are bucketed by their first three directories.

**Always draw the shape.** Every overview gets one `structure` diagram with
`"section": "shape"` that maps the change. Put the objects it touches in their
layers and mark each one `new`, `changed` or `removed`. Add the untouched
neighbours they talk to as `same` for context, and mark the edges the same way.
It is the most useful picture on the page, because it shows at a glance what
was added and what changed. Skip it only when the change touches no code
structure at all (copy, config, a dependency bump), and say so in the report.

The page adds two computed blocks under the shape, from git, that you don't
write: **Where the change lands** (lines changed per area) and **How the
codebase's shape moved** (each touched file's length before and after, sorted
by growth, with a badge when a file crosses 400 lines). Use them: if the
numbers show a file doubling, `codebase` should say why that's fine or not.

## Diagrams

**Draw the picture that's missing.** Wherever a reader would have to build an
image in their head from your words, draw it for them instead. There is no
quota and no required form: a diagram is any picture that makes a section
quicker to understand, and the right one is whatever suits that section.

- **Mock what you can't capture.** No screenshot of the new dialog, the PDF
  page, the email, the error state? Sketch it: a rough screen with the changed
  part outlined beats a paragraph describing it. Same for a before/after of a
  screen when only one side can be captured.
- **Draw the data, not just the code.** A record before and after the
  migration, the rows a query now returns, the JSON a request sends, a
  permissions matrix: a small table or a pair of boxes says it at a glance.
- **Draw time.** What happens on save, which job runs when, the order of
  retries: a timeline or a sequence.
- **Draw space.** Geometry, layout, positions, sizes: an SVG with the real
  shapes, old dashed and new solid.
- **Draw amounts.** A query count that drops, a file that doubles, a limit
  that moves: a few bars.
- **Draw the argument.** For a recommendation, the risk or the proposal as a
  picture: the two paths that now disagree, the box that has two jobs, the
  case nobody handles marked with a pin and a note.

Boxes, lines, arrows, labels and notes in any arrangement are fine. Mix forms in
one picture when that's clearer (a sketch of a screen with a note pointing at
the button, next to the request it sends). The `structure` and `sequence`
kinds are shortcuts for two common shapes, not the menu; reach for `html` or
`svg` whenever they don't fit. Keep each picture to one idea, with a title
that says what to notice, and let the caption carry anything it can't show.

Every diagram has `kind`, optional `title` and `caption` (Markdown), and where
it shows:

- `section`: `"feature"`, `"connection"` or `"shape"`, in the overview, or `"recs"`, at the
  top of the code step's Recommendations view. Default `"feature"`.
- `group`: the exact `title` of a reading-guide group. The diagram is then shown
  on that group's card in the Recommendations view and under its header in the
  Code view, next to the code it explains. This is the place for the complex
  parts of a change. With `group` and no `section`, it appears only there; give
  both to show it in both places.

Every drawn diagram gets an expand button in its corner that opens it to fill
the window, with its text still selectable (each side of a `compare` expands
on its own); screenshots open on click. A diagram can also
sit on a recommendation, under its `visuals` (`references/recommendations.md`).

Screenshots and screen recordings are diagrams too: `{"kind": "image" | "video",
"src": "<file>"}`, inlined by the build. Use them for any UI change. Format,
limits and how to capture them: `references/recommendations.md`.

### Parts: steps, pins and marks

Every part of a diagram (a node or edge, an actor or message, a table row, a
timeline event, a mark) can carry:

- `step`: the connection step it belongs to (a number, or a list). See the map
  below.
- `pin`: a number drawn on the part, so prose can say "the button at ②".
- `status`: `new`, `changed`, `removed` or `same`, on every kind, with one
  legend.

Hovering a box traces it: its lines and neighbours light up, and a line under
the picture names it, its `note`, and
what it connects to. Hovering a line lights its two ends. The build fails on a
step that doesn't exist.

**Marks** go on an `image`, `video`, `html` or `svg` diagram:
`"marks": [{ "x": 38, "y": 42, "w": 22, "h": 6, "status": "new", "pin": 1, "label": "Organization: new" }]`.
`x`, `y`, `w` and `h` are percent of the picture; leave out `w` and `h` for a
point. Ring the part that matters with a mark instead of drawing a box into the
screenshot. Marks stay on when the picture opens full size. On an `html` or
`svg` sketch, a mark can name its target instead of coordinates,
`{ "at": ".ui-select", "pin": 1, "label": "New" }`, and is placed around that
element. In a sketch, any element can also carry `data-step="2"` directly.

Keep diagrams about the product, not the code: what a person sees, does and
what happens to their data. Code belongs in the Shape step and the groups.

### Diagrams that build

Any diagram whose parts carry `step` builds: it shows whole, with its steps as
breadcrumbs under it, and moves through them in place. At each step that step's
parts draw in, earlier ones stay faint and later ones are hidden. Its expand
button opens a full-screen walkthrough with the breadcrumbs above and Previous
and Next below; the arrow keys and the scroll wheel move through it too. Name
the steps with `"stages": ["Today", "Review is added", ...]`; without them
they read "Step 1", "Step 2". Use it to tell a change in order: what exists
today, then each thing the change adds.

### The map: required for "How it comes together"

With two or more connection steps, give one diagram `"section": "connection"`
whose parts name their steps; its stages are the steps' titles. It shows whole
above the steps, and a small copy floats beside the steps while they're on
screen, lit at the step being read. Clicking it opens the walkthrough at that
step. An edge with no `step` appears with the
later of its two ends; a part with no step is context, always faint. The build
fails without a map, or with one that tags no part.

Draw the feature end to end in product language, usually a `flow` or a
`structure` with a layer per place the person goes. Tag every node with the
first step it matters in.

```json
{ "kind": "flow", "section": "connection", "title": "Starting a project for a company",
  "nodes": [
    { "id": "open", "label": "Opens New Project", "shape": "start", "step": 1 },
    { "id": "pick", "label": "Picks the company", "status": "new", "step": 2, "pin": 1 },
    { "id": "many", "label": "In more than one?", "shape": "decision", "step": 2 },
    { "id": "save", "label": "Project saved to that company", "status": "changed", "step": 3 },
    { "id": "done", "label": "Sees it in the list", "shape": "end", "step": 3 }
  ],
  "edges": [["open", "many"], ["many", "pick", "yes"], ["many", "save", "no"], ["pick", "save"], ["save", "done"]] }
```

### `flow`: steps and decisions

`nodes` with an optional `shape` (`step`, the default; `decision`, a diamond;
`start` and `end`, pills) and `edges` as in `structure`. There are no layers:
each node is placed by its longest path from a start, so the flow reads top to
bottom, and an edge back to an earlier node (a retry, "back to edit") climbs
instead of tangling the order.

### `states`: a state machine

`states` (strings or `{ id, label, status, initial, final }`) and
`transitions` (`[from, to, label, status]`), laid out like a flow with each
state as a pill. Mark a new state or transition `new`, and one that goes away
`removed`.

```json
{ "kind": "states", "title": "A project's status",
  "states": [{ "id": "draft", "label": "Draft", "initial": true }, { "id": "review", "label": "In review", "status": "new" }, "Active", { "id": "closed", "label": "Closed", "final": true }],
  "transitions": [["draft", "review", "submit", "new"], ["review", "Active", "approve", "new"], ["review", "draft", "send back", "new"], ["draft", "Active", "publish", "removed"], ["Active", "closed", "close"]] }
```

### `table`: a matrix with changes marked

`columns` and `rows`; a row is a list of cells or `{ "cells": [...], "status" }`,
and a cell is a value or `{ "v": "Edit", "was": "View", "status": "changed" }`.
The first cell heads its row. For who can do what, prices by plan, settings by
environment.

### `timeline`: events in order

`events`: strings or `{ "label", "at", "note", "status", "pin" }`, along a line
left to right. For what happens on save, a job's retries, a rollout.

### `structure`: objects in layers

The `code-shape` format. Layers run top to bottom in the order given; nodes
are boxes, edges are arrows. Keep it under about 15 nodes.

```json
{ "kind": "structure", "title": "Where rotation lives now",
  "layers": ["editor", "figures", "model"],
  "nodes": [
    { "id": "ed", "label": "DrawingEditor", "layer": "editor" },
    { "id": "rh", "label": "RectangleFigure", "layer": "figures", "status": "changed", "sub": "handlesAt()", "note": "tooltip" },
    { "id": "rot", "label": "RotationHelper", "layer": "model", "status": "new" },
    { "id": "old", "label": "pivotAtCorner", "layer": "figures", "status": "removed" }
  ],
  "edges": [["ed", "rh", "rotate"], ["rh", "rot", "uses", "new"], { "from": "ed", "to": "old", "status": "removed" }] }
```

**Keep it readable.** A structure diagram shows how a reviewer should read the
change, not every dependency. Keep every box the change adds, changes or
removes, but draw only the lines that explain how they fit: aim for fewer
lines than boxes. When several paths run through the same layers (each screen
reaching its own controller, policy and model), give each path a `step` so the
diagram builds one path at a time instead of showing a web. A line that skips a
layer usually means a box is in the wrong layer. The build warns when a diagram
has many more lines than boxes, or several lines that skip layers.

`status` on nodes and edges is `new` (green), `changed` (amber), `removed`
(red, dashed) or `same` (default), shown as a dot in the box. Drawing removed
and new parts in one diagram is usually the clearest way to show a shape
change. Lines are routed, not curved: each runs across the gap between two
layers on its own track, and a line that skips a layer drops through a clear
lane between that layer's boxes. Lines meeting at a box join into one trunk
with one arrowhead, and each box is placed under the boxes it connects to. Order nodes in a layer roughly as you'd like
them; the layout reorders them to cut crossings.

### `sequence`: who calls whom, in order

```json
{ "kind": "sequence", "title": "Rotating a shape",
  "actors": ["User", "Editor", { "id": "Fig", "label": "RectangleFigure", "status": "changed" }],
  "messages": [
    ["User", "Editor", "drags the rotate handle"],
    ["Editor", "Fig", "rotate(angle, centre)", "changed"],
    { "from": "Fig", "to": "Editor", "label": "new bounds", "reply": true },
    { "divider": "on mouse up" },
    ["Editor", "Editor", "autosave"]
  ] }
```

`reply: true` draws a dashed return arrow; a message to the same actor draws a
loop; `divider` separates phases.

### `compare`: before and after

`{ "kind": "compare", "before": <diagram>, "after": <diagram> }`, side by side.
Each side is any other kind, its `title` replaces the "Before"/"After"
label, and each side expands on its own. If a change is better told in steps
than as two states, draw one diagram that builds instead.

### `model`: records and what they point at

For a migration or a new table: each record a card of its fields, and a line
from each reference field to the record it points at. Records others point at
stand on the left.

```json
{ "kind": "model", "title": "Projects now belong to a company", "entities": [
  { "id": "company", "label": "Company", "status": "new",
    "fields": [{ "name": "id", "key": "pk", "type": "bigint" }, { "name": "name", "type": "string" }] },
  { "id": "project", "label": "Project", "status": "changed", "fields": [
    { "name": "company_id", "to": "company", "status": "new" },
    { "name": "visibility", "type": "enum", "was": "boolean", "status": "changed" },
    { "name": "user_id", "type": "bigint", "status": "removed" } ] }
] }
```

A field takes `type`, `key: "pk"`, `to` (the record it points at, which draws
the line), `was` (its old type, struck through) and `status`. `links` adds a
line between two records with no field behind it. Show the fields a reviewer
needs, not every column.

### `journey`: the screens a person moves through

A storyboard: sketched screens left to right, each arrow saying what the
person does to reach the next. Better than a flow when the change is to what
people see.

```json
{ "kind": "journey", "title": "Starting a project in a second company", "screens": [
  { "title": "Projects", "then": "clicks New project", "html": "<div class='screen'><div class='body'>…</div></div>" },
  { "title": "New project", "status": "new", "then": "picks Acme, saves", "html": "…" },
  { "title": "Warehouse", "status": "changed", "note": "The company shows under the title.", "html": "…" }
] }
```

Each screen's `html` uses the sketch classes below. `then` labels the arrow to
the next screen; `width` (default 230) sizes a screen; `step` makes it build.

To make it clickable, give screens an `id` and mark an element in a screen's
sketch with `data-next="<screen id>"` (the button the person presses). The
marked parts are outlined; clicking one shows that screen on its own, larger.
Its screens are then its steps: breadcrumbs under it name each screen, with
All screens first, and follow the clicks, and the arrow keys and the
walkthrough move through them too (so leave out `step` and `stages`). Nothing runs: it only moves between the screens
you drew, so it shows the path, not behaviour the code may not have. Use it
when the app couldn't be recorded or the path spans several screens; a
recording of the real app is better when there is one.

### `html` and `svg`: anything else

Hand-written markup in `html` or `svg`: UI mockups, records and tables,
timelines, geometry, state machines, annotated sketches, little charts, or
anything else. It renders in a shadow root, so it can't break the
page, and it is static: `<script>` and `on*` attributes are removed. The page's
colour variables inherit, so use them and it works in light and dark mode:
`var(--text)`, `var(--muted)`, `var(--border)`, `var(--panel)`, `var(--bg)`,
`var(--accent)`, `var(--add-b)` / `var(--add-bg)`, `var(--del-b)` / `var(--del-bg)`.

Ready-made classes:

- Layout: `.row` (flex row), `.col`, `.grid` (set `--cols`), `.box` (with
  `.new`, `.changed`, `.removed`), `.arrow` (→), `.down` (↓), `.tag`, `.title`,
  `.muted`, `.small`, `.add`, `.del`, `.accent`, plain `table`.
- Sketching:
  - `.screen` with a `.bar` (window title) and a `.body`: a rough app window.
    Inside it, `.ui-btn` (`.primary`), `.ui-input`, `.ui-line` (a grey text
    placeholder; set `--w`), `.ui-img` (an image placeholder).
  - `.hl` outlines what to look at (`.hl.new`, `.hl.removed` recolour it);
    `.ghost` fades something that isn't there yet or is going away; `.cross`
    marks a removed value in red.
  - `.note`: a sticky note; `.pin`: a numbered dot to tie a spot to a note.
  - `.timeline`: its children become points on a line (`.new`, `.removed`,
    `.ghost` colour the dot).
  - `.meter`: a three-column grid of label, `<i style="--v:40%">` bar, value,
    for amounts before and after.
- More of the app:
  - Frames: `.screen.browser` (its `.bar` shows `data-url`), `.phone` with a
    `.body` (set `--w`, `--h`).
  - Controls: `.ui-select`, `.ui-check`, `.ui-radio`, `.ui-toggle` (add `.on`),
    `.ui-tabs` and `.ui-nav` (children, one `.on`), `.ui-menu`, `.ui-chip`,
    `.ui-avatar`, `.ui-badge`.
  - Content: `.ui-card`, `.ui-empty`, `.ui-banner`, `.ui-toast` (`.new`,
    `.removed`), `.ui-table` (rows take `.new`, `.removed`, `.changed`).
  - Overlays: `.scrim` around a `.modal`; `.click` puts a pointer on an
    element, `.cursor` is a pointer on its own.
- Forms, navigation and mail:
  - Forms and feedback: `.ui-field` (a label over a control; `.error` with a
    `.ui-error` line, or a `.ui-hint`), `.ui-textarea`, `.ui-search`,
    `.ui-date`, `.ui-upload`, `.ui-slider` and `.ui-progress` (set `--v`),
    `.ui-spinner`, `.ui-skeleton` (set `--w`, `--h`), `.ui-tooltip`.
  - Navigation and layout: `.ui-crumbs`, `.ui-pager` and `.ui-stepper`
    (children; one `.on`, earlier ones `.done`), `.ui-header` (a `.title` and
    actions), `.ui-app` (a `.ui-nav` beside the main area), `.ui-drawer`,
    `.ui-list` (rows take `.new`, `.removed`, `.changed`, `.on`), `.ui-link`,
    `.ui-kbd`, `.ui-bars` (`<i style="--v:40%">` bars).
  - `.email` with a `.head` (label and value pairs) and a `.body`.
- Data, as a person would see it:
  - `.record` with a `.title` and `<div><span>Label</span><span>value</span></div>`
    rows (`.new`, `.removed`, `.changed`).
  - `.flow` (`.flow.v` vertical) draws arrows between its children; `.state` is
    a state pill, so a `.flow` of `.state`s is a small state machine.
  - `.split`: two children labelled Before and After.
- SVG: strokes `.s-new`, `.s-old` (red dashed), `.s-changed`, `.s-muted`,
  `.s-accent`; fills `.f-new`, `.f-old`, `.f-panel`, `.f-accent`. Text is
  already themed. Give the `<svg>` a `viewBox` and it scales to fit.

```json
{ "kind": "svg", "title": "Shape rotated 90°", "group": "The rotation fix",
  "svg": "<svg viewBox='0 0 220 120'><rect x='20' y='20' width='60' height='40' fill='none' class='s-old'/><rect x='110' y='30' width='40' height='60' class='f-new s-new'/><circle cx='130' cy='60' r='3' class='f-accent'/><text x='20' y='110' class='muted'>old pivot: corner · new pivot: centre</text></svg>" }
```

For drawing domain geometry (a floor plan, a shape, a row of points), an SVG
like this beats any box diagram: show the actual before and after positions.

A mocked screen, for a dialog the review couldn't capture:

```json
{ "kind": "html", "title": "Archiving now asks first", "caption": "Sketch; the app wasn't running.",
  "html": "<div class='row' style='align-items:flex-start'><div class='screen' style='width:260px'><div class='bar'>Archive project?</div><div class='body'><div class='ui-line' style='--w:90%'></div><div class='ui-line' style='--w:70%'></div><div class='row hl new' style='justify-content:flex-end'><span class='ui-btn'>Cancel</span><span class='ui-btn primary'>Archive</span></div></div></div><span class='note'><span class='pin'>1</span> New: Cancel is the default, so Enter no longer archives.</span></div>" }
```

A record before and after, and a timeline:

```json
{ "kind": "html", "title": "What a re-sync does to an order",
  "html": "<div class='grid'><table><tr><th>status</th><td>shipped</td></tr><tr><th>synced_at</th><td class='cross'>2 days ago</td></tr></table><table><tr><th>status</th><td>shipped</td></tr><tr><th>synced_at</th><td class='add'>now</td></tr></table></div><div class='timeline' style='margin-top:12px'><div>Webhook arrives</div><div class='new'>Lock the order</div><div>Update</div><div class='ghost'>Email (skipped)</div></div>" }
```

### Linking diagrams

Give a diagram an `id`, and any part of another diagram can open it: add
`"link": "data"` to a node, record, field, screen, row or event, or
`data-link="data"` to an element in a sketch. `"link": "data#project"` also
flashes the part with the id `project` (a node's or record's `id`, a screen's
`id`, or `data-id` in a sketch). The target can be on another step of the page;
a Back button returns to where the reader clicked. Link pictures that explain
each other: a step in the flow to the screen it shows, a screen to the records
it saves. The build fails on a link to an id that doesn't exist.

## Checking it

The build validates the overview with the guide (and inlines any `image` or
`video` files, printing a `media:` line): every connection step has a title and
names real groups, files and check ids, every check has text, every
`path` is in the diff, every diagram's kind is known and its edges and messages
name real nodes and actors, and every `group` names a real group. It prints

```
overview ok: feature, 4 check(s), connection (3 step(s), 4 visual(s), 2 check(s) placed), author, shape, 3 diagram(s) (1 in groups)
```

or fails with the problem. It cannot tell whether a diagram is *readable*: a
long label can still run past its box. If a diagram is crowded, split it.
