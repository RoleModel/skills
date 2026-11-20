#!/usr/bin/env node
/**
 * Generate Figma-importable DTCG token JSON files from Optics CSS.
 * Parses the actual Optics scale_color_tokens.css to extract exact lightness values,
 * applies brand H/S overrides from .ux-audit.json, and generates light + dark mode tokens.
 *
 * Usage:
 *   node generate-figma-variables.mjs --config .ux-audit.json --output dev-tools/ux-audit-output
 *
 * If --config is omitted, uses defaults (Optics base theme, no brand overrides).
 * If --output is omitted, writes to current directory.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
let configPath = null;
let outputDir = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && args[i + 1]) {
    configPath = resolve(args[++i]);
  } else if (args[i] === '--output' && args[i + 1]) {
    outputDir = resolve(args[++i]);
  }
}

// ── Load config ─────────────────────────────────────────────────────
let config = {
  designSystem: { name: 'optics', package: '@rolemodel/optics', version: '2.3.0', tokenPrefix: '--op-' },
  brand: { name: 'Project', primaryHue: 210, primarySaturation: 70, primaryLightness: 50, neutralHue: 210, neutralSaturation: 5, fontFamily: 'Inter' },
};

if (configPath && existsSync(configPath)) {
  const userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  config = { ...config, ...userConfig };
  console.log(`Loaded config from ${configPath}`);
} else if (configPath) {
  console.warn(`Config file not found: ${configPath}, using defaults`);
}

// ── Build H/S overrides from config ─────────────────────────────────
const brand = config.brand || {};
const pH = brand.primaryHue ?? 210;
const pS = brand.primarySaturation ?? 70;
const nH = brand.neutralHue ?? pH;
const nS = brand.neutralSaturation ?? 5;

// Alert colors: check config for overrides, otherwise derive from primary hue
const alerts = brand.alerts || {};
const HS_OVERRIDES = {
  'primary':        { h: pH, s: pS },
  'neutral':        { h: nH, s: nS },
  'alerts-warning': { h: alerts.warningHue ?? 48,  s: alerts.warningSaturation ?? 100 },
  'alerts-danger':  { h: alerts.dangerHue ?? 0,    s: alerts.dangerSaturation ?? 76  },
  'alerts-info':    { h: alerts.infoHue ?? 217,     s: alerts.infoSaturation ?? 71   },
  'alerts-notice':  { h: alerts.noticeHue ?? 124,   s: alerts.noticeSaturation ?? 51  },
};

// Original configured L values (the "base" lightness for each group)
const ORIG_L = {
  'primary':        brand.primaryLightness ?? 49,
  'neutral':        brand.neutralLightness ?? 48,
  'alerts-warning': alerts.warningLightness ?? 62,
  'alerts-danger':  alerts.dangerLightness ?? 57,
  'alerts-info':    alerts.infoLightness ?? 52,
  'alerts-notice':  alerts.noticeLightness ?? 61,
};

// ── Locate Optics CSS ──────────────────────────────────────────────
const projectRoot = configPath ? dirname(configPath) : process.cwd();
const OPTICS_PATHS = [
  join(projectRoot, 'node_modules', '@rolemodel', 'optics', 'dist', 'css', 'core', 'tokens', 'scale_color_tokens.css'),
  '/tmp/optics-inspect/package/dist/css/core/tokens/scale_color_tokens.css',
];

let cssPath = OPTICS_PATHS.find(p => existsSync(p));
if (!cssPath) {
  const ver = config.designSystem?.version || '2.3.0';
  console.log(`Optics not found locally, downloading v${ver}...`);
  execSync(`cd /tmp && rm -rf optics-inspect && mkdir optics-inspect && cd optics-inspect && curl -sL https://registry.npmjs.org/@rolemodel/optics/-/optics-${ver}.tgz | tar xz`);
  cssPath = OPTICS_PATHS[1];
}

if (!existsSync(cssPath)) {
  console.error(`ERROR: Could not find Optics CSS at any known path.`);
  process.exit(1);
}

const css = readFileSync(cssPath, 'utf-8');
console.log(`Reading Optics CSS from: ${cssPath}`);

// ── Parse CSS to extract light-dark() lightness values ─────────────
const cssNorm = css.replace(/\n\s*/g, ' ');

