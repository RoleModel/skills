/**
 * REVIEW.md and the shared guides it names: parsing the list, fetching a guide through `gh api`
 * with a cache under ~/.cache/feature-review/guides, and pulling one section out of a guide. Used by
 * review-guides.cjs (which the agent runs) and build-review.cjs (which inlines a recommendation's
 * principle). The format is in references/review-md.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE = path.join(os.homedir(), '.cache', 'feature-review', 'guides');

// `owner/repo[@ref]: path` is a guide in a GitHub repo; anything else is a path in this repo.
function parseSpec(s) {
  const m = /^\s*`?([^`\s:]+?)`?\s*(?::\s*`?([^`\s]+)`?)?\s*$/.exec(String(s || ''));
  if (!m) return null;
  const remote = m[2] && /^([\w.-]+)\/([\w.-]+)(?:@([\w./-]+))?$/.exec(m[1]);
  if (remote) return { owner: remote[1], repo: remote[2], ref: remote[3] || null, path: m[2] };
  return m[2] ? null : { local: m[1] };
}
const labelOf = (e) => e.local || e.owner + '/' + e.repo + '@' + (e.ref || 'default') + ':' + e.path;
const cachePath = (e) => path.join(CACHE, e.owner, e.repo, e.ref || '_default', e.path);

// List items under a "Shared guides" heading, up to the next heading of the same or higher level.
// Text after a dash is a note for people.
function parseReviewMd(text) {
  const entries = [];
  let inShared = 0;
  String(text).split('\n').forEach((line) => {
    const h = /^(#+)\s+(.*)$/.exec(line);
    if (h) { inShared = /shared guides/i.test(h[2]) ? h[1].length : inShared && h[1].length > inShared ? inShared : 0; return; }
    if (!inShared) return;
    const m = /^\s*[-*]\s+(.+?)\s*(?:\s[—–-]\s.*)?$/.exec(line);
    // A Markdown link to a file in this repo, `[Title](path.md)`, names that path.
    const link = m && /^\[[^\]]*\]\(<?([^)\s#>]+)>?(?:#[^)]*)?\)$/.exec(m[1]);
    const e = m && parseSpec(link ? link[1] : m[1]);
    if (e) entries.push(e);
  });
  return entries;
}

// One guide's text: fetched (and cached) unless offline, else the cached copy. A local entry reads
// from the repo. Returns { label, file, body, cached, error }.
function load(e, { root, offline } = {}) {
  const label = labelOf(e);
  if (e.local) {
    const file = path.join(root || process.cwd(), e.local);
    return fs.existsSync(file) ? { label, file, body: fs.readFileSync(file, 'utf8') } : { label, error: 'not found in ' + (root || process.cwd()) };
  }
  const file = cachePath(e);
  let error = null;
  if (!offline) {
    try {
      const body = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw',
        'repos/' + e.owner + '/' + e.repo + '/contents/' + e.path + (e.ref ? '?ref=' + encodeURIComponent(e.ref) : '')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return { label, file, body };
    } catch (err) { error = String(err.stderr || err.message).split('\n')[0]; }
  }
  if (!fs.existsSync(file)) return { label, error: error || 'not cached (run without --offline)' };
  return { label, file, body: fs.readFileSync(file, 'utf8'), cached: true, error };
}

// Relative .md links in a guide, as entries in the same repo (or the same repo checkout for a local one).
function linksOf(e, body) {
  const out = [];
  for (const m of String(body).matchAll(/\]\(((?!https?:|#|\/)[^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    const base = e.local || e.path;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(base), m[1]));
    if (!rel.startsWith('..')) out.push(e.local ? { local: rel } : Object.assign({}, e, { path: rel }));
  }
  return out;
}

// Every guide REVIEW.md lists, plus the guides those link to (one hop, so a general README doesn't
// pull in its whole repo).
function collect(root, opts = {}) {
  const file = path.join(root, 'REVIEW.md');
  if (!fs.existsSync(file)) return null;
  const seen = new Set(), guides = [];
  const add = (e, hop) => {
    const k = labelOf(e);
    if (seen.has(k)) return;
    seen.add(k);
    const g = Object.assign(load(e, Object.assign({ root }, opts)), { entry: e, linked: !!hop });
    guides.push(g);
    if (!hop && g.body) linksOf(e, g.body).forEach((x) => add(x, 1));
  };
  parseReviewMd(fs.readFileSync(file, 'utf8')).forEach((e) => add(e, 0));
  return { file, guides };
}

// The section of a guide whose heading contains `name` (case and numbering ignored): its heading
// and text up to the next heading at the same level or above.
function section(body, name) {
  const norm = (s) => String(s).toLowerCase().replace(/^[\d.\s]+/, '').replace(/[`*_]/g, '').trim();
  const want = norm(name), lines = String(body).split('\n');
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && norm(l.replace(/^#+\s*/, '')).includes(want));
  if (at === -1 || !want) return null;
  const level = /^(#+)/.exec(lines[at])[1].length;
  let end = lines.slice(at + 1).findIndex((l) => { const h = /^(#+)\s/.exec(l); return h && h[1].length <= level; });
  end = end === -1 ? lines.length : at + 1 + end;
  return { heading: lines[at].replace(/^#+\s*/, '').trim(), text: lines.slice(at + 1, end).join('\n').replace(/\n-{3,}\s*$/, '').trim() };
}
const titleOf = (body) => { const m = /^#\s+(.+)$/m.exec(String(body)); return m ? m[1].trim() : null; };

module.exports = { CACHE, parseSpec, parseReviewMd, labelOf, load, linksOf, collect, section, titleOf };
