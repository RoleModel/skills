# Diagrams

Slides draw their diagrams with `diagrams.js`, vendored unchanged from
feature-review, so both skills speak the same diagram language. A diagram is
data: you describe the boxes and arrows, and it does the layout. There is no
Mermaid in the presenter, and the page works offline.

Every diagram has a `kind`, plus an optional `title` (shown as the block's
heading), `caption` (a line of plain text underneath) and `legend` (below).
The diagram should show what's actually in the code or the card, never what
you assume.

## Which kind for which slide

| Slide | Usually | Why |
|---|---|---|
| `picture` | `compare` or `svg` | Before and after, or the real geometry of the problem |
| `approach` | `structure`, or `compare` of two options | The objects that change, in layers |
| `scope` | `structure` | The affected areas, with the in/out boundary coloured |
| `risks` | `sequence` or `structure` | The order in which things go wrong |
| `deps` | `structure` with layers such as `before`, `this card`, `after` | What lands first |

## Colour: `status` and `legend`

Nodes and edges take `status`: `new` (green), `changed` (amber), `removed`
(red, dashed, struck through) or `same` (the default, plain). A legend appears
whenever more than one is used.

The default legend reads "new", "changed", "removed". Relabel it for the slide
with `legend`, so the colours say what the slide means:

```json
"legend": {"new": "In", "changed": "To discuss", "removed": "Out"}
```

The legend also relabels the small status tags above the boxes, and `same`
can be relabelled too (it reads "unchanged" by default). Use amber
(`changed`) for whatever the slide's question is about. `removed`
strikes its text through, so use it for things that go away or are excluded,
not for problems. Draw a problem as an amber node, or in `svg`.

## `structure`: boxes in layers

Layers run top to bottom in the order given. Keep it to about 12 nodes and
labels of about 30 characters; put detail in `sub` (a second line) or `note`
(a tooltip).

```json
{ "kind": "structure", "title": "Where the us? checks go",
  "layers": ["project", "gates"],
  "nodes": [
    { "id": "m", "label": "project.available_service_options", "layer": "project", "status": "new" },
    { "id": "a", "label": "ServiceOption#active?", "layer": "gates", "status": "changed" },
    { "id": "f", "label": "service_options_for_form", "layer": "gates", "status": "changed", "sub": "not on the card" }
  ],
  "edges": [["m", "a"], ["m", "f", "replaces us?"]],
  "legend": {"new": "Added", "changed": "To discuss"} }
```

An edge is `[from, to]`, `[from, to, label]`, `[from, to, label, status]`, or
`{"from", "to", "label", "status"}`.

## `sequence`: who does what, in order

```json
{ "kind": "sequence", "title": "Deploying one app alone",
  "actors": ["Roofs", "Builda"],
  "messages": [
    ["Roofs", "Builda", "GET /linked_configurations", "changed"],
    { "from": "Builda", "to": "Roofs", "label": "404", "reply": true },
    { "divider": "after both deploy" },
    ["Roofs", "Builda", "GET /linked_configurations"]
  ] }
```

`reply: true` draws a dashed return arrow, a message to the same actor draws a
loop, and `divider` separates phases.

## `compare`: two pictures side by side

`{"kind": "compare", "before": <diagram>, "after": <diagram>}`. Each side is any
other kind, and its `title` replaces the "Before"/"After" label, which makes it
good for two options as well as before and after.

## `svg` and `html`: anything else

Hand-written markup for real geometry (a plan view, a ladder, a platform),
layouts, tables or UI sketches. It renders in a shadow root and is static:
scripts and `on*` attributes are removed. Give an `<svg>` a `viewBox` and it
scales to fit.

Colours come from the page: `var(--text)`, `var(--muted)`, `var(--border)`,
`var(--panel)`, `var(--bg)`, `var(--accent)`, `var(--add-b)` / `var(--add-bg)`
(green), `var(--del-b)` / `var(--del-bg)` (red).

Ready-made classes:

- **SVG strokes:** `.s-new`, `.s-old` (red, dashed), `.s-changed`, `.s-muted`,
  `.s-accent`. **Fills:** `.f-new`, `.f-old`, `.f-panel`, `.f-accent`. Text is
  already themed, and `.muted` greys it.
- **HTML:** `.row`, `.col`, `.grid` (set `--cols`), `.box` (with `.new`,
  `.changed`, `.removed`), `.arrow` (→), `.down` (↓), `.tag`, `.title`, `.muted`,
  `.small`, and plain `table`.

```json
{ "kind": "svg", "title": "Plan view: what each side view sees",
  "svg": "<svg viewBox='0 0 420 160'><rect x='170' y='40' width='120' height='80' class='f-panel s-muted'/><text x='196' y='85'>Platform</text><rect x='90' y='50' width='50' height='60' class='f-old s-old'/><text x='78' y='130' class='muted'>passive object</text><line x1='10' y1='80' x2='88' y2='80' class='s-old'/><text x='10' y='70' class='muted'>left view</text><line x1='410' y1='80' x2='292' y2='80' class='s-new'/><text x='350' y='70'>right view</text></svg>" }
```

## Checking

The presenter validates every diagram when the slide opens and shows any
problems (an unknown kind, an edge to a missing node) in red instead of the
diagram. It can't tell whether a diagram is readable, so render-check each
slide during prep. If one is crowded, split it or move detail into `sub` and
`note`.
