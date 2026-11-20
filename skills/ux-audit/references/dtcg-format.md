# DTCG Token JSON Format

Design Tokens Community Group (DTCG) format for Figma Variables import.

## Overview

The token generator produces two JSON files:
- `light.tokens.json` — Light mode color values
- `dark.tokens.json` — Dark mode color values (inverted lightness)

These files follow the [DTCG specification](https://tr.designtokens.org/format/) with Figma-specific extensions.

## Structure

```json
{
  "Group Name": {
    "Token Name": {
      "$type": "color",
      "$value": {
        "colorSpace": "srgb",
        "components": {
          "red": 0.36,
          "green": 0.68,
          "blue": 0.77
        },
        "alpha": 1
      },
      "$extensions": {
        "com.figma": {
          "hiddenFromPublishing": false,
          "scopes": ["ALL_SCOPES"],
          "codeSyntax": {
            "WEB": "var(--op-color-primary-base)"
          }
        }
      }
    }
  }
}
```

## Field Reference

### Token Value (`$value`)

| Field | Type | Description |
|-------|------|-------------|
| `colorSpace` | string | Always `"srgb"` |
| `components.red` | number | 0-1 (divide hex R by 255) |
| `components.green` | number | 0-1 (divide hex G by 255) |
| `components.blue` | number | 0-1 (divide hex B by 255) |
| `alpha` | number | 0-1 opacity |

### Figma Extensions (`$extensions.com.figma`)

| Field | Type | Description |
|-------|------|-------------|
| `hiddenFromPublishing` | boolean | `false` — make tokens available to consumers |
| `scopes` | string[] | `["ALL_SCOPES"]` — allow use in all contexts |
| `codeSyntax.WEB` | string | CSS variable reference, e.g. `"var(--op-color-primary-base)"` |

## Group Naming Convention

Groups organize tokens by color family:

| Group | Contains | CSS prefix |
|-------|----------|------------|
| `Primary` | `plus-max` through `minus-max` (19 steps) | `--op-color-primary-*` |
| `Primary On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-primary-on-*` |
| `Primary On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-primary-on-*-alt` |
| `Neutral` | `plus-max` through `minus-max` (19 steps) | `--op-color-neutral-*` |
| `Neutral On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-neutral-on-*` |
| `Neutral On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-neutral-on-*-alt` |
| `Warning` | `plus-max` through `minus-max` (19 steps) | `--op-color-alerts-warning-*` |
| `Warning On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-alerts-warning-on-*` |
| `Warning On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-alerts-warning-on-*-alt` |
| `Danger` | `plus-max` through `minus-max` (19 steps) | `--op-color-alerts-danger-*` |
| `Danger On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-alerts-danger-on-*` |
| `Danger On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-alerts-danger-on-*-alt` |
| `Notice` | `plus-max` through `minus-max` (19 steps) | `--op-color-alerts-notice-*` |
| `Notice On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-alerts-notice-on-*` |
| `Notice On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-alerts-notice-on-*-alt` |
| `Info` | `plus-max` through `minus-max` (19 steps) | `--op-color-alerts-info-*` |
| `Info On` | `on-plus-max` through `on-minus-max` (19 steps) | `--op-color-alerts-info-on-*` |
| `Info On Alt` | `on-plus-max-alt` through `on-minus-max-alt` (19 steps) | `--op-color-alerts-info-on-*-alt` |

**6 color families × 3 variants (base + on + on-alt) = 18 groups × 19 steps = 342 tokens per mode.**

### Token Variant Semantics

| Variant | Purpose | CSS property context |
|---------|---------|---------------------|
| **Base** (`primary-base`, `plus-one`, etc.) | Background/fill colors | `background-color`, `background`, `fill`, `border-color` |
| **On** (`primary-on-base`, `on-plus-one`, etc.) | Foreground text/icon color for use ON the base color | `color` on elements with a base background |
| **On Alt** (`primary-on-base-alt`, `on-plus-one-alt`, etc.) | Secondary/muted foreground for use ON the base color | `color` for captions, placeholders, disabled text on base backgrounds |

The on/on-alt tokens guarantee WCAG-compliant contrast against their corresponding base token. Always pair: if you use `--op-color-primary-base` as background, use `--op-color-primary-on-base` for text.

## Light vs Dark Mode

The same token names appear in both files. The difference is the lightness values:

- **Light mode**: `plus-max` is lightest (L: ~98%), `minus-max` is darkest (L: ~5%)
- **Dark mode**: Lightness values are inverted — `plus-max` becomes darkest, `minus-max` becomes lightest

The generator reads `light-dark(LIGHT, DARK)` from the Optics CSS source and uses the first value for `light.tokens.json` and the second for `dark.tokens.json`.

## HSL to sRGB Conversion

The generator:
1. Parses the lightness percentage from Optics CSS
2. Applies brand H/S overrides from `.ux-audit.json`
3. Converts HSL → sRGB using the standard algorithm
4. Outputs `components` as 0-1 floats

```
H = brand hue (0-360)
S = brand saturation (0-100%)
L = lightness from Optics CSS (0-100%)

→ Convert to sRGB → divide by 255 → output as components
```

## Import into Figma

1. Open your Figma file
2. Open the **Local Variables** panel (right sidebar)
3. Click the settings gear icon
4. Select **Import variables**
5. Choose `light.tokens.json` first — this creates the collection and all variables
6. Then import `dark.tokens.json` as a new mode in the same collection
7. Rename modes to "Light" and "Dark"

The `codeSyntax.WEB` values will appear in Figma's Inspect panel, giving developers the correct CSS variable names.
