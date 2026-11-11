# @rolemodel/audit-kit — first pass prototype

Vanilla web components for audit deliverables. The LLM/skill assembles components and fills slots — it does not write CSS.

**Status:** first-pass prototype, 2026-05-14. Not production-ready. Tracked in [RMS-29](https://linear.app/rolemodelsoftware/issue/RMS-29).

## What this proves

The Widget Co audit deck used ~350 lines of bespoke CSS and ~460 lines of HTML. This prototype reproduces the same deck visually using ~150 lines of composition in `index.html`. The visual design lives once, in `audit-kit.js`, and gets reused across every future audit. The bundle is intentionally self-contained: keep `index.html`, `audit-kit.js`, `reveal-audit-theme.css`, `local-fonts.css`, `RMS-lcon.svg`, and `fonts/` together when copying it into a generated report.

## How to run it

Open `index.html` in a browser. No build step. No npm install. Reveal.js loads from CDN.

```
open index.html
```

## Components in this pass

| Element | Purpose | Slots / Attributes |
|---|---|---|
| `<audit-cover>` | Hero/cover slide | `background`, `meta`, `logo`, `logo-alt` attrs; default slot for `<h1>` |
| `<audit-stat>` | One row of the exec-summary stats | `number` attr; default slot for label text |
| `<audit-strength>` | One card in the "Then" grid | `title` attr; default slot for body |
| `<audit-finding>` | A numbered finding section | `number`, `label`, `status` attrs; named slots: `headline`, `screenshot`; default slot for body |
| `<audit-palette-row>` | One row of color swatches | `label` attr; `swatches` JSON array attr |
| `<audit-principle>` | One UX-principle row | `status` (`pass\|opportunity\|attention`), `name` attrs; default slot for detail |
| `<audit-rec-item>` | One numbered recommendation | `number` attr; default slot for text |
| `<audit-footer>` | Brand footer on closing slide | `initial` attr; default slot for text |
| `<audit-slide>` | Layout wrapper (light or dark slide) | `variant`, `label`, `centered` attrs; named slots: `grid`, `principles`, `footer` |

## Theming

Set CSS custom properties at the root (or anywhere upstream of the components):

```css
:root {
  --audit-accent: #F7BD04;        /* brand primary */
  --audit-dark: #1a2332;          /* dark slide background */
  --audit-font-family: 'DM Sans', sans-serif;
}
```

Full list in the comment block at the top of `audit-kit.js`.

## Design decisions in this pass

- **Vanilla web components, not Lit.** Zero dependencies, zero build step. Easier to ship a first prototype. Migrating to Lit later is straightforward if the API stabilizes.
- **Shadow DOM with CSS custom properties as the theming API.** Internal styles are isolated from reveal.js theme bleed. Theming surface is intentional and minimal.
- **Reveal.js still owns the outer `<section>`.** Components live *inside* `<section>` elements so reveal.js traversal works unchanged. This means you can mix audit-kit components with raw reveal.js features (fragments, speaker notes, etc.) without conflict.
- **Slot-driven content.** Headlines, body text, and rich content (screenshots) come through slots rather than attributes — keeps the LLM's job purely about *content*, not *structure*.

## Known gaps / next steps

- No tests
- Not packaged as npm — just a script file
- Some styling decisions (the exec-summary layout, the principles grid) still live in inline styles in `index.html` rather than as components. Worth promoting once the visual language is settled.
- Paged-document compatibility unverified — will likely need a separate stylesheet variant for print contexts
- No accessibility audit on the components themselves yet (focus management, ARIA roles, color contrast on status badges)
- The `swatches` attribute taking JSON is ugly — slot-based child elements (`<audit-swatch>` inside `<audit-palette-row>`) would be cleaner

## How an audit gets written with this

The LLM produces something like:

```html
<section><audit-finding number="01" label="01 · Toolbar" status="Designed">
  <span slot="headline">A smarter toolbar that stays out of the way.</span>
  Drawing tools live in a permanent left sidebar today — always visible...
</audit-finding></section>
```

Repeat for each finding. The visual design (huge 7em numeral, badge styling, screenshot frame, spacing) is fixed by the component — the LLM cannot drift on it.

## Comparison

| Original Widget Co deck | This prototype |
|---|---|
| 350+ lines bespoke CSS | 0 lines per audit (lives in audit-kit.js) |
| 460+ lines structural HTML | ~150 lines composition |
| Every audit re-implements | Every audit composes |
| Visual drift between audits | Visual consistency by construction |
| Two surfaces = two implementations | Same components in deck + document |
