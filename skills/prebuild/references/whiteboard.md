# Whiteboard (Excalidraw)

Each slide has a **Whiteboard** row above Notes (**Open ▾**), with two modes. Both save to
the same `whiteboards/<slide>.excalidraw`, so the wrap-up reads them the same
way.

## Inline

An Excalidraw editor inside the slide, for drawing at the keyboard or on a
screen share. It starts from the slide's question and diagram (boxes keep
their status colours, arrows stay attached to their boxes), and fits it to
the view. It saves itself shortly after each edit; opening it without
drawing saves nothing. **Full screen ⤢** gives it the whole screen.

- Excalidraw loads from esm.sh the first time it's opened, so it needs an
  internet connection then. The rest of the presenter stays offline.
- While the board has focus, ← and → nudge shapes and don't change slides.

## Live session

For a teammate drawing from their own machine, on excalidraw.com. Its live
collaboration is end-to-end encrypted (the key is in the share link, so
Excalidraw's server can't read the board).

Four numbered steps, each ticked off as it's done:

- **Copy this slide's board:** copies what's drawn inline, or the slide's
  starting board if nothing is.
- **Open Excalidraw and paste it:** opens excalidraw.com in a new tab; click
  the canvas and press ⌘V.
- **Start the live session:** in Excalidraw, **Live collaboration → Start
  session**, then send the link to your teammate.
- **Bring the finished board back:** select all (⌘A) and copy (⌘C) in
  Excalidraw, then paste into the box, or upload a saved `.excalidraw` file.
  It saves straight away; the box shows the saved board, and a new paste
  replaces it.
- Excalidraw rooms vanish when everyone leaves, so save the board back
  before closing the tab.

The starting board is kept as `whiteboards/<slide>.seed.excalidraw`. `svg`
diagrams carry over as plain boxes, lines and text, and `html` diagrams don't
carry over: those slides start with just the question.

## Reading it at wrap-up

Both files use Excalidraw's JSON format. Ignore elements with
`isDeleted: true`. Read:

- **Labels:** `type: "text"` elements. A label inside a shape has `containerId`
  set to that shape's `id`.
- **Shapes:** `rectangle`, `ellipse` and `diamond`. Their colours show status
  the way the slides did: `#2f9e44` new, `#f08c00` to discuss, `#e03131` no.
- **Connections:** `arrow` elements. `startBinding.elementId` and
  `endBinding.elementId` name the shapes they join.
- **Freehand:** `freedraw` elements are sketches. Mention where they sit
  (near which labels), but don't try to read them.

Compare the saved board with its seed, matching by element `id` (Excalidraw
keeps ids). Report what's new, what was deleted, what changed label, and any
arrows added between existing boxes. Those changes are usually the decisions.
