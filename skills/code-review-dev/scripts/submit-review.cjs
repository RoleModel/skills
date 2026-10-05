#!/usr/bin/env node
/**
 * submit-review.cjs: post a review exported from the review page to GitHub as
 * one pull request review, through the gh CLI.
 *
 * Usage:
 *   node submit-review.cjs review.json [--dry-run]
 *   pbpaste | node submit-review.cjs - [--dry-run]
 *
 * The page is the approval step; this only delivers what it was given. Before
 * posting it checks each comment against the diff GitHub will anchor it to:
 * a comment GitHub would reject (a line outside the PR diff, a range across
 * hunks) is moved into the review summary with its file and line, instead of
 * failing the whole review. Whole-file comments and replies to existing
 * threads go through GraphQL onto the same pending review, since the REST
 * review endpoint only takes new line comments.
 *
 * GitHub has no API for uploading attachments. Attached files are written to
 * disk and their links replaced with a placeholder; the result lists them so
 * they can be dragged into the posted comments.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseDiff, commentableLines, anchorProblem } = require('./lib/diff-parse.cjs');

const short = (sha) => String(sha || '').slice(0, 10);
const ATT_LINK = (id) => new RegExp('!?\\[([^\\]]*)\\]\\(attachment:' + id + '\\)', 'g');

function cmdError(e) {
  const out = [e.stdout, e.stderr].map((s) => (s ? s.toString().trim() : '')).filter(Boolean).join('\n');
  return out || e.message;
}

// Review JSON can be pasted in by hand, so the parts that become file names must not climb out of outDir.
function plainName(value, what, pattern) {
  if (!pattern.test(value) || /^\.+$/.test(value)) throw new Error(`Refusing ${what} ${JSON.stringify(value)}: it must be a plain file name.`);
  return value;
}
const slugOf = (review) => plainName(review.slug || 'review', 'slug', /^[\w.-]+$/);

// Write a review's attachments next to the page and point Markdown at them.
function writeAttachments(review, outDir) {
  const dir = path.join(outDir, `${slugOf(review)}-attachments`);
  const saved = {};
  const all = (review.attachments || []).concat(...(review.comments || []).map((c) => c.attachments || []));
  for (const a of all) {
    if (!a || !a.data || saved[a.id]) continue;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${plainName(String(a.id), 'attachment id', /^[\w-]+$/)}-${String(a.name || 'file').replace(/[^\w.-]+/g, '_')}`);
    fs.writeFileSync(file, Buffer.from(a.data.split(',')[1] || '', 'base64'));
    saved[a.id] = { name: a.name, file: path.resolve(file) };
  }
  return saved;
}

// Save the review as JSON (attachment data replaced by paths) and Markdown, for an agent or a human to pick up.
function saveReview(review, outDir) {
  const saved = writeAttachments(review, outDir);
  const base = path.join(outDir, slugOf(review));
  let md = review.markdown || '';
  for (const [id, a] of Object.entries(saved)) md = md.replace(ATT_LINK(id), (m, alt) => m.replace(`attachment:${id}`, a.file));
  const strip = (list) => (list || []).map((a) => ({ id: a.id, name: a.name, type: a.type, file: saved[a.id] && saved[a.id].file }));
  const json = Object.assign({}, review, {
    markdown: md,
    attachments: strip(review.attachments),
    comments: (review.comments || []).map((c) => Object.assign({}, c, { attachments: strip(c.attachments) })),
  });
  fs.writeFileSync(`${base}.review.json`, JSON.stringify(json, null, 2));
  fs.writeFileSync(`${base}.review.md`, md);
  return { json: path.resolve(`${base}.review.json`), markdown: path.resolve(`${base}.review.md`), attachments: Object.values(saved) };
}

function submitReview(review, opts = {}) {
  const { dryRun = false, cwd = process.cwd(), outDir = path.join(cwd, 'tmp', 'review') } = opts;
  const pr = review.pr;
  if (!pr) throw new Error('This review has no pull request linked, so there is nothing to post. Copy it as Markdown or save it instead.');
  const repo = `${pr.owner}/${pr.repo}`;
  const run = (cmd, args, input) => execFileSync(cmd, args, { cwd, encoding: 'utf8', input, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
  const gh = (args, input) => {
    try { return run('gh', args, input); } catch (e) { throw new Error(cmdError(e)); }
  };

  const live = JSON.parse(gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'author,headRefOid,baseRefOid,state,url']));
  const me = gh(['api', 'user', '--jq', '.login']).trim();
  const event = review.event || 'COMMENT';
  if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) throw new Error(`Unknown review event ${event}`);
  if (live.author && live.author.login === me && event !== 'COMMENT') {
    throw new Error(`GitHub does not let you ${event === 'APPROVE' ? 'approve' : 'request changes on'} your own pull request. Choose "Comment" instead.`);
  }
  const commitId = review.commit_id || live.headRefOid;
  const notes = [];
  if (live.state !== 'OPEN') notes.push(`The PR is ${live.state.toLowerCase()}.`);
  if (commitId !== live.headRefOid) {
    notes.push(`Reviewed at ${short(commitId)}, but the PR head is now ${short(live.headRefOid)}; GitHub may mark comments as outdated.`);
  }

  // The diff GitHub anchors comments to: the PR base merged with the reviewed commit.
  let prDiff;
  try { prDiff = run('git', ['diff', `${live.baseRefOid}...${commitId}`]); }
  catch (e) {
    prDiff = gh(['pr', 'diff', String(pr.number), '--repo', repo, '--color', 'never']);
    if (commitId !== live.headRefOid) notes.push('Could not diff the reviewed commit locally; checked lines against the current PR diff instead.');
  }
  const anchors = new Map(parseDiff(prDiff).map((f) => [f.name, commentableLines(f)]));

  // Attachments: GitHub can't take them over the API, so leave a marker and list the files.
  const saved = dryRun ? {} : writeAttachments(review, outDir);
  const unattach = (body, list) => (list || []).reduce((b, a) => b.replace(ATT_LINK(a.id), (m, alt) => `**[attachment: ${alt || a.name}]**`), body || '');
  if (dryRun) {
    const n = (review.attachments || []).length + (review.comments || []).reduce((k, c) => k + (c.attachments || []).length, 0);
    if (n) notes.push(`${n} attachment(s) will be saved locally and replaced with a placeholder; GitHub has no upload API, so they have to be dragged into the posted comments.`);
  }
  for (const a of Object.values(saved)) notes.push(`Attachment "${a.name}" saved to ${a.file}; GitHub has no upload API, so drag it into the comment on GitHub.`);

  const inline = [], files = [], replies = [], folded = [];
  for (const c of review.comments || []) {
    const body = unattach(c.body, c.attachments).trim();
    if (!body) continue;
    if (c.subject === 'reply') {
      if (c.thread_id) replies.push({ thread: c.thread_id, body, c });
      else folded.push({ c, body, why: 'the thread it replies to is unknown' });
      continue;
    }
    if (c.subject === 'file') {
      if (anchors.has(c.path)) files.push({ path: c.path, body });
      else folded.push({ c, body, why: 'file is not in the PR diff' });
      continue;
    }
    const problem = anchorProblem(anchors.get(c.path), c);
    if (problem) { folded.push({ c, body, why: problem }); continue; }
    const out = { path: c.path, body, line: c.line, side: c.side || 'RIGHT' };
    if (c.start_line != null && c.start_line !== c.line) Object.assign(out, { start_line: c.start_line, start_side: c.start_side || out.side });
    inline.push(out);
  }

  const foldSection = (list) => !list.length ? '' : '\n\n---\n\n**Comments GitHub could not anchor to the diff:**\n\n' + list.map(({ c, body, why }) => {
    if (c.subject === 'reply') return `**Reply on \`${c.path}\`${c.line != null ? ` line ${c.line}` : ''}** _(${why})_\n\n${body}`;
    const where = c.subject === 'file' ? '' : c.start_line != null && c.start_line !== c.line ? ` lines ${c.start_line}-${c.line}` : ` line ${c.line}`;
    return `**\`${c.path}\`${where}${c.side === 'LEFT' ? ' (old)' : ''}** _(${why})_\n\n${body}`;
  }).join('\n\n');
  let body = unattach(review.body, review.attachments).trim() + foldSection(folded);
  body = body.trim();
  if (folded.length) notes.push(`${folded.length} comment(s) will be added to the review summary because GitHub cannot anchor them inline.`);
  if (!body && !inline.length && !files.length && !replies.length && event !== 'APPROVE') throw new Error('Nothing to submit: add a summary or at least one comment.');

  const payload = { commit_id: commitId, event, body, comments: inline };
  const result = { dryRun, url: null, inline: inline.length, fileComments: files.length, replies: replies.length, folded: folded.length, notes,
    payload, fileThreads: files, threadReplies: replies.map((r) => ({ thread: r.thread, body: r.body })) };
  if (dryRun) return result;

  const reviews = `repos/${repo}/pulls/${pr.number}/reviews`;
  if (!files.length && !replies.length) {
    const res = JSON.parse(gh(['api', '-X', 'POST', reviews, '--input', '-'], JSON.stringify(payload)));
    result.url = res.html_url;
    return result;
  }

  // Whole-file comments and replies: open a pending review, add them to it over GraphQL, then submit it.
  let pending;
  try { pending = JSON.parse(gh(['api', '-X', 'POST', reviews, '--input', '-'], JSON.stringify({ commit_id: commitId, comments: inline }))); }
  catch (e) {
    throw new Error(e.message + (/pending review/i.test(e.message) ? '\nYou already have a pending review on this PR; submit or discard it on GitHub first.' : ''));
  }
  const Q = 'mutation($rid:ID!,$path:String!,$body:String!){addPullRequestReviewThread(input:{pullRequestReviewId:$rid,path:$path,body:$body,subjectType:FILE}){thread{id}}}';
  const failed = [];
  for (const f of files) {
    try { gh(['api', 'graphql', '-f', `query=${Q}`, '-f', `rid=${pending.node_id}`, '-f', `path=${f.path}`, '-f', `body=${f.body}`]); }
    catch (e) { failed.push({ c: { path: f.path, subject: 'file' }, body: f.body, why: 'GitHub rejected the file comment' }); }
  }
  const R = 'mutation($rid:ID!,$tid:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$rid,pullRequestReviewThreadId:$tid,body:$body}){comment{id}}}';
  for (const r of replies) {
    try { gh(['api', 'graphql', '-f', `query=${R}`, '-f', `rid=${pending.node_id}`, '-f', `tid=${r.thread}`, '-f', `body=${r.body}`]); }
    catch (e) { failed.push({ c: r.c, body: r.body, why: 'GitHub rejected the reply' }); }
  }
  if (failed.length) {
    body = (body + foldSection(failed)).trim();
    notes.push(`${failed.length} file comment(s) or replies were moved into the summary because GitHub rejected them.`);
  }
  try {
    const res = JSON.parse(gh(['api', '-X', 'POST', `${reviews}/${pending.id}/events`, '--input', '-'], JSON.stringify({ event, body })));
    result.url = res.html_url;
  } catch (e) {
    throw new Error(`A pending review (${pending.id}) was created but could not be submitted:\n${e.message}\nOpen ${live.url} to submit or discard it.`);
  }
  return result;
}

module.exports = { submitReview, saveReview };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const src = argv.find((a) => !a.startsWith('--'));
  if (!src) { console.error('usage: submit-review.cjs <review.json|-> [--dry-run]'); process.exit(2); }
  let review;
  try { review = JSON.parse(fs.readFileSync(src === '-' ? 0 : src, 'utf8')); }
  catch (e) { console.error(`error: cannot read review JSON: ${e.message}`); process.exit(2); }
  try {
    const r = submitReview(review, { dryRun: argv.includes('--dry-run') });
    if (r.dryRun) console.log(JSON.stringify({ payload: r.payload, fileThreads: r.fileThreads, threadReplies: r.threadReplies }, null, 2));
    r.notes.forEach((n) => console.error('note: ' + n));
    console.error(`${r.dryRun ? 'would post' : 'posted'}: ${r.inline} inline, ${r.fileComments} file, ${r.replies} repl${r.replies === 1 ? 'y' : 'ies'}, ` +
      `${r.folded} folded into summary`);
    if (r.url) console.log(r.url);
  } catch (e) {
    console.error('error: ' + e.message);
    process.exit(1);
  }
}
