# Theming an app with Optics

A theme is a stylesheet of token overrides. It changes Optics' own `--op-` tokens, so every component picks up the change without per-component CSS.

## Load order

Import the theme after Optics so its values win:

```css
@import '@rolemodel/optics';
@import 'stylesheets/theme/app_theme';
```

## Brand colors

Each color is built from three tokens: `-h` (hue), `-s` (saturation), and `-l` (lightness). Override those, not the computed scale steps:

```css
:root {
  --op-color-primary-h: 164;
  --op-color-primary-s: 100%;
  --op-color-primary-l: 50%;
}
```

`neutral` takes its hue from `primary` by default. Override `--op-color-neutral-h` too if the grays should not pick up the brand tint. The alert colors (`alerts-warning`, `alerts-danger`, `alerts-info`, `alerts-notice`) follow the same `-h`/`-s`/`-l` pattern.

## Redefining a color scale

Only redefine the scale steps when the brand needs different luminosity steps than Optics ships. When you do, redefine every step of that scale: all `plus-*`, `base`, `minus-*`, every `on-*`, and every `on-*-alt`. Copy the full set for that color from `node_modules/@rolemodel/optics/dist/css/core/tokens/scale_color_tokens.css` and edit the percentages. A partial override leaves the untouched steps on Optics' curve, so text on an overridden surface can lose contrast.

Each step is a `light-dark()` pair, light value first:

```css
--op-color-primary-plus-two: light-dark(
  hsl(var(--op-color-primary-h) var(--op-color-primary-s) 64%),
  hsl(var(--op-color-primary-h) var(--op-color-primary-s) 32%)
);
```

## Fonts, radius, and other tokens

Any token can be overridden the same way, for example `--op-font-family` or `--op-radius-medium`. Load web fonts with `@import url(...)` at the top of the theme file.

## Dark mode

Optics follows the OS setting and lets the app force a mode with `data-theme-mode` on the root element. A dark-only override needs both selectors so it applies in either case:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme-mode='light']) {
    --op-font-family: 'Example Sans Dark', sans-serif;
  }
}

:root[data-theme-mode='dark'] {
  --op-font-family: 'Example Sans Dark', sans-serif;
}
```

Color tokens built with `light-dark()` already switch on their own. Only non-color tokens, or colors defined without `light-dark()`, need these selectors.