const STEP_NAMES = [
  'on-plus-max-alt', 'on-plus-eight-alt', 'on-plus-seven-alt', 'on-plus-six-alt',
  'on-plus-five-alt', 'on-plus-four-alt', 'on-plus-three-alt', 'on-plus-two-alt',
  'on-plus-one-alt', 'on-base-alt',
  'on-minus-one-alt', 'on-minus-two-alt', 'on-minus-three-alt', 'on-minus-four-alt',
  'on-minus-five-alt', 'on-minus-six-alt', 'on-minus-seven-alt', 'on-minus-eight-alt',
  'on-minus-max-alt',
  'on-plus-max', 'on-plus-eight', 'on-plus-seven', 'on-plus-six',
  'on-plus-five', 'on-plus-four', 'on-plus-three', 'on-plus-two',
  'on-plus-one', 'on-base',
  'on-minus-one', 'on-minus-two', 'on-minus-three', 'on-minus-four',
  'on-minus-five', 'on-minus-six', 'on-minus-seven', 'on-minus-eight',
  'on-minus-max',
  'plus-max', 'plus-eight', 'plus-seven', 'plus-six', 'plus-five',
  'plus-four', 'plus-three', 'plus-two', 'plus-one', 'base',
  'minus-one', 'minus-two', 'minus-three', 'minus-four', 'minus-five',
  'minus-six', 'minus-seven', 'minus-eight', 'minus-max',
];

const stepPattern = STEP_NAMES.join('|');
const LIGHT_DARK_RE = new RegExp(
  `--op-color-([a-z-]+?)-(${stepPattern}):\\s*light-dark\\(\\s*hsl\\(.*?\\s(\\d+)%\\)\\s*,\\s*hsl\\(.*?\\s(\\d+)%\\)\\s*\\)`,
  'g'
);

const parsed = {};
let match;
while ((match = LIGHT_DARK_RE.exec(cssNorm)) !== null) {
  const [, group, step, lightL, darkL] = match;
  if (!parsed[group]) parsed[group] = {};
  parsed[group][step] = { lightL: +lightL, darkL: +darkL };
}

const groups = Object.keys(parsed);
console.log(`Parsed ${groups.length} color groups from Optics CSS:`);
for (const g of groups) {
  console.log(`  ${g}: ${Object.keys(parsed[g]).length} tokens`);
}

if (groups.length === 0) {
  console.error('ERROR: No tokens parsed from Optics CSS. Check CSS format.');
  process.exit(1);
}

// ── HSL → RGB (0-1 range) ──────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [+f(0).toFixed(4), +f(8).toFixed(4), +f(4).toFixed(4)];
}

function rgbToHex(components) {
  return '#' + components.map(v =>
    Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()
  ).join('');
}

// ── Figma DTCG token builder ────────────────────────────────────────
function colorToken(h, s, l, webSyntax) {
  const components = hslToRgb(h, s, l);
  return {
    "$type": "color",
    "$value": {
      colorSpace: "srgb",
      components,
      alpha: 1,
      hex: rgbToHex(components)
    },
    "$extensions": {
      "com.figma.scopes": ["ALL_SCOPES"],
      ...(webSyntax && { "com.figma.webSyntax": webSyntax })
    }
  };
}

function colorTokenFromHex(hex, webSyntax) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const components = [+r.toFixed(4), +g.toFixed(4), +b.toFixed(4)];
  return {
    "$type": "color",
    "$value": {
      colorSpace: "srgb",
      components,
      alpha: 1,
      hex: hex.toUpperCase()
    },
    "$extensions": {
      "com.figma.scopes": ["ALL_SCOPES"],
      ...(webSyntax && { "com.figma.webSyntax": webSyntax })
    }
  };
}

