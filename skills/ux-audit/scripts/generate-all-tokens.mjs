#!/usr/bin/env node
/**
 * Generate a comprehensive Figma-importable DTCG token JSON file
 * covering ALL Optics token categories: spacing, border, typography,
 * shadows, z-index, opacity, breakpoints, input heights, and more.
 *
 * Color tokens are handled separately by generate-figma-variables.mjs
 * (they require light/dark mode splitting).
 *
 * Usage:
 *   node generate-all-tokens.mjs --config .ux-audit.json --output dev-tools/ux-audit-output
 *
 * Generates: optics-tokens.json (all non-color tokens in DTCG format)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

// ── Parse CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
let configPath = null;
let outputDir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && args[i + 1]) configPath = resolve(args[++i]);
  else if (args[i] === '--output' && args[i + 1]) outputDir = resolve(args[++i]);
}

// ── Load config for overrides ───────────────────────────────────────
let config = { brand: {} };
if (configPath && existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(`Loaded config from ${configPath}`);
}

const fontFamily = config.brand?.fontFamily || 'Noto Sans';
const fontFamilyAlt = config.brand?.fontFamilyAlt || 'Noto Serif';

// ── Token helpers ───────────────────────────────────────────────────

function numToken(value, webSyntax, description) {
  return {
    "$type": "number",
    "$value": value,
    "$description": description,
    "$extensions": {
      "com.figma": {
        "hiddenFromPublishing": false,
        "scopes": ["ALL_SCOPES"],
        "codeSyntax": { "WEB": `var(${webSyntax})` }
      }
    }
  };
}

function dimToken(valuePx, webSyntax, description) {
  // Figma imports dimension as number (px value)
  return {
    "$type": "number",
    "$value": valuePx,
    "$description": description,
    "$extensions": {
      "com.figma": {
        "hiddenFromPublishing": false,
        "scopes": ["ALL_SCOPES"],
        "codeSyntax": { "WEB": `var(${webSyntax})` }
      }
    }
  };
}

function strToken(value, webSyntax, description) {
  return {
    "$type": "string",
    "$value": value,
    "$description": description,
    "$extensions": {
      "com.figma": {
        "hiddenFromPublishing": false,
        "scopes": ["ALL_SCOPES"],
        "codeSyntax": { "WEB": `var(${webSyntax})` }
      }
    }
  };
}

// ── Build token collections ─────────────────────────────────────────
const tokens = {};

// ── Spacing ─────────────────────────────────────────────────────────
tokens["Spacing"] = {
  "3x-small": dimToken(2, "--op-space-3x-small", "2px — finest spacing"),
  "2x-small": dimToken(4, "--op-space-2x-small", "4px — tight padding, icon gaps"),
  "x-small":  dimToken(8, "--op-space-x-small", "8px — input padding, list gaps"),
  "small":    dimToken(12, "--op-space-small", "12px — compact component padding"),
  "medium":   dimToken(16, "--op-space-medium", "16px — card padding, section gaps"),
  "large":    dimToken(20, "--op-space-large", "20px — content padding"),
  "x-large":  dimToken(24, "--op-space-x-large", "24px — panel padding, group gaps"),
  "2x-large": dimToken(28, "--op-space-2x-large", "28px — larger section spacing"),
  "3x-large": dimToken(40, "--op-space-3x-large", "40px — page margins, major sections"),
  "4x-large": dimToken(80, "--op-space-4x-large", "80px — hero spacing, page padding"),
};

// ── Border Radius ───────────────────────────────────────────────────
tokens["Border Radius"] = {
  "small":    dimToken(2, "--op-radius-small", "2px — subtle rounding"),
  "medium":   dimToken(4, "--op-radius-medium", "4px — buttons, inputs"),
  "large":    dimToken(8, "--op-radius-large", "8px — cards, modals"),
  "x-large":  dimToken(12, "--op-radius-x-large", "12px — large cards"),
  "2x-large": dimToken(16, "--op-radius-2x-large", "16px — hero sections"),
  "circle":   dimToken(9999, "--op-radius-circle", "50% — circular elements (use 9999 as Figma proxy for 50%)"),
  "pill":     dimToken(9999, "--op-radius-pill", "9999px — pill-shaped buttons, tags"),
};

// ── Border Width ────────────────────────────────────────────────────
tokens["Border Width"] = {
  "default":  dimToken(1, "--op-border-width", "1px — standard border"),
  "large":    dimToken(2, "--op-border-width-large", "2px — emphasis border, focus ring inner"),
  "x-large":  dimToken(4, "--op-border-width-x-large", "4px — heavy emphasis, focus ring outer"),
};

// ── Font Size ───────────────────────────────────────────────────────
tokens["Font Size"] = {
  "2x-small": dimToken(10, "--op-font-2x-small", "10px — fine print, badges"),
  "x-small":  dimToken(12, "--op-font-x-small", "12px — captions, labels"),
  "small":    dimToken(14, "--op-font-small", "14px — body text, form labels"),
  "medium":   dimToken(16, "--op-font-medium", "16px — default body text"),
  "large":    dimToken(18, "--op-font-large", "18px — subheadings"),
  "x-large":  dimToken(20, "--op-font-x-large", "20px — section headings"),
  "2x-large": dimToken(24, "--op-font-2x-large", "24px — page headings"),
  "3x-large": dimToken(28, "--op-font-3x-large", "28px — large headings"),
  "4x-large": dimToken(32, "--op-font-4x-large", "32px — hero headings"),
  "5x-large": dimToken(36, "--op-font-5x-large", "36px — display text"),
  "6x-large": dimToken(48, "--op-font-6x-large", "48px — jumbo display"),
};

// ── Font Weight ─────────────────────────────────────────────────────
tokens["Font Weight"] = {
  "thin":        numToken(100, "--op-font-weight-thin", "100 — thin"),
  "extra-light": numToken(200, "--op-font-weight-extra-light", "200 — extra light"),
  "light":       numToken(300, "--op-font-weight-light", "300 — light"),
  "normal":      numToken(400, "--op-font-weight-normal", "400 — normal/regular"),
  "medium":      numToken(500, "--op-font-weight-medium", "500 — medium"),
  "semi-bold":   numToken(600, "--op-font-weight-semi-bold", "600 — semi-bold"),
  "bold":        numToken(700, "--op-font-weight-bold", "700 — bold"),
  "extra-bold":  numToken(800, "--op-font-weight-extra-bold", "800 — extra bold"),
  "black":       numToken(900, "--op-font-weight-black", "900 — black/heavy"),
};

// ── Font Family ─────────────────────────────────────────────────────
tokens["Font Family"] = {
  "default": strToken(`${fontFamily}, sans-serif`, "--op-font-family", `Primary font family (${fontFamily})`),
  "alt":     strToken(`${fontFamilyAlt}, serif`, "--op-font-family-alt", `Alternative font family (${fontFamilyAlt})`),
};

// ── Line Height ─────────────────────────────────────────────────────
tokens["Line Height"] = {
  "none":    numToken(0, "--op-line-height-none", "0 — collapsed"),
  "densest": numToken(1, "--op-line-height-densest", "1.0 — tightest, display text"),
  "denser":  numToken(1.15, "--op-line-height-denser", "1.15 — headings"),
  "dense":   numToken(1.3, "--op-line-height-dense", "1.3 — compact body"),
  "base":    numToken(1.5, "--op-line-height-base", "1.5 — default body text"),
  "loose":   numToken(1.6, "--op-line-height-loose", "1.6 — comfortable reading"),
  "looser":  numToken(1.7, "--op-line-height-looser", "1.7 — spacious"),
  "loosest": numToken(1.8, "--op-line-height-loosest", "1.8 — maximum spacing"),
};

// ── Letter Spacing ──────────────────────────────────────────────────
tokens["Letter Spacing"] = {
  "navigation": numToken(0.1, "--op-letter-spacing-navigation", "0.01rem (0.1px) — navigation items"),
  "label":      numToken(0.4, "--op-letter-spacing-label", "0.04rem (0.4px) — uppercase labels"),
};

// ── Opacity ─────────────────────────────────────────────────────────
tokens["Opacity"] = {
  "none":     numToken(0, "--op-opacity-none", "0 — fully transparent"),
  "overlay":  numToken(0.2, "--op-opacity-overlay", "0.2 — overlay backdrop"),
  "disabled": numToken(0.4, "--op-opacity-disabled", "0.4 — disabled elements"),
  "half":     numToken(0.5, "--op-opacity-half", "0.5 — half opacity"),
  "full":     numToken(1, "--op-opacity-full", "1 — fully opaque"),
};

// ── Z-Index ─────────────────────────────────────────────────────────
tokens["Z-Index"] = {
  "header":           numToken(500, "--op-z-index-header", "500 — sticky header"),
  "footer":           numToken(500, "--op-z-index-footer", "500 — sticky footer"),
  "sidebar":          numToken(700, "--op-z-index-sidebar", "700 — sidebar overlay"),
  "dialog":           numToken(800, "--op-z-index-dialog", "800 — dialog base"),
  "dialog-backdrop":  numToken(801, "--op-z-index-dialog-backdrop", "801 — dialog backdrop"),
  "dialog-content":   numToken(802, "--op-z-index-dialog-content", "802 — dialog content"),
  "dropdown":         numToken(900, "--op-z-index-dropdown", "900 — dropdown menu"),
  "alert-group":      numToken(950, "--op-z-index-alert-group", "950 — toast/alert group"),
  "tooltip":          numToken(1000, "--op-z-index-tooltip", "1000 — tooltip (topmost)"),
};

// ── Breakpoints ─────────────────────────────────────────────────────
tokens["Breakpoints"] = {
  "x-small": dimToken(512, "--op-breakpoint-x-small", "512px — vertical phone"),
  "small":   dimToken(768, "--op-breakpoint-small", "768px — vertical iPad"),
  "medium":  dimToken(1024, "--op-breakpoint-medium", "1024px — landscape iPad"),
  "large":   dimToken(1280, "--op-breakpoint-large", "1280px — small laptop"),
  "x-large": dimToken(1440, "--op-breakpoint-x-large", "1440px — medium laptop"),
};

// ── Input Heights ───────────────────────────────────────────────────
tokens["Input Height"] = {
  "small":   dimToken(28, "--op-input-height-small", "28px — compact inputs"),
  "medium":  dimToken(36, "--op-input-height-medium", "36px — default input height"),
  "large":   dimToken(40, "--op-input-height-large", "40px — large inputs"),
  "x-large": dimToken(84, "--op-input-height-x-large", "84px — textarea default"),
};

// ── Size Unit ───────────────────────────────────────────────────────
tokens["Size"] = {
  "unit": dimToken(4, "--op-size-unit", "4px — base size unit (0.4rem)"),
};

// ── Write output ────────────────────────────────────────────────────
mkdirSync(outputDir, { recursive: true });

const outPath = join(outputDir, 'optics-tokens.json');
writeFileSync(outPath, JSON.stringify(tokens, null, 2));

// Count tokens
let total = 0;
for (const [group, items] of Object.entries(tokens)) {
  const count = Object.keys(items).length;
  total += count;
  console.log(`  ${group}: ${count} tokens`);
}
console.log(`\nGenerated ${outPath}`);
console.log(`Total: ${total} non-color tokens`);
console.log(`\nNote: Color tokens (342 per mode) are generated separately by generate-figma-variables.mjs`);
