/**
 * Review lifecycle events for an outside watcher (a menu bar app, say). Off unless
 * FEATURE_REVIEW_EVENTS_DIR is set; then each event is one JSON line in
 * <dir>/<owner>__<repo>__<pr>.jsonl with ts, pr and repo ("owner/repo") added.
 * Only reviews of a PR are logged. Writing must never get in the way of a review.
 */
const fs = require('fs');
const path = require('path');

function emit(pr, event, fields = {}) {
  const dir = process.env.FEATURE_REVIEW_EVENTS_DIR;
  if (!dir || !pr || !pr.owner || !pr.repo || !pr.number) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), event, pr: pr.number, repo: `${pr.owner}/${pr.repo}` }, fields));
    fs.appendFileSync(path.join(dir, `${pr.owner}__${pr.repo}__${pr.number}.jsonl`), line + '\n');
  } catch (e) { /* a watcher's log is never worth failing a review over */ }
}

const noOpen = () => !!process.env.FEATURE_REVIEW_NO_OPEN && process.env.FEATURE_REVIEW_NO_OPEN !== '0';

module.exports = { emit, noOpen };
