#!/usr/bin/env node
/**
 * Finds the project's review instructions and the shared guides they name, and prints where they are
 * on disk, so the agent can read them before it writes the review.
 *
 *   node review-guides.cjs [--repo <dir>] [--offline]
 *
 * REVIEW.md sits at the repo root. Its "Shared guides" section lists guides as list items:
 *
 *   - rolemodel/review-guides: code-review-principles.md          (the repo's default branch)
 *   - rolemodel/review-guides@v2: lcad-code-review-principles.md  (a tag, branch or commit)
 *   - docs/review/pricing.md                                       (a file in this repo)
 *   - [Pricing](docs/review/pricing.md)                            (the same, as a Markdown link)
 *
 * Remote guides are fetched through `gh api` (so GitHub decides who can read them) and cached under
 * ~/.cache/feature-review/guides. Relative .md links inside a listed guide are fetched too, one hop
 * only, so a guide that builds on another brings it along without pulling in the whole repo. When
 * GitHub can't be reached, the cached copy is used and the output says so. Everything else in
 * REVIEW.md is the project's own review rules. The work is in lib/review-guides.cjs.
 */
const { execFileSync } = require('child_process');
const { collect } = require('./lib/review-guides.cjs');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
let root = opt('--repo') || process.cwd();
try { root = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); } catch (e) { /* not a repo: use the directory */ }

const found = collect(root, { offline: args.includes('--offline') });
if (!found) {
  console.log('review-guides: no REVIEW.md in ' + root + ' (only the personal preferences apply)');
  process.exit(0);
}
console.log('project rules: ' + found.file);
const ok = found.guides.filter((g) => g.body != null);
ok.forEach((g) => console.log('guide: ' + g.label + (g.linked ? ' (linked)' : '') + ' -> ' + g.file));
found.guides.filter((g) => g.error).forEach((g) => console.error('review-guides: ' + g.label + ': ' + g.error + (g.body != null ? ' (using the cached copy)' : '')));
const cached = ok.filter((g) => g.cached).length, bad = found.guides.length - ok.length;
console.error('review-guides: ' + ok.length + ' guide(s)' + (cached ? ', ' + cached + ' from cache' : '') + (bad ? ', ' + bad + ' problem(s)' : ''));
