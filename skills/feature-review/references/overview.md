# Writing the overview (step 1)

The page reviews in three steps: **Overview**, **Code**, **Submit**. The
overview comes first and is about the *feature* and the *shape* of the change,
not lines of code. It reads top to bottom: what the PR's author said, the
feature and its checks, the **feature overview** (how it all fits together,
with visuals), then the shape. A reviewer who reads only the overview should know what the
change does for the user, whether it does it well, and how it rearranges the
code. The diff is the fallback: the place to confirm what the overview says.

It goes in the same `tmp/review/<slug>.groups.json` as the reading guide, under
`overview`. Every key is optional. Leave out what you have nothing true to say
about: an empty section is better than filler.

```json
{
  "groups": [ ... ],
  "suggestions": [ ... ],
  "overview": {
    "author": {
      "summary": "Rhys says this fixes **distributor admins not seeing Order Tracking** and makes the tracker's states clearer.",
      "points": ["Two specs marked obsolete, kept for later"],
      "differs": "The description says the specs were *marked* obsolete; the diff deletes them."
    },
    "feature": {
      "summary": "Rotating a **roof hatch** turns it about its centre instead of its corner.",
      "behavior": "Before: the hatch swung around its origin and left the roof outline. After: it turns in place.",
      "checks": [
        { "id": "centre", "text": "Rotating a hatch 90° keeps its centre in place",
          "how": "Place a hatch, rotate it with the handle, compare the centre before and after.",
          "path": "app/javascript/shared/drawings2D/RoofHatchFigure.js" },
        "Undo after a rotation restores the original position"
      ]
    },
    "connection": {
      "summary": "The user drags the handle; the editor asks the figure for its handles, which now pivot on the centre.",
      "technical": "`SayfaDrawingEditor` routes the drag to `RoofHatchFigure#handlesAt`, which ...",
      "steps": [
        { "title": "Drag the rotate handle", "user": "The hatch turns in place.",
          "tech": "`handlesAt(options)` returns the centre as the pivot.",
          "visuals": [{ "kind": "video", "src": "tmp/review/KATT-1/rotate.webm" }],
          "groups": ["The hatch fix"], "files": ["app/javascript/shared/drawings2D/RoofHatchFigure.js"],
          "checks": ["centre"] }
      ]
    },
    "shape": {
      "summary": "A one-line change repeated in four figures; no new objects.",
      "layers": ["drawings2D"],
      "objects": [
        { "name": "RoofHatchFigure#handlesAt", "status": "changed", "note": "takes options instead of a bare scale",
          "path": "app/javascript/shared/drawings2D/RoofHatchFigure.js" }
      ],
      "dependencies": [],
      "departures": ["The same signature change is copied into four figures; `CompositeFigure` could own it."],
      "codebase": "Nothing grows. The figures now agree with `CompositeFigure`'s signature, which removes a special case.",
      "areas": [{ "label": "figures", "prefix": "app/javascript/shared/drawings2D/" }]
    },
    "diagrams": [
      { "kind": "sequence", "title": "Rotating a hatch", "section": "feature", "actors": [...], "messages": [...] },
      { "kind": "structure", "title": "Who calls handlesAt", "section": "shape", "layers": [...], "nodes": [...], "edges": [...] },
      { "kind": "compare", "title": "Pivot point", "group": "The hatch fix", "before": {...}, "after": {...} }
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
- **`behavior`**: the walkthrough, before and after, from the user's side.
  Markdown. Use it when the change alters a flow; skip it for a pure refactor.
- **`checks`**: the behaviour worth confirming, as things a reviewer can verify
  in the app or by reasoning, not code-style remarks. Edge cases the change
  touches (empty, the largest case, undo, permissions, a second user, an
  existing record created before this change), interactions with neighbouring
  features, and anything the ticket asked for that you couldn't find in the
  diff. 3 to 7 is the usual range; zero is fine for a trivial change. Each has
  `text` (Markdown), optional `how` (steps to check), and optional `path` (a file
  in the diff, linked). The reviewer marks each **Looks right** or **Concern**;
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
  sentence or two. Keep their reasoning and any context the diff can't show:
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
the person using it and in the code, in one place. A reviewer who reads it
should be able to say how the pieces connect, and the checks should read as
part of that story rather than a separate list. Make it **as visual as you
can**: a screenshot or short recording for each step a person can see, and a
sequence or structure diagram for the steps they can't.

- **`summary`**: the whole flow in one or two sentences, from the user's
  action to the result.
- **`technical`**: how it works underneath, at overview height: the entry
  point, the objects that do the work, where the data lives, in a short
  paragraph. Not a file list.
- **`steps`**: the flow in order, usually 2 to 6. Each step has:
  - `title`: the step, in the user's words where there is a user;
  - `user`: what the person sees or does (Markdown);
  - `tech` (optional): what runs, folded under "Under the hood" and closed by
    default. One plain sentence naming the object or two that do the work, not
    a walk through the code. Leave it out when the step's groups and files
    already say enough;
  - `visuals`: diagrams or media for this step (any diagram kind, including
    `image` and `video`). Screenshots from the PR description are often the
    right picture here. A step with no visuals takes the full width;
  - `groups`: reading-guide group titles that implement it. They link to the
    group's Recommendations card;
  - `files`: files in the diff, linked to their diff;
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

The page adds two computed blocks under the shape, from git, that you don't
write: **Where the change lands** (lines changed per area) and **How the
codebase's shape moved** (each touched file's length before and after, sorted
by growth, with a badge when a file crosses 400 lines). Use them: if the
numbers show a file doubling, `codebase` should say why that's fine or not.

