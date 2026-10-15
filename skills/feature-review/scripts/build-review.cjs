#!/usr/bin/env node
/**
 * build-review.cjs — render a git diff into a single self-contained HTML review page.
 *
 * Usage:
 *   node build-review.cjs <commit-ish>                  # commit vs its first parent
 *   node build-review.cjs <base>..<head>                # arbitrary range (three dots for merge-base)
 *   node build-review.cjs --pr <number|url|owner/repo#N>  # the PR's own diff, comments can post to it
 *   node build-review.cjs <ref> --pr <N>                # a commit or range inside a PR
 *   node build-review.cjs <commit-ish> -o out.html      # explicit output path
 *   node build-review.cjs <commit-ish> --title "..."    # override page title
 *   node build-review.cjs --stdin -o out.html           # read a diff from stdin
 *   node build-review.cjs <commit-ish> --groups g.json  # overview, reading guide, auto-reviews, suggestions
 *   node build-review.cjs <commit-ish> --serve [--port N]  # serve on localhost so Submit can post
 *   node build-review.cjs --pr <N> --event approve      # default verdict on the submit page
 *   node build-review.cjs --pr <N> --since last         # only what changed since your last review
 *   node build-review.cjs --pr <N> --no-threads         # skip loading the PR's existing review threads
 *   node build-review.cjs --pr <N> --no-description     # skip the PR description and its screenshots
 *
 * Output defaults to tmp/review/<slug>.html. Prints the written path on success
 * (or the served URL with --serve). Always runs a self-check: re-parses the
 * embedded diff and compares per-file +/- counts against `git diff --numstat`,
 * exiting non-zero on any mismatch.
 *
 * .cjs extension is required: many repos set "type": "module" in package.json.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseDiff, commentableLines, anchorProblem } = require('./lib/diff-parse.cjs');
const prMedia = require('./lib/pr-media.cjs');

const argv = process.argv.slice(2);
const VALUED = ['-o', '--title', '--groups', '--pr', '--commit', '--port', '--event', '--since'];
const opt = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
const has = (flag) => argv.includes(flag);
let target = argv.find((a, i) => !a.startsWith('-') && !VALUED.includes(argv[i - 1]));
const die = (msg) => { console.error('error: ' + msg); process.exit(2); };

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
const git = (args) => run('git', args);
const ok = (fn) => { try { fn(); return true; } catch (e) { return false; } };
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// A commit this clone may never have seen (a PR head, a commit from before a force-push): fetch it.
const have = (sha, refs) => {
  if (ok(() => git(['cat-file', '-e', `${sha}^{commit}`]))) return true;
  for (const r of refs) if (ok(() => git(['fetch', '--quiet', 'origin', r])) && ok(() => git(['cat-file', '-e', `${sha}^{commit}`]))) return true;
  return false;
};
const need = (sha, refs) => { if (!have(sha, refs)) die(`commit ${sha.slice(0, 10)} is not available locally; try \`git fetch origin ${refs[0]}\``); };

// --- pull request ---------------------------------------------------------
// The page only offers "Submit" when it knows the PR; everything else works without one.
let pr = null, lastReview = null, prBody = '';
if (opt('--pr')) {
  const spec = opt('--pr');
  const m = spec.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  const args = m ? [m[2], '--repo', m[1]] : [spec];
  let j;
  try {
    j = JSON.parse(run('gh', ['pr', 'view', ...args, '--json',
      'number,url,title,headRefOid,baseRefOid,headRefName,baseRefName,author,state,body']));
  } catch (e) { die(`cannot read PR ${spec} with gh: ${(e.stderr || e.message).toString().trim()}`); }
  const u = j.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  pr = { owner: u[1], repo: u[2], number: j.number, url: j.url, title: j.title, author: j.author && j.author.login,
    state: j.state, headSha: j.headRefOid, baseSha: j.baseRefOid, headRef: j.headRefName, baseRef: j.baseRefName };
  prBody = (j.body || '').replace(/\r\n?/g, '\n');
  if (!target && !has('--stdin')) {
    // The PR's own diff is base...head. Fetch either end if this clone has never seen it.
    need(pr.headSha, [`pull/${pr.number}/head`, pr.headRef]);
    need(pr.baseSha, [pr.baseRef]);
    target = `${pr.baseSha}...${pr.headSha}`;
  }
  // The reviewer's last submitted review, for re-reviews: the page marks the files
  // changed since then, and --since last diffs from it.
  try {
    const me = run('gh', ['api', 'user', '--jq', '.login']).trim();
    // GitHub won't let you approve or request changes on your own PR; the submit page needs to know.
    pr.viewer = me;
    const mine = run('gh', ['api', '--paginate', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, '--jq',
      `.[] | select(.user.login == "${me}" and .submitted_at != null) | [.commit_id, .submitted_at, .state] | @tsv`])
      .trim().split('\n').filter(Boolean);
    if (mine.length) {
      const [sha, at, state] = mine[mine.length - 1].split('\t');
      lastReview = { sha, at, state };
    }
  } catch (e) { console.error(`re-review: could not read your past reviews (${(e.stderr || e.message).toString().trim()})`); }
  // CI at the PR head: a reviewer should know the build is red before reading the code. gh exits 8
  // while checks are pending, with the JSON still on stdout.
  try {
    let out;
    try { out = run('gh', ['pr', 'checks', String(pr.number), '--repo', `${pr.owner}/${pr.repo}`, '--json', 'name,state,bucket,link,workflow']); }
    catch (e) { out = e.stdout ? e.stdout.toString() : ''; if (!out.trim()) throw e; }
    const list = JSON.parse(out).map((c) => ({ name: c.name, workflow: c.workflow || '', bucket: c.bucket, state: c.state, link: c.link || '' }));
    pr.ci = { at: new Date().toISOString(), checks: list };
    const n = (b) => list.filter((c) => c.bucket === b);
    console.error('ci: ' + (list.length ? ['pass', 'fail', 'pending', 'cancel', 'skipping'].filter((b) => n(b).length)
      .map((b) => n(b).length + ' ' + b + (b === 'fail' ? ' (' + n(b).map((c) => c.name).join(', ') + ')' : '')).join(', ') : 'no checks'));
  } catch (e) {
    const why = (e.stderr || e.message).toString().trim().split('\n')[0];
    // gh says "no checks reported" with a non-zero exit when a PR has none.
    if (/no checks/i.test(why)) { pr.ci = { at: new Date().toISOString(), checks: [] }; console.error('ci: no checks'); }
    else console.error(`ci: could not read checks (${why})`);
  }
}

// --- re-review: only what changed since a commit ---------------------------
let since = null;
if (opt('--since')) {
  let sha = opt('--since');
  if (sha === 'last') {
    if (!pr) die('--since last needs --pr');
    if (!lastReview) die(`you have no submitted review on #${pr.number} to compare against`);
    sha = lastReview.sha;
  }
  if (!have(sha, pr ? [sha, `pull/${pr.number}/head`] : [sha])) die(`commit ${sha.slice(0, 10)} is not available locally, and fetching it failed`);
  const head = target ? (target.includes('..') ? target.split(/\.{2,3}/)[1] || 'HEAD' : target) : 'HEAD';
  sha = git(['rev-parse', sha]).trim();
  since = { sha, at: lastReview && lastReview.sha === sha ? lastReview.at : null,
    rebased: !ok(() => git(['merge-base', '--is-ancestor', sha, head])) };
  target = `${sha}..${head}`;
}

let diff, numstat = null, wsDiff = null, headRev = null, baseRev = null, title, slug, range = null, commitId = opt('--commit');
if (has('--stdin')) {
  diff = fs.readFileSync(0, 'utf8');
  title = opt('--title') || (pr ? `${pr.title} — #${pr.number}` : 'Diff review');
  slug = pr ? ((pr.title.match(/[A-Z]+-\d+/) || [`pr-${pr.number}`])[0]) : 'review';
} else {
  if (!target) die('pass a commit-ish or range, --pr, or --stdin');
  let args, head;
  if (target.includes('..')) {
    args = [target];
    head = target.split(/\.{2,3}/)[1] || 'HEAD';
  } else {
    // "This commit vs its first parent"; a root commit diffs against the empty tree.
    args = [ok(() => git(['rev-parse', '--verify', '--quiet', `${target}^`])) ? `${target}^` : EMPTY_TREE, target];
    head = target;
  }
  range = target;
  // The "before" side, for the overview's before/after file sizes.
  if (target.includes('...')) {
    const [a, b] = target.split('...');
    baseRev = git(['merge-base', a || 'HEAD', b || 'HEAD']).trim();
  } else if (target.includes('..')) baseRev = git(['rev-parse', target.split('..')[0] || 'HEAD']).trim();
  else if (args[0] !== EMPTY_TREE) baseRev = git(['rev-parse', args[0]]).trim();
  const DIFF = ['--no-color', '--no-ext-diff', '--no-relative', '--src-prefix=a/', '--dst-prefix=b/'];
  diff = git(['diff', ...DIFF, ...args]);
  numstat = git(['diff', ...DIFF, '--numstat', '-z', ...args]);
  wsDiff = git(['diff', ...DIFF, '-w', ...args]);
  headRev = git(['rev-parse', head]).trim();
  const subject = git(['log', '-1', '--format=%s', head]).trim();
  const short = git(['rev-parse', '--short', head]).trim();
  commitId = commitId || git(['rev-parse', head]).trim();
  const wholePr = pr && range === `${pr.baseSha}...${pr.headSha}`;
  const prSince = pr && since && headRev === pr.headSha;
  title = opt('--title') || (wholePr ? `${pr.title} — #${pr.number}`
    : prSince ? `${pr.title} — #${pr.number}, since your review at ${since.sha.slice(0, 7)}` : `${subject} — ${short}`);
  slug = ((wholePr || prSince ? pr.title : subject).match(/[A-Z]+-\d+/) || [wholePr || prSince ? `pr-${pr.number}` : short])[0] +
    (since ? '-since' : '');
}
if (!diff.trim()) die('empty diff');
if (pr && !commitId) commitId = pr.headSha;

const parsed = parseDiff(diff);
const byName = new Map(parsed.map((f) => [f.name, f]));
const hasHunks = (f) => f.rows.some((r) => r.t === 'h');

// --- whitespace-insensitive rows ------------------------------------------
// Only for files where ignoring whitespace changes something: '' when every
// change is whitespace, otherwise that file's `git diff -w` text.
let wsMap = null;
if (wsDiff != null) {
  wsMap = {};
  const chunks = new Map(wsDiff.split(/^(?=diff --git )/m).filter(Boolean).map((c) => { const w = parseDiff(c)[0]; return [w && w.name, w && c]; }));
  const sig = (rows) => rows.map((r) => r.t + r.text).join('\n');
  for (const f of parsed) {
    if (!hasHunks(f)) continue;
    const c = chunks.get(f.name), w = c && parseDiff(c)[0];
    if (!w || !hasHunks(w)) wsMap[f.name] = '';
    else if (sig(w.rows) !== sig(f.rows)) wsMap[f.name] = c;
  }
}

// --- file identity at the head ---------------------------------------------
// "Viewed" is keyed to the file's blob at the reviewed commit, so a checkmark
// survives a rebuild (or a --since page) until the file itself changes.
let blobs = null;
if (headRev) {
  blobs = {};
  for (const entry of git(['ls-tree', '-r', '-z', headRev]).split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const name = entry.slice(tab + 1);
    if (byName.has(name)) blobs[name] = entry.slice(0, tab).split(' ')[2];
  }
}

// --- file sizes before and after --------------------------------------------
// The overview's "shape of the codebase" compares each touched file's length at
// the base and the head. One `git cat-file --batch` call reads them all.
const countLines = (specs) => {
  if (!specs.length) return [];
  const out = execFileSync('git', ['cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1 << 30 });
  const res = [];
  let pos = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = out.indexOf(10, pos);
    const m = out.subarray(pos, nl).toString().match(/^[0-9a-f]+ (\w+) (\d+)$/);
    pos = nl + 1;
    if (!m) { res.push(null); continue; } // missing: the file isn't on that side
    const size = +m[2], blob = out.subarray(pos, pos + size);
    pos += size + 1;
    if (m[1] !== 'blob' || blob.includes(0)) { res.push(null); continue; } // binary
    let n = 0;
    for (const b of blob) if (b === 10) n++;
    res.push(size && blob[size - 1] !== 10 ? n + 1 : n);
  }
  return res;
};
let sizes = null;
if (headRev) {
  try {
    const before = baseRev ? countLines(parsed.map((f) => `${baseRev}:${f.old || f.name}`)) : parsed.map(() => null);
    const after = countLines(parsed.map((f) => `${headRev}:${f.name}`));
    sizes = Object.fromEntries(parsed.map((f, i) => [f.name, [f.status === 'added' ? 0 : before[i], f.status === 'deleted' ? 0 : after[i]]]));
  } catch (e) { console.error(`overview: could not read file sizes (${e.message}); continuing without`); }
}

// --- re-review: which files changed since the last review ------------------
if (lastReview && !since && headRev) {
  if (lastReview.sha === headRev) lastReview.changed = [];
  else if (have(lastReview.sha, [lastReview.sha, `pull/${pr.number}/head`])) {
    lastReview.changed = git(['diff', '--name-only', '-z', lastReview.sha, headRev]).split('\0').filter((n) => byName.has(n));
    lastReview.rebased = !ok(() => git(['merge-base', '--is-ancestor', lastReview.sha, headRev]));
  }
}

// --- existing review threads on the PR --------------------------------------
let threads = [];
if (pr && !has('--no-threads')) {
  const Q = 'query($owner:String!,$repo:String!,$n:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$n){' +
    'reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id isResolved isOutdated path line startLine ' +
    'originalLine originalStartLine diffSide startDiffSide subjectType comments(first:100){nodes{databaseId state body createdAt url author{login}}}}}}}}';
  try {
    let after = null;
    do {
      const args = ['api', 'graphql', '-f', `query=${Q}`, '-f', `owner=${pr.owner}`, '-f', `repo=${pr.repo}`, '-F', `n=${pr.number}`];
      if (after) args.push('-f', `after=${after}`);
      const page = JSON.parse(run('gh', args)).data.repository.pullRequest.reviewThreads;
      for (const t of page.nodes) {
        // Your own unsubmitted comments belong to a pending review on GitHub, not to the conversation.
        const comments = t.comments.nodes.filter((c) => c.state !== 'PENDING').map((c) => ({
          id: c.databaseId, author: (c.author && c.author.login) || 'ghost', body: c.body, at: c.createdAt, url: c.url }));
        if (!comments.length) continue;
        threads.push({ id: t.id, path: t.path, subject: t.subjectType === 'FILE' ? 'file' : 'line', side: t.diffSide || 'RIGHT',
          line: t.line, start_line: t.startLine, start_side: t.startDiffSide, original_line: t.originalLine,
          resolved: t.isResolved, outdated: t.isOutdated, comments });
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  } catch (e) {
    console.error(`threads: could not load them (${(e.stderr || e.message).toString().trim()}); continuing without`);
    threads = [];
  }
}

// --- reading guide --------------------------------------------------------
// This script has no model access, so the guide is authored elsewhere and handed
// in as JSON. Either a bare array of groups, or
//   { groups: [{title, why, auto?, files: [path | {path, summary?, auto?}]}],
//     suggestions: [{path, line?, side?, start_line?, start_side?, body}] }
// with groups in relevance order, plus an optional `overview` (feature, shape,
// diagrams) for the page's first step. Validated against the diff after the build.
let guide = { groups: [], suggestions: [], recommendations: [], overview: null };
const groupsPath = opt('--groups');
if (groupsPath) {
  let g;
  try { g = JSON.parse(fs.readFileSync(groupsPath, 'utf8')); }
  catch (e) { die(`cannot read --groups ${groupsPath}: ${e.message}`); }
  if (Array.isArray(g)) g = { groups: g };
  if (!g || !Array.isArray(g.groups)) die('--groups must be an array of groups or {groups: [...], suggestions: [...]}');
  // A recommendation bundles the line comments it stands for. They ride as ordinary suggestions
  // tagged with the recommendation's id, so the code view still shows each one at its line.
  const recommendations = (g.recommendations || []).map((r, i) => ({
    id: String(r.id || 'r' + (i + 1)), title: r.title, why: r.why || '', kind: r.kind || '', group: r.group || null,
    body: r.body || '', comments: r.comments || [],
    context: r.context || '', problem: r.problem || '', proposal: r.proposal || '', tradeoffs: r.tradeoffs || '',
    visuals: r.visuals || [], checks: r.checks || [], principle: r.principle || null,
  }));
  guide = {
    groups: g.groups.map((grp) => ({
      title: grp.title, why: grp.why || '', auto: !!grp.auto, summary: grp.summary || '', points: grp.points || [],
      files: (grp.files || []).map((e) => (typeof e === 'string' ? { path: e } : e)),
    })),
    suggestions: (g.suggestions || []).concat(recommendations.flatMap((r) => r.comments.map((c) => Object.assign({}, c, { rec: r.id })))),
    recommendations: recommendations.map(({ comments, ...r }) => Object.assign(r, { comments: comments.length })),
    overview: g.overview || null,
  };
}

// --- screenshots and recordings -------------------------------------------
// An image or video "diagram" names a file; it is read here and inlined as a data URL,
// so the page still works from file:// and can be mailed around.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
const MEDIA_WARN = 8 << 20, MEDIA_MAX = 60 << 20;
let mediaCount = 0, mediaBytes = 0;
const inlineMedia = (d) => {
  if (!d || typeof d !== 'object') return;
  if (d.kind === 'compare') { inlineMedia(d.before); inlineMedia(d.after); return; }
  if (!['image', 'video'].includes(d.kind) || !d.src || d.data) return;
  const where = [d.src, groupsPath && path.resolve(path.dirname(groupsPath), d.src)].filter(Boolean).find((p) => fs.existsSync(p));
  if (!where) die(`media: cannot find ${d.src} (paths are relative to the current directory or the --groups file)`);
  const ext = path.extname(where).slice(1).toLowerCase(), type = MIME[ext];
  if (!type) die(`media: ${d.src} is not a supported image or video (${Object.keys(MIME).join(', ')})`);
  if (!type.startsWith(d.kind)) die(`media: ${d.src} is a ${type.split('/')[0]}, but the entry says kind "${d.kind}"`);
  const buf = fs.readFileSync(where);
  if (buf.length > MEDIA_WARN) console.error(`media: ${d.src} is ${(buf.length / 1048576).toFixed(1)} MB; a shorter clip or a smaller screenshot keeps the page quick`);
  mediaCount++; mediaBytes += buf.length;
  d.data = `data:${type};base64,${buf.toString('base64')}`;
  d.src = path.basename(where);
};
if (guide.overview) {
  (guide.overview.diagrams || []).forEach(inlineMedia);
  ((guide.overview.connection && guide.overview.connection.steps) || []).forEach((st) => (st.visuals || []).forEach(inlineMedia));
}
guide.recommendations.forEach((r) => r.visuals.forEach(inlineMedia));

// --- principles ----------------------------------------------------------------
// A recommendation can name the guide section it rests on. The build copies that section into the
// page, so the reviewer can read the standard next to the recommendation, offline. Guides come from
// the cache review-guides.cjs filled (no network here); `guide` is a REVIEW.md-style spec or just a
// file name from the guides REVIEW.md lists.
const principleProblems = [];
if (guide.recommendations.some((r) => r.principle)) {
  const RG = require('./lib/review-guides.cjs');
  let root = process.cwd();
  try { root = git(['rev-parse', '--show-toplevel']).trim(); } catch (e) { /* not a repo */ }
  const listed = (RG.collect(root, { offline: true }) || { guides: [] }).guides.filter((g) => g.body != null);
  const find = (spec) => {
    const name = String(spec || '').trim();
    const hit = listed.find((g) => g.label === name || (g.entry.path || g.entry.local) === name ||
      path.posix.basename(g.entry.path || g.entry.local) === name);
    if (hit) return hit;
    const e = RG.parseSpec(name);
    const g = e && RG.load(e, { root, offline: true });
    return g && g.body != null ? g : null;
  };
  guide.recommendations.forEach((r) => {
    if (!r.principle) return;
    const p = typeof r.principle === 'string' ? { guide: r.principle.split('#')[0], section: r.principle.split('#')[1] || '' } : r.principle;
    const at = `recommendations: "${r.title}" principle`;
    const g = p.guide && find(p.guide);
    if (!g) { principleProblems.push(`${at}: no guide "${p.guide}" (list it in REVIEW.md and run review-guides.cjs)`); r.principle = { name: p.section || p.guide || '' }; return; }
    const sec = p.section ? RG.section(g.body, p.section) : null;
    if (p.section && !sec) principleProblems.push(`${at}: no section "${p.section}" in ${g.label}`);
    r.principle = { guide: g.label, title: RG.titleOf(g.body) || path.basename(g.file), name: sec ? sec.heading : '',
      text: sec ? (sec.text.length > 2400 ? sec.text.slice(0, 2400) + '…' : sec.text) : '' };
  });
}

