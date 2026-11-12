# Page doc template

One file per URL pattern: `docs/app-map/<section>/<page>.md`, where `<page>` is the crawl's slug without the section prefix (`projects__id__edit` → `projects/edit.md`, `projects` → `projects/index.md`). Pages with the same pattern share one doc. Pick the clearest sample, and note how the others differ.

Write for a tester who has never seen the app. Use the app's own labels in bold, and describe what each control *does* (what opens, what changes, where it goes), not what it looks like. One line per element. Leave out elements repeated on every page (global nav, footer). Document those once, in `docs/app-map/README.md` under **Global layout**.

```markdown
---
pattern: /widgets/:id/edit
section: widgets
roles: [admin, member]
fingerprint: { admin: 3f9a1c2b7d10, member: 8e0b44a91c02 }
canvas: false
mapped: 2026-11-12
---

# Edit widget

Changes a widget's name, size, and pricing. Reached from **Edit** on a widget's page.

## Header
- **Back to widget**: returns to the widget page without saving. `getByRole('link', { name: 'Back to widget' })`

## Widget form
- **Name** (required): free text, shown in lists. `getByLabel('Name')`
- **Size**: select, Small / Medium / Large, changes the price shown below. `getByRole('combobox', { name: 'Size' })`
- **Save widget**: saves the form and returns to the widget page with "Widget was successfully updated." `getByRole('button', { name: 'Save widget' })`

## Hidden UI
- **More ▾** menu: Duplicate, Archive (asks "Are you sure?"), Delete (admin only).

## Flows exercised
- Created *QA Map 20261112-1430 Widget*, then edited its size. Price updated without a reload.

## Leads to
- [Widget](show.md) · [Widgets](index.md)

## Notes
- Saving with an empty name shows the error under the field but also clears **Size**.
```

Rules:

- Use the locator from the crawl JSON. If an element has none, write the best one you can confirm with `playwright-cli`, or write `locator: none (needs data-testid)`.
- Mark role differences inline: `(admin only)`, `(hidden for member)`.
- **Notes** records anything a tester should know: errors, console errors, 5xx responses, controls that do nothing, labels that don't match what they do, slow loads. Don't fix anything. Just describe what you saw.
- Canvas pages: document the toolbars, palettes, and inspectors around the canvas as usual, then add a `## Canvas` section that describes the drawing regions from the screenshot (what's drawn, where the tools act), and end it with `Canvas: needs scripted interaction.`
- Leave out **Flows exercised** in Read-only mode.

## Section index

`docs/app-map/<section>/README.md`: one sentence on what the section is for, then a table of its pages (title, pattern, roles, one-line purpose), ordered the way a user moves through them.

## Top index

`docs/app-map/README.md`: the app's sections with one line each, **Global layout** (nav, header, footer, and what's in them per role), the roles mapped, the date of the last run, and a **Not reached** list from the crawl's skipped patterns and errors.
