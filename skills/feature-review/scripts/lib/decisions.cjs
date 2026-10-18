/**
 * The reviewer's yes/no answers to recommendations, kept across reviews so the agent can notice what
 * they keep turning down and offer to say so in their preferences. One JSON line per recommendation
 * per save, in ~/.claude/feature-review/decisions.jsonl; a later save of the same review replaces the
 * earlier answer when read back. Patterns the reviewer has already been asked about are remembered
 * in patterns-ack.json, so they are raised again only once there is clearly more evidence.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'feature-review');
const LOG = path.join(DIR, 'decisions.jsonl');
const ACK = path.join(DIR, 'patterns-ack.json');
// A pattern needs this many decided recommendations, and this share of them declined.
const MIN = 5, NO_SHARE = 0.7, MORE = 5;

function logDecisions(review) {
  const recs = (review.recommendations || []).filter((r) => r.status && r.status !== 'open');
  if (!recs.length) return 0;
  const at = new Date().toISOString();
  const where = review.pr ? review.pr.url : review.slug || review.title || 'review';
  const repo = review.pr ? review.pr.owner + '/' + review.pr.repo : null;
  const lines = recs.map((r) => JSON.stringify({ at, review: where, repo, id: r.id || r.title, title: r.title, kind: r.kind || null,
    principle: r.principle ? r.principle.name : null, guide: r.principle ? r.principle.guide : null, status: r.status,
    from_concern: !!r.from_concern }));
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(LOG, lines.join('\n') + '\n');
  return lines.length;
}

function read() {
  if (!fs.existsSync(LOG)) return [];
  const last = new Map();
  fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).forEach((l) => {
    try { const d = JSON.parse(l); last.set(d.review + '\u0000' + d.id, d); } catch (e) { /* a torn line: skip it */ }
  });
  return Array.from(last.values());
}
const readAck = () => { try { return JSON.parse(fs.readFileSync(ACK, 'utf8')); } catch (e) { return {}; } };

// Groups by kind, by principle, and by kind within a repo. A "mixed" answer (some comments kept)
// counts as half a yes. Yeses that came from a concern on a feature check are left out: the reviewer
// didn't weigh the recommendation itself.
function patterns() {
  const ds = read().filter((d) => !d.from_concern), ack = readAck(), groups = new Map();
  const add = (key, label, d) => { if (!groups.has(key)) groups.set(key, { key, label, list: [] }); groups.get(key).list.push(d); };
  ds.forEach((d) => {
    if (d.kind) add('kind:' + d.kind, d.kind + ' recommendations', d);
    if (d.kind && d.repo) add('repo-kind:' + d.repo + ':' + d.kind, d.kind + ' recommendations in ' + d.repo, d);
    if (d.principle) add('principle:' + (d.guide || '') + ':' + d.principle, 'recommendations citing "' + d.principle + '"' + (d.guide ? ' (' + d.guide + ')' : ''), d);
  });
  const out = [];
  groups.forEach((g) => {
    const n = g.list.length, no = g.list.filter((d) => d.status === 'no').length + g.list.filter((d) => d.status === 'mixed').length / 2;
    if (n < MIN || no / n < NO_SHARE) return;
    out.push({ key: g.key, label: g.label, n, no, last: g.list.map((d) => d.at).sort().pop(),
      declined: g.list.filter((d) => d.status === 'no').slice(-4).map((d) => d.title),
      kept: g.list.filter((d) => d.status === 'yes').slice(-2).map((d) => d.title) });
  });
  // A repo-specific pattern says more than the same kind everywhere; drop the general one when they
  // cover the same answers. Then hold back what the reviewer was already asked about.
  return out.filter((p) => !(p.key.startsWith('kind:') && out.some((q) => q.key.startsWith('repo-kind:') && q.key.endsWith(':' + p.key.slice(5)) && q.n === p.n)))
    .filter((p) => !(ack[p.key] && p.n < ack[p.key] + MORE));
}

function ackPattern(key) {
  const g = read().filter((d) => !d.from_concern);
  const n = g.filter((d) => (key.startsWith('kind:') && 'kind:' + d.kind === key) ||
    (key.startsWith('repo-kind:') && 'repo-kind:' + d.repo + ':' + d.kind === key) ||
    (key.startsWith('principle:') && 'principle:' + (d.guide || '') + ':' + d.principle === key)).length;
  const ack = readAck();
  ack[key] = n;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(ACK, JSON.stringify(ack, null, 2) + '\n');
  return n;
}

module.exports = { LOG, logDecisions, read, patterns, ackPattern };