// --- the PR description ------------------------------------------------------
// The author's own account of the change, with their screenshots. The overview shows the agent's
// digest of it and keeps the full text one click away. Images are downloaded (see lib/pr-media.cjs)
// and the body rewritten to point at them as attachment: links, which the page's Markdown inlines.
let description = null;
if (pr && prBody.trim() && !has('--no-description')) {
  let body = prBody;
  const images = {};
  const got = prMedia.download(prMedia.findImages(prBody), prMedia.defaultDir(pr), (m) => console.error('description: ' + m));
  got.forEach((g, i) => {
    const buf = fs.readFileSync(g.file);
    mediaBytes += buf.length;
    const id = 'd' + (i + 1), video = g.type.startsWith('video/');
    images[id] = `data:${g.type};base64,${buf.toString('base64')}`;
    // A video can't render inside Markdown, so it becomes a link the page turns into a player.
    body = body.split(g.match).join(video ? `[video: ${g.alt || 'recording'}](attachment:${id})` : `![${(g.alt || 'screenshot').replace(/[\[\]]/g, '')}](attachment:${id})`);
  });
  // Anything left (not on GitHub, or failed) stays a plain link: the page never fetches on its own.
  body = body.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, '[image]($1)');
  description = { author: pr.author, url: pr.url, body, images, files: got.map((g) => ({ id: 'd' + (got.indexOf(g) + 1), file: g.file, heading: g.heading, type: g.type })) };
}
if (mediaBytes > MEDIA_MAX) die(`media: ${(mediaBytes / 1048576).toFixed(1)} MB of screenshots and recordings is too much for one page; trim them`);

