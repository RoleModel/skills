---
name: optics-context
description: Styles Rails views with RoleModel's Optics design system — its components, `--op-` design tokens, and theme overrides. Use when writing or reviewing CSS, styling a view or component, picking a color, spacing, font, radius, or shadow value, fixing hard-coded CSS values, adding a project token, or theming an app (brand colors, fonts, color scales, dark mode). Also use when the user says things like "style this", "make this look like the design", "what token should I use", "fix the hard-coded colors", "change the brand color", or "add dark mode".
metadata:
  triggers: "optics, css, styling, design tokens, --op-, design system, theme, theming, brand colors, color scale, dark mode"
---

# Optics

Optics is RoleModel's CSS design system, published as `@rolemodel/optics`. The installed package is the source of truth for which components and tokens exist. Read it instead of recalling names from memory, since tokens change between versions.

- Tokens: `node_modules/@rolemodel/optics/dist/tokens/tokens.json` (or the CSS under `dist/css/core/tokens/` in older versions)
- Components: `node_modules/@rolemodel/optics/dist/css/components/*.css`
- Version: the `@rolemodel/optics` entry in `package.json`
- Docs: https://docs.optics.rolemodel.design
- Docs for agents: https://docs.optics.rolemodel.design/llms.txt (markdown index; component pages show the HTML for each variant). It covers the latest release, so check names against the installed package.

## Before writing CSS

1. **Use an Optics component** if one fits. Check `dist/css/components/` for the block and its modifiers.
2. **Reuse a project class** if one exists. Search `app/assets/stylesheets/`.
3. **Write a new component** only when neither fits: one block per file in `app/assets/stylesheets/components/{block}.css`, named and nested per the `bem-structure` skill.

To change how an Optics component looks across the app, override it in `app/assets/stylesheets/components/optics-overrides/{component}.css`. Don't fork it into a new block.

Optics also ships utility classes (`.flex`, `.gap-sm`, and the rest of `dist/css/core/utilities.css`). RoleModel strongly discourages them in views: style through a BEM block or element instead.

## Tokens, not literals

Every color, spacing, font, radius, border, and shadow value comes from a token.

| Instead of | Use |
| --- | --- |
| `#fff`, `rgb(...)`, `white` | `var(--op-color-background)`, `var(--op-color-primary-base)` |
| `padding: 12px` | `padding: var(--op-space-small)` |
| `border: 1px solid #ddd` | `border: var(--op-border-width) solid var(--op-color-border)` |
| `box-shadow: 0 1px 3px rgba(...)` | `box-shadow: var(--op-shadow-small)` |

Put text on a colored surface with that surface's matching `on-` token: `--op-color-primary-on-base` on `--op-color-primary-base`, `--op-color-primary-on-plus-two` on `--op-color-primary-plus-two`.

When no token fits, define a project token with the app's own prefix (`--ya-color-brand-accent` for "Your App"). Never add new names under `--op-`.

## Gotchas

- **Malformed names fail silently.** `var(--op_color_primary_base)`, `var(--color-primary-base)`, and `var(--op-primary-color-base)` all resolve to nothing and the property falls back with no error. Check the name against `tokens.json`.
- **Plus and minus flip in dark mode.** Each step is a `light-dark()` pair. In light mode `plus-*` is lighter and `minus-*` darker; in dark mode it reverses, so `plus-max` goes from the lightest step to the darkest. Pick a step by its role against the background, not by "lighter" or "darker", and check both values in `scale_color_tokens.css`.
- **Optics has more components than you'd guess.** Besides `btn` and `card` it ships `avatar`, `badge`, `tag`, `alert`, `modal`, `table`, `tab`, `switch`, `spinner`, `sidebar`, `side-panel`, `text-pair`, `segmented-control`, and others. Look in `dist/css/components/` before writing any block, and don't hedge with "if your Optics version has it" when you can check. Writing your own block under an Optics name (a new `.avatar { … }`) doesn't create a separate component: it merges into Optics' rules and changes every avatar in the app. Use the Optics block, and put changes in `components/optics-overrides/{component}.css` or a project modifier.
- **Partial theme overrides break the scale.** See [references/theming.md](references/theming.md) before changing any `--op-color-*` value.

## Theming

To change brand colors, fonts, radius, or a color scale for the whole app, read [references/theming.md](references/theming.md).
