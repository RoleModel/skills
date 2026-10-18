#!/usr/bin/env node
// front_matter.mjs
// Emits deterministic front-matter data for generated-docs/*.md.
// JSON only — the agent composes the markdown banner from these fields.
//
// Usage: node front_matter.mjs [project-root]

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());

const read = (p) => {
  try { return readFileSync(join(root, p), 'utf-8'); } catch { return null; }
};
const readJson = (p) => {
  const s = read(p);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

function detectProjectName() {
  const pkg = readJson('package.json');
  if (pkg?.name) return pkg.name;
  try {
    const gemspec = readdirSync(root).find(f => f.endsWith('.gemspec'));
    if (gemspec) {
      const m = read(gemspec)?.match(/\.name\s*=\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    }
  } catch { /* not a directory we can read */ }
  const pyproject = read('pyproject.toml');
  if (pyproject) {
    const m = pyproject.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  const composer = readJson('composer.json');
  if (composer?.name) return composer.name;
  const cargo = read('Cargo.toml');
  if (cargo) {
    const m = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  return basename(root);
}

const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');

process.stdout.write(JSON.stringify({
  date: `${yyyy}-${mm}-${dd}`,
  projectName: detectProjectName(),
}, null, 2) + '\n');