const out = opt('-o') || path.join('tmp', 'review', `${slug}.html`);
fs.mkdirSync(path.dirname(out), { recursive: true });

// --- the page -------------------------------------------------------------
const PAGE = path.join(__dirname, 'page');
const asset = (f) => fs.readFileSync(path.join(PAGE, f), 'utf8');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// JSON islands escape "<" so nothing inside them can close the script tag.
const island = (id, value) => `<script id="${id}" type="application/json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
const js = [fs.readFileSync(path.join(__dirname, 'lib', 'diff-parse.cjs'), 'utf8'), asset('highlight.js'), asset('markdown.js'),
  asset('diagrams.js'), asset('app.js')]
  .join('\n;\n').replace(/<\/script/gi, '<\\/script');
const event = (opt('--event') || 'COMMENT').toUpperCase().replace(/[\s-]+/g, '_');
if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) die('--event must be comment, approve or request_changes');
const meta = { title, slug, range, commitId, pr, event, headRev, baseRev, blobs, sizes, lastReview, since,
  repoRoot: headRev ? git(['rev-parse', '--show-toplevel']).trim() : null };

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${asset('style.css')}
</style></head><body>
<header>
<span class="steps" id="steps"><button data-step="overview"><b>1</b> Overview</button><button data-step="code"><b>2</b> Code</button><button data-step="submit"><b>3</b> Submit</button></span>
<span class="steps modes diffonly" id="modes" title="Recommendations or code (r)"><button data-mode="recs">Recommendations</button><button data-mode="diff">Code</button></span>
<h1>${esc(title)}</h1>
<span class="stats" id="stats"></span>
<button id="expand" class="diffonly codeonly">Expand all</button>
<button id="collapse" class="diffonly codeonly">Collapse all</button>
<button id="reset" class="diffonly codeonly">Reset viewed</button>
<button id="hltoggle" class="diffonly codeonly">Syntax highlighting: on</button>
<button id="wstoggle" class="diffonly codeonly">Whitespace: shown</button>
<button id="splittoggle" class="diffonly codeonly">View: unified</button>
<button id="keys" title="Keyboard shortcuts (?)">?</button>
<input type="search" id="q" class="diffonly codeonly" placeholder="Filter files…">
<button id="gosubmit" class="primary diffonly">Finish review</button>
</header>
<div class="layout"><nav><section class="meta" id="meta"></section><div class="navlbl">Files</div><div id="navlist"></div></nav><main id="main"><section id="recsview"></section><div id="filelist"></div></main></div>
<section id="overviewview"></section>
<section id="submitview"></section>
<section id="doneview"></section>
${island('diff-src', diff)}
${island('ws-src', wsMap)}
${island('threads-src', threads)}
${island('guide-src', guide)}
${island('meta-src', meta)}
${island('desc-src', description)}
<script id="server-src" type="application/json">null</script>
<script>
${js}
</script></body></html>`;

