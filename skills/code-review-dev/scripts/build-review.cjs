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
 *   node build-review.cjs <commit-ish> --groups g.json  # reading guide, auto-reviews, suggestions
 *   node build-review.cjs <commit-ish> --serve [--port N]  # serve on localhost so Submit can post
 *   node build-review.cjs --pr <N> --event approve      # default verdict on the submit page
 *   node build-review.cjs --pr <N> --since last         # only what changed since your last review
 *   node build-review.cjs --pr <N> --no-threads         # skip loading the PR's existing review threads
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
let pr = null, lastReview = null;
if (opt('--pr')) {
  const spec = opt('--pr');
  const m = spec.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  const args = m ? [m[2], '--repo', m[1]] : [spec];
  let j;
  try {
    j = JSON.parse(run('gh', ['pr', 'view', ...args, '--json',
      'number,url,title,headRefOid,baseRefOid,headRefName,baseRefName,author,state']));
  } catch (e) { die(`cannot read PR ${spec} with gh: ${(e.stderr || e.message).toString().trim()}`); }
  const u = j.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  pr = { owner: u[1], repo: u[2], number: j.number, url: j.url, title: j.title, author: j.author && j.author.login,
    state: j.state, headSha: j.headRefOid, baseSha: j.baseRefOid, headRef: j.headRefName, baseRef: j.baseRefName };
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
    const mine = run('gh', ['api', '--paginate', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, '--jq',
      `.[] | select(.user.login == "${me}" and .submitted_at != null) | [.commit_id, .submitted_at, .state] | @tsv`])
      .trim().split('\n').filter(Boolean);
    if (mine.length) {
      const [sha, at, state] = mine[mine.length - 1].split('\t');
      lastReview = { sha, at, state };
    }
  } catch (e) { console.error(`re-review: could not read your past reviews (${(e.stderr || e.message).toString().trim()})`); }
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

let diff, numstat = null, wsDiff = null, headRev = null, title, slug, range = null, commitId = opt('--commit');
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
  diff = git(['diff', ...args]);
  numstat = git(['diff', '--numstat', '-z', ...args]);
  wsDiff = git(['diff', '-w', ...args]);
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
// with groups in relevance order. Validated against the diff after the build.
let guide = { groups: [], suggestions: [] };
const groupsPath = opt('--groups');
if (groupsPath) {
  let g;
  try { g = JSON.parse(fs.readFileSync(groupsPath, 'utf8')); }
  catch (e) { die(`cannot read --groups ${groupsPath}: ${e.message}`); }
  if (Array.isArray(g)) g = { groups: g };
  if (!g || !Array.isArray(g.groups)) die('--groups must be an array of groups or {groups: [...], suggestions: [...]}');
  guide = {
    groups: g.groups.map((grp) => ({
      title: grp.title, why: grp.why || '', auto: !!grp.auto,
      files: (grp.files || []).map((e) => (typeof e === 'string' ? { path: e } : e)),
    })),
    suggestions: g.suggestions || [],
  };
}

const out = opt('-o') || path.join('tmp', 'review', `${slug}.html`);
fs.mkdirSync(path.dirname(out), { recursive: true });

// --- the page -------------------------------------------------------------
const PAGE = path.join(__dirname, 'page');
const asset = (f) => fs.readFileSync(path.join(PAGE, f), 'utf8');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// JSON islands escape "<" so nothing inside them can close the script tag.
const island = (id, value) => `<script id="${id}" type="application/json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
const js = [fs.readFileSync(path.join(__dirname, 'lib', 'diff-parse.cjs'), 'utf8'), asset('highlight.js'), asset('markdown.js'), asset('app.js')]
  .join('\n;\n').replace(/<\/script/gi, '<\\/script');
const event = (opt('--event') || 'COMMENT').toUpperCase().replace(/[\s-]+/g, '_');
if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) die('--event must be comment, approve or request_changes');
const meta = { title, slug, range, commitId, pr, event, headRev, blobs, lastReview, since,
  repoRoot: headRev ? git(['rev-parse', '--show-toplevel']).trim() : null };

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${asset('style.css')}
</style></head><body>
<header>
<button id="goback" class="submitonly">&larr; Back to diff</button>
<h1>${esc(title)}</h1>
<span class="stats" id="stats"></span>
<button id="expand" class="diffonly">Expand all</button>
<button id="collapse" class="diffonly">Collapse all</button>
<button id="reset" class="diffonly">Reset viewed</button>
<button id="hltoggle">Syntax: on</button>
<button id="wstoggle" class="diffonly">Whitespace: shown</button>
<button id="splittoggle" class="diffonly">View: unified</button>
<button id="keys" title="Keyboard shortcuts (?)">?</button>
<input type="search" id="q" class="diffonly" placeholder="Filter files…">
<button id="gosubmit" class="primary diffonly">Finish review</button>
</header>
<div class="layout"><nav><section class="meta" id="meta"></section><div class="navlbl">Files</div><div id="navlist"></div></nav><main id="main"><div id="filelist"></div></main></div>
<section id="submitview"></section>
<section id="doneview"></section>
${island('diff-src', diff)}
${island('ws-src', wsMap)}
${island('threads-src', threads)}
${island('guide-src', guide)}
${island('meta-src', meta)}
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
  if (bad) { console.error(`groups check FAILED (${bad} problem(s))`); process.exit(1); }
  const loose = byName.size - seen.size;
  const total = parsed.reduce((n, f) => n + f.add + f.del, 0);
  console.error(
    `groups ok: ${guide.groups.length} group(s) cover ${seen.size}/${byName.size} files` +
      (loose ? ` (${loose} in "Unsorted")` : '') +
      (auto ? `; ${auto} auto-reviewed (${autoLines}/${total} lines)` : '') +
      (guide.suggestions.length ? `; ${guide.suggestions.length} suggested comment(s)` : '')
  );
}
console.error(pr ? `pr: ${pr.owner}/${pr.repo}#${pr.number} at ${commitId.slice(0, 10)}` : 'pr: none (comments stay local)');
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
