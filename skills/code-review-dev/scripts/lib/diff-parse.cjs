/**
 * diff-parse.cjs: the one unified-diff parser, shared by Node and the page.
 *
 * build-review.cjs requires it for the self-check and to validate suggested
 * comments, submit-review.cjs requires it to work out which lines GitHub will
 * accept comments on, and the review page gets this same source inlined so the
 * numbers it shows are the numbers that were checked.
 *
 * Header lines (index, ---, +++, mode, rename) are only recognised before a
 * file's first hunk. Inside a hunk every line is content, so removing a SQL
 * comment like "-- note" (which arrives as "--- note") still counts as a deletion.
 */
(function (root) {
  function parseDiff(raw) {
    const files = [];
    let cur = null, inHunk = false, hunk = -1;
    for (const line of String(raw).replace(/\n$/, '').split('\n')) {
      if (line.startsWith('diff --git ')) {
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        cur = { name: m ? m[2] : line.slice(11), old: m ? m[1] : '', rows: [], add: 0, del: 0, status: 'modified' };
        files.push(cur);
        inHunk = false;
        hunk = -1;
        continue;
      }
      if (!cur) continue;
      if (line.startsWith('@@')) {
        const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        cur.ol = m ? +m[1] : 0;
        cur.nl = m ? +m[3] : 0;
        inHunk = true;
        hunk++;
        // Start and length of each side, so the page can work out the unchanged lines between hunks.
        cur.rows.push({ t: 'h', text: line, hunk, o: cur.ol, oc: m && m[2] != null ? +m[2] : 1, n: cur.nl, nc: m && m[4] != null ? +m[4] : 1 });
        continue;
      }
      if (!inHunk) {
        if (line.startsWith('new file')) cur.status = 'added';
        else if (line.startsWith('deleted file')) cur.status = 'deleted';
        else if (line.startsWith('rename from')) cur.status = 'renamed';
        else if (line.startsWith('Binary files')) cur.rows.push({ t: 'm', text: line });
        continue;
      }
      if (line.startsWith('\\')) { cur.rows.push({ t: 'm', text: line }); continue; }
      const c = line[0], text = line.slice(1);
      if (c === '+') { cur.add++; cur.rows.push({ t: 'a', n2: cur.nl++, text, hunk }); }
      else if (c === '-') { cur.del++; cur.rows.push({ t: 'd', n1: cur.ol++, text, hunk }); }
      else if (c === ' ' || line === '') { cur.rows.push({ t: 'c', n1: cur.ol++, n2: cur.nl++, text, hunk }); }
    }
    return files;
  }

  // GitHub anchors a comment to (side, line): RIGHT is the new file and covers
  // added and context lines, LEFT is the old file and covers deleted and
  // context lines. The value is the hunk index, because a multi-line comment
  // has to start and end inside the same hunk.
  function commentableLines(file) {
    const out = { RIGHT: new Map(), LEFT: new Map() };
    for (const r of file.rows) {
      if (r.t === 'a' || r.t === 'c') out.RIGHT.set(r.n2, r.hunk);
      if (r.t === 'd' || r.t === 'c') out.LEFT.set(r.n1, r.hunk);
    }
    return out;
  }

  // Why a comment can't be anchored inline, or null if it can.
  function anchorProblem(lines, c) {
    if (!lines) return 'file is not in the diff';
    const side = c.side || 'RIGHT';
    const end = lines[side] && lines[side].get(c.line);
    if (end === undefined) return 'line ' + c.line + ' is not in the diff';
    if (c.start_line != null) {
      const startSide = c.start_side || side;
      const start = lines[startSide] && lines[startSide].get(c.start_line);
      if (start === undefined) return 'line ' + c.start_line + ' is not in the diff';
      if (start !== end) return 'lines ' + c.start_line + '-' + c.line + ' span more than one hunk';
    }
    return null;
  }

  const api = { parseDiff, commentableLines, anchorProblem };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiffParse = api;
})(this);