fs.writeFileSync(out, html);

// --- self-check: re-parse what we embedded, compare to git -----------------
if (numstat) {
  const embedded = JSON.parse(html.match(/<script id="diff-src" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const files = parseDiff(embedded);
  // -z numstat: "add\tdel\tpath\0", or "add\tdel\t\0old\0new\0" for a rename.
  const tok = numstat.split('\0');
  const rows = [];
  for (let i = 0; i < tok.length; i++) {
    if (!tok[i]) continue;
    // Split on the first two tabs only: a path can contain a tab.
    const [, a, d, name] = tok[i].match(/^([^\t]*)\t([^\t]*)\t([\s\S]*)$/);
    if (name) rows.push([a, d, name]);
    else { rows.push([a, d, tok[i + 2]]); i += 2; }
  }
  let bad = 0;
  for (const [a, d, name] of rows) {
    if (a === '-') continue; // binary
    const f = files.find((x) => x.name === name);
    if (!f) { console.error(`MISSING ${name}`); bad++; continue; }
    if (+a !== f.add || +d !== f.del) {
      console.error(`MISMATCH ${name}: git +${a}/-${d} vs parsed +${f.add}/-${f.del}`);
      bad++;
    }
  }
  if (bad) { console.error(`self-check FAILED (${bad} file(s))`); process.exit(1); }
  console.error(`self-check ok: ${files.length} files match git --numstat`);
}

// --- guide check: it must describe files and lines that actually changed ----
if (groupsPath) {
  const seen = new Set();
  let bad = 0, auto = 0, autoLines = 0;
  for (const g of guide.groups) {
    for (const e of g.files) {
      if (!byName.has(e.path)) { console.error(`groups: UNKNOWN file ${e.path}`); bad++; }
      else if (seen.has(e.path)) { console.error(`groups: DUPLICATE file ${e.path}`); bad++; }
      else {
        seen.add(e.path);
        if (g.auto || e.auto) {
          auto++;
          autoLines += byName.get(e.path).add + byName.get(e.path).del;
          if (!e.summary) console.error(`groups: auto-reviewed ${e.path} has no summary`);
        }
      }
    }
  }
  for (const s of guide.suggestions) {
    const f = byName.get(s.path);
    const problem = !s.body ? 'has no body' : !f ? 'names a file not in the diff'
      : s.line == null ? null : anchorProblem(commentableLines(f), s);
    if (problem) { console.error(`suggestions: ${s.path}:${s.line ?? 'file'} ${problem}`); bad++; }
  }
  // The overview: every check has text, every diagram can be drawn and lands somewhere real.
  const ov = guide.overview;
  if (ov) {
    // diagrams.js is browser source, so evaluate its text rather than require() it (see "Constraints").
    const DIAG = new Function('module', asset('diagrams.js') + '\nreturn DIAG;')({});
    const titles = new Set(guide.groups.map((g) => g.title));
    const checks = (ov.feature && ov.feature.checks) || [];
    checks.forEach((c, i) => { if (!(c && (typeof c === 'string' || c.text))) { console.error(`overview: check ${i + 1} has no text`); bad++; } });
    checks.forEach((c) => { if (c && c.path && !byName.has(c.path)) { console.error(`overview: check names a file not in the diff: ${c.path}`); bad++; } });
    (ov.diagrams || []).forEach((d, i) => {
      for (const p of DIAG.problems(d, `diagram ${i + 1}${d && d.title ? ` "${d.title}"` : ''}`)) { console.error(`overview: ${p}`); bad++; }
      if (d && d.group && !titles.has(d.group)) { console.error(`overview: diagram "${d.title || i + 1}" names an unknown group "${d.group}"`); bad++; }
      if (d && d.section && !['feature', 'connection', 'shape', 'recs'].includes(d.section)) { console.error(`overview: diagram "${d.title || i + 1}" section must be feature, connection, shape or recs`); bad++; }
    });
    const cx = ov.connection;
    if (cx) {
      const ids = new Set(checks.map((c) => c && c.id).filter(Boolean));
      (cx.steps || []).forEach((st, i) => {
        const at = `connection step ${i + 1}${st && st.title ? ` "${st.title}"` : ''}`;
        if (!st || !st.title) { console.error(`overview: ${at} has no title`); bad++; return; }
        (st.groups || []).forEach((t) => { if (!titles.has(t)) { console.error(`overview: ${at} names an unknown group "${t}"`); bad++; } });
        (st.files || []).forEach((f) => { if (!byName.has(f)) { console.error(`overview: ${at} names a file not in the diff: ${f}`); bad++; } });
        (st.checks || []).forEach((k) => { if (!ids.has(k)) { console.error(`overview: ${at} names an unknown check id "${k}" (give the check an "id")`); bad++; } });
        (st.visuals || []).forEach((d, j) => { for (const p of DIAG.problems(d, `${at} visual ${j + 1}`)) { console.error(`overview: ${p}`); bad++; } });
      });
    }
    const objs = (ov.shape && ov.shape.objects) || [];
    objs.forEach((o) => { if (o && o.path && !byName.has(o.path)) { console.error(`overview: shape object names a file not in the diff: ${o.path}`); bad++; } });
  }
  const groupTitles = new Set(guide.groups.map((g) => g.title)), rids = new Set();
  const DIAG = new Function('module', asset('diagrams.js') + '\nreturn DIAG;')({});
  const checkIds = new Set(((ov && ov.feature && ov.feature.checks) || []).map((c) => c && c.id).filter(Boolean));
  // Keep in step with REC_PARTS in page/app.js.
  const PARTS = ['context', 'problem', 'proposal', 'tradeoffs'];
  const REC_PARTS = { bug: ['context', 'problem', 'proposal'], risk: PARTS, design: PARTS, tests: ['context', 'problem', 'proposal'],
    style: ['context', 'proposal', 'tradeoffs'], question: ['context', 'problem', 'tradeoffs'] };
  guide.recommendations.forEach((r, i) => {
    const at = `recommendations: ${r.title ? `"${r.title}"` : i + 1}`;
    if (!r.title) { console.error(`${at} has no title`); bad++; }
    if (rids.has(r.id)) { console.error(`${at} repeats id ${r.id}`); bad++; }
    rids.add(r.id);
    if (r.group && !groupTitles.has(r.group)) { console.error(`${at} names an unknown group "${r.group}"`); bad++; }
    if (r.kind && !REC_PARTS[r.kind]) { console.error(`${at} has unknown kind "${r.kind}" (bug, risk, design, tests, style or question); it shows every section`); }
    // The kind decides which short sections a recommendation has; the page only shows those.
    const extra = PARTS.filter((p) => r[p] && r.kind && REC_PARTS[r.kind] && !REC_PARTS[r.kind].includes(p));
    if (extra.length) console.error(`${at}: a ${r.kind} recommendation doesn't show ${extra.join(', ')}; it will be hidden`);
    // Sections are meant to be read at a glance: one sentence, two at most.
    PARTS.forEach((p) => {
      const n = String(r[p] || '').replace(/`[^`]*`/g, 'x').split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
      if (n > 2 || String(r[p] || '').length > 260) console.error(`${at}: ${p} is long (${n} sentences); keep it to one, two at most`);
    });
    r.visuals.forEach((d, j) => { for (const p of DIAG.problems(d, `${at} visual ${j + 1}`)) { console.error(p); bad++; } });
    r.checks.forEach((k) => { if (!checkIds.has(k)) { console.error(`${at} names an unknown check id "${k}" (give the check an "id")`); bad++; } });
  });
  principleProblems.forEach((p) => console.error(p));
  if (bad) { console.error(`groups check FAILED (${bad} problem(s))`); process.exit(1); }
  const loose = byName.size - seen.size;
  const total = parsed.reduce((n, f) => n + f.add + f.del, 0);
  console.error(
    `groups ok: ${guide.groups.length} group(s) cover ${seen.size}/${byName.size} files` +
      (loose ? ` (${loose} in "Unsorted")` : '') +
      (auto ? `; ${auto} auto-reviewed (${autoLines}/${total} lines)` : '') +
      (guide.suggestions.length ? `; ${guide.suggestions.length} suggested comment(s)` : '') +
      (guide.recommendations.length ? `; ${guide.recommendations.length} recommendation(s)` : '') +
      (guide.groups.length ? `; ${guide.groups.filter((g) => g.summary || g.points.length).length}/${guide.groups.length} group(s) with a gist` : '')
  );
  const unbundled = guide.suggestions.filter((s) => !s.rec).length;
  if (unbundled && guide.recommendations.length) console.error(`recommendations: ${unbundled} suggested comment(s) belong to no recommendation; each shows as its own`);
  if (mediaCount) console.error(`media: ${mediaCount} screenshot(s)/recording(s) inlined, ${(mediaBytes / 1048576).toFixed(1)} MB`);
  if (ov) {
    const ds = ov.diagrams || [];
    const steps = (ov.connection && ov.connection.steps) || [];
    const stepVisuals = steps.reduce((n, st) => n + (st.visuals || []).length, 0);
    console.error(`overview ok: feature${ov.feature ? '' : ' (missing)'}` +
      `, ${(ov.feature && ov.feature.checks || []).length} check(s)` +
      `, connection${ov.connection ? ` (${steps.length} step(s), ${stepVisuals} visual(s), ${steps.reduce((n, st) => n + (st.checks || []).length, 0)} check(s) placed)` : ' (missing)'}` +
      `, author${ov.author ? '' : description ? ' (missing: the PR has a description)' : ' (none)'}` +
      `, shape${ov.shape ? '' : ' (missing)'}` +
      `, ${ds.length} diagram(s)` + (ds.some((d) => d.group) ? ` (${ds.filter((d) => d.group).length} in groups)` : ''));
  } else console.error('overview: none (the page opens on the code; the Overview step shows only the computed shape)');
}
console.error(pr ? `pr: ${pr.owner}/${pr.repo}#${pr.number} at ${commitId.slice(0, 10)}` : 'pr: none (comments stay local)');
if (description) console.error(`description: ${description.body.length} chars, ${Object.keys(description.images).length} image(s) from the PR` +
  (description.files.length ? ` (saved in ${path.dirname(description.files[0].file)})` : ''));
if (pr && !has('--no-threads')) {
  const here = threads.filter((t) => byName.has(t.path));
  const open = here.filter((t) => !t.resolved).length;
  console.error(`threads: ${here.length} on files in this diff (${open} unresolved)` +
    (threads.length > here.length ? `; ${threads.length - here.length} on other files, not shown` : ''));
}
if (since) {
  console.error(`re-review: showing changes since ${since.sha.slice(0, 10)}` +
    (since.rebased ? ' (not an ancestor of the head: the branch was rebased, so this includes upstream changes)' : ''));
} else if (lastReview) {
  const when = lastReview.at.slice(0, 10);
  if (!lastReview.changed) console.error(`re-review: you reviewed at ${lastReview.sha.slice(0, 10)} on ${when}, which is not fetchable here`);
  else if (!lastReview.changed.length) console.error(`re-review: you already reviewed this head (${when}); nothing changed since`);
  else console.error(`re-review: you reviewed at ${lastReview.sha.slice(0, 10)} on ${when}; ${lastReview.changed.length} file(s) changed since` +
    (lastReview.rebased ? ' (rebased since)' : '') + '. Rebuild with --since last to see only those changes.');
}

if (has('--serve')) {
  require('./serve-review.cjs').serve(out, { port: +(opt('--port') || 4823), keepAlive: has('--keep-alive') });
} else {
  console.log(out);
}