## Diagrams

Draw a diagram where it explains something faster than prose: a flow through
several objects, a responsibility moving from one place to another, geometry,
a state machine, a before/after. Prefer one or two good diagrams to many. Every
diagram has `kind`, optional `title` and `caption` (Markdown), and where it
shows:

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

### `structure`: objects in layers

The `code-shape` format. Layers run top to bottom in the order given; nodes
are boxes, edges are arrows. Keep it under about 15 nodes.

```json
{ "kind": "structure", "title": "Where rotation lives now",
  "layers": ["editor", "figures", "model"],
  "nodes": [
    { "id": "ed", "label": "SayfaDrawingEditor", "layer": "editor" },
    { "id": "rh", "label": "RoofHatchFigure", "layer": "figures", "status": "changed", "sub": "handlesAt()", "note": "tooltip" },
    { "id": "rot", "label": "RotationHelper", "layer": "model", "status": "new" },
    { "id": "old", "label": "pivotAtCorner", "layer": "figures", "status": "removed" }
  ],
  "edges": [["ed", "rh", "rotate"], ["rh", "rot", "uses", "new"], { "from": "ed", "to": "old", "status": "removed" }] }
```

`status` on nodes and edges is `new` (green), `changed` (amber), `removed`
(red, dashed) or `same` (default). Drawing removed and new parts in one
diagram is usually the clearest way to show a shape change.

### `sequence`: who calls whom, in order

```json
{ "kind": "sequence", "title": "Rotating a hatch",
  "actors": ["User", "Editor", { "id": "Fig", "label": "RoofHatchFigure", "status": "changed" }],
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
Each side is any other kind, and its `title` replaces the "Before"/"After"
label.

### `html` and `svg`: anything else

Hand-written markup in `html` or `svg`, for geometry, layouts, state machines,
tables, or UI sketches. It renders in a shadow root, so it can't break the
page, and it is static: `<script>` and `on*` attributes are removed. The page's
colour variables inherit, so use them and it works in light and dark mode:
`var(--text)`, `var(--muted)`, `var(--border)`, `var(--panel)`, `var(--bg)`,
`var(--accent)`, `var(--add-b)` / `var(--add-bg)`, `var(--del-b)` / `var(--del-bg)`.

Ready-made classes:

- Layout: `.row` (flex row), `.col`, `.grid` (set `--cols`), `.box` (with
  `.new`, `.changed`, `.removed`), `.arrow` (→), `.down` (↓), `.tag`, `.title`,
  `.muted`, `.small`, `.add`, `.del`, `.accent`, plain `table`.
- SVG: strokes `.s-new`, `.s-old` (red dashed), `.s-changed`, `.s-muted`,
  `.s-accent`; fills `.f-new`, `.f-old`, `.f-panel`, `.f-accent`. Text is
  already themed. Give the `<svg>` a `viewBox` and it scales to fit.

```json
{ "kind": "svg", "title": "Hatch rotated 90°", "group": "The hatch fix",
  "svg": "<svg viewBox='0 0 220 120'><rect x='20' y='20' width='60' height='40' fill='none' class='s-old'/><rect x='110' y='30' width='40' height='60' class='f-new s-new'/><circle cx='130' cy='60' r='3' class='f-accent'/><text x='20' y='110' class='muted'>old pivot: corner · new pivot: centre</text></svg>" }
```

For drawing domain geometry (a roof plan, a hatch, a line of anchors), an SVG
like this beats any box diagram: show the actual before and after positions.

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