// ── Build DTCG token file from parsed CSS ──────────────────────────
function buildTokenFile(mode) {
  const isLight = mode === 'light';
  const tokens = {};

  for (const [group, steps] of Object.entries(parsed)) {
    const hs = HS_OVERRIDES[group];
    if (!hs) {
      console.warn(`  No H/S override for group "${group}", skipping`);
      continue;
    }

    let target;
    let cssPrefix;
    if (group.startsWith('alerts-')) {
      const alertName = group.replace('alerts-', '');
      if (!tokens['alerts']) tokens['alerts'] = {};
      if (!tokens['alerts'][alertName]) tokens['alerts'][alertName] = {};
      target = tokens['alerts'][alertName];
      cssPrefix = `alerts-${alertName}`;
    } else {
      if (!tokens[group]) tokens[group] = {};
      target = tokens[group];
      cssPrefix = group;
    }

    const origL = ORIG_L[group];
    if (origL !== undefined) {
      target['original'] = colorToken(hs.h, hs.s, origL,
        `hsl(var(--op-color-${cssPrefix}-h) var(--op-color-${cssPrefix}-s) var(--op-color-${cssPrefix}-l))`
      );
    }

    for (const [step, { lightL, darkL }] of Object.entries(steps)) {
      const l = isLight ? lightL : darkL;
      target[step] = colorToken(hs.h, hs.s, l,
        `var(--op-color-${cssPrefix}-${step})`
      );
    }
  }

  tokens['white'] = colorTokenFromHex('#FFFFFF', 'var(--op-color-white)');
  tokens['black'] = colorTokenFromHex('#000000', 'var(--op-color-black)');

  if (parsed['neutral']?.['plus-five']) {
    tokens['border'] = colorToken(
      HS_OVERRIDES.neutral.h, HS_OVERRIDES.neutral.s,
      isLight ? parsed['neutral']['plus-five'].lightL : parsed['neutral']['plus-five'].darkL,
      'var(--op-color-border)'
    );
  }
  if (parsed['neutral']?.['plus-eight']) {
    tokens['background'] = colorToken(
      HS_OVERRIDES.neutral.h, HS_OVERRIDES.neutral.s,
      isLight ? parsed['neutral']['plus-eight'].lightL : parsed['neutral']['plus-eight'].darkL,
      'var(--op-color-background)'
    );
  }
  if (parsed['neutral']?.['on-plus-eight']) {
    tokens['on-background'] = colorToken(
      HS_OVERRIDES.neutral.h, HS_OVERRIDES.neutral.s,
      isLight ? parsed['neutral']['on-plus-eight'].lightL : parsed['neutral']['on-plus-eight'].darkL,
      'var(--op-color-on-background)'
    );
  }

  tokens['$extensions'] = {
    "com.figma.modeName": mode
  };

  return tokens;
}

// ── Generate files ──────────────────────────────────────────────────
mkdirSync(outputDir, { recursive: true });

const lightTokens = buildTokenFile('light');
const darkTokens = buildTokenFile('dark');

writeFileSync(
  join(outputDir, 'light.tokens.json'),
  JSON.stringify(lightTokens, null, 2)
);

writeFileSync(
  join(outputDir, 'dark.tokens.json'),
  JSON.stringify(darkTokens, null, 2)
);

function countTokens(obj) {
  let count = 0;
  for (const [key, val] of Object.entries(obj)) {
    if (key === '$extensions') continue;
    if (val.$type) { count++; }
    else if (typeof val === 'object') { count += countTokens(val); }
  }
  return count;
}

const lightCount = countTokens(lightTokens);
const darkCount = countTokens(darkTokens);

console.log(`\nGenerated Figma DTCG token files in ${outputDir}:`);
console.log(`  light.tokens.json: ${lightCount} tokens`);
console.log(`  dark.tokens.json:  ${darkCount} tokens`);
console.log(`  Brand: H=${pH} S=${pS}% (${config.brand?.name || 'default'})`);
