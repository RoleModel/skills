/**
 * The review page. build-review.cjs inlines this after diff-parse, highlight,
 * markdown and diagrams, alongside JSON islands: #diff-src (the raw diff),
 * #ws-src (the whitespace-insensitive diff for the files where it differs),
 * #threads-src (the PR's existing review threads), #guide-src (overview,
 * reading guide, auto-reviewed files, suggested comments) and #meta-src (title,
 * slug, PR, commit, file blobs and sizes, last review).
 *
 * The review runs in steps, one view each: Story (#story: the PR description and
 * how the feature comes together), Checks (#checks), Shape (#shape: diagrams and
 * where the lines landed), Recommendations (#recs: one group at a time, its gist
 * then each recommendation to say yes or no to), Code (#code, or a file or group
 * anchor) and Submit (#submit), then #done once posted. #server-src is null from file:// and carries a token
 * when serve-review.cjs serves the page, which is what enables Submit and
 * expanding context.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = MD.esc;
  const readJSON = (id, fallback) => {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.textContent) ?? fallback; } catch (e) { return fallback; }
  };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hash = (s) => s.split('').reduce((h, c) => (h * 33 ^ c.charCodeAt(0)) >>> 0, 5381);
  const plural = (n, word, many) => n + ' ' + (n === 1 ? word : many || word + 's');

  const files = DiffParse.parseDiff(readJSON('diff-src', ''));
  const META = readJSON('meta-src', {});
  const GUIDE = readJSON('guide-src', { groups: [], suggestions: [] });
  const SERVER = readJSON('server-src', null);
  const WS = readJSON('ws-src', null);
  const PR = META.pr || null;
  const OV = GUIDE.overview || null;
  const mdHtml = (s) => MD.render(String(s || ''), {});
  const hdr = document.querySelector('header');
  const canExpand = !!(SERVER && META.headRev);

  // Saved state is keyed to the PR, so a rebuilt page, a --since page and the
  // full page share one set of drafts. Without a PR it is keyed to the title and
  // the file set, as before. Checkmarks are guarded per file instead (below).
  const names = hash(files.map((f) => f.name).sort().join('\u0000'));
  const LEGACY = 'diffviewed:' + document.title + ':' + files.length + ':' + names;
  const KEY = 'review:' + (PR ? PR.owner + '/' + PR.repo + '#' + PR.number : document.title + ':' + names);
  try {
    if (localStorage.getItem(KEY) === null && localStorage.getItem(LEGACY) !== null) {
      localStorage.setItem(KEY, localStorage.getItem(LEGACY));
      const r = localStorage.getItem(LEGACY + ':review');
      if (r !== null) localStorage.setItem(KEY + ':review', r);
    }
  } catch (e) { /* storage unavailable: start fresh */ }
  // Storage can be blocked outright (reading localStorage throws) or full; the page then
  // runs on in-memory state, and save() says so when drafts can't be kept.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };
  const load = (k, d) => { try { return JSON.parse(store.get(k) || 'null') || d; } catch (e) { return d; } };
  let viewed = load(KEY, {});
  const saveViewed = () => store.set(KEY, JSON.stringify(viewed));
  const state = Object.assign({ comments: [], dismissed: [], body: '', bodyAttachments: [], event: META.event || 'COMMENT', submitted: null, checks: {}, recs: {}, autoYes: {} },
    load(KEY + ':review', {}));
  state.autoYes = state.autoYes || {};
  const save = () => {
    if (!store.set(KEY + ':review', JSON.stringify(state)))
      flash('Could not save comments locally (storage full or blocked?). They will be lost if you close this tab.', true);
  };

  let hideWs = !!WS && store.get('diffhidews') === '1';
  let split = store.get('diffsplit') === '1';

  // --- files, rows and lookups -------------------------------------------
  const main = $('filelist'), nav = $('navlist');
  const byName = new Map(files.map((f) => [f.name, f]));
  const changedSince = new Set((META.lastReview && META.lastReview.changed) || []);
  files.forEach((f) => {
    f.lang = HL.langOf(f.name);
    f.full = f.rows;
    f.fullAt = { RIGHT: new Set(), LEFT: new Set() };
    f.full.forEach((r) => {
      if (r.t === 'a' || r.t === 'c') f.fullAt.RIGHT.add(r.n2);
      if (r.t === 'd' || r.t === 'c') f.fullAt.LEFT.add(r.n1);
    });
    if (WS && f.name in WS) f.wsRows = WS[f.name] ? ((DiffParse.parseDiff(WS[f.name])[0] || { rows: [] }).rows) : [];
    f.shown = new Set();
    f.xrows = new Map();
    f.lines = null;
    f.since = changedSince.has(f.name);
    // A checkmark holds while the file's blob at the reviewed commit is unchanged. A page built
    // from stdin has no blobs, so it falls back to the file's diff.
    f.sig = META.blobs ? (META.blobs[f.name] || 'deleted:' + f.name) : 'd' + hash(f.full.map((r) => r.t + r.text).join('\n'));
    const v = viewed[f.name];
    if (v === 1) viewed[f.name] = f.sig;
    else if (v && v !== f.sig) { f.stale = true; delete viewed[f.name]; }
  });
  saveViewed();

  // A line comment remembers the file it was written against. Drafts are shared by every
  // page for the PR, so after a push the same line number can point at different code:
  // such a comment is stale until the reviewer checks it and saves it again.
  const sigOf = (path) => { const f = byName.get(path); return f ? f.sig : undefined; };
  const isStale = (c) => c.subject === 'line' && c.sig != null && byName.has(c.path) && sigOf(c.path) !== c.sig;

  // Existing review threads. Their line numbers are against the PR head, so
  // they only sit inline when this page shows the head; otherwise they're
  // listed at the top of their file.
  const threadsInline = !PR || META.commitId === PR.headSha;
  const threads = readJSON('threads-src', []).filter((t) => byName.has(t.path))
    .map((t) => Object.assign({}, t, { tid: t.id, anchor: threadsInline && t.line != null }));
  const threadById = new Map(threads.map((t) => [t.tid, t]));

  const sideOf = (r) => (r.t === 'd' ? 'LEFT' : 'RIGHT');
  const lineOf = (r) => (r.t === 'd' ? r.n1 : r.n2);
  // Row span a comment (or thread, or reply) covers in this diff, or null when its lines are not in it.
  const rowsOf = (c) => {
    if (c.subject === 'reply') { const t = threadById.get(c.thread_id); return t ? rowsOf(t) : null; }
    const f = byName.get(c.path);
    if (!f || c.subject === 'file' || c.line == null || (c.tid && !c.anchor)) return null;
    const e = f.rowAt[c.side || 'RIGHT'].get(c.line);
    const s = c.start_line != null ? f.rowAt[c.start_side || c.side || 'RIGHT'].get(c.start_line) : e;
    return e === undefined || s === undefined ? null : [Math.min(s, e), Math.max(s, e)];
  };
  const locLabel = (c) => {
    if (c.subject === 'reply') { const t = threadById.get(c.thread_id); return 'Reply' + (t ? ' · ' + locLabel(t) : ''); }
    if (c.subject === 'file') return 'File';
    if (c.tid && c.line == null) return 'Outdated' + (c.original_line ? ' · was line ' + c.original_line : '');
    const old = (c.side === 'LEFT') ? ' (old)' : '';
    return c.start_line != null && c.start_line !== c.line ? 'Lines ' + c.start_line + '–' + c.line + old : 'Line ' + c.line + old;
  };
  // A line comment on expanded context sits outside the diff, where GitHub can't anchor it: submitting
  // moves it into the summary with its file and line.
  const outside = (c) => c.subject === 'line' && !c.tid && byName.has(c.path) && !byName.get(c.path).fullAt[c.side || 'RIGHT'].has(c.line);
  const orphanNote = (c) => {
    if (outside(c) && !isStale(c)) return ' &middot; outside the diff: posts in the summary';
    if (isStale(c)) return ' &middot; the file changed since you wrote this: check the line, then Edit and save to keep it';
    if (c.subject !== 'line' || rowsOf(c)) return '';
    const f = byName.get(c.path);
    if (hideWs && f && f.fullAt[c.side || 'RIGHT'].has(c.line)) return ' &middot; hidden with whitespace changes';
    return c.tid ? (threadsInline ? '' : ' &middot; at the PR head') : '';
  };
  // The new-side text a suggestion replaces, so previews can show before/after.
  const originalOf = (c) => {
    const span = rowsOf(c), f = byName.get(c.path);
    if (!span) return null;
    return f.rows.slice(span[0], span[1] + 1).filter((r) => r.t !== 'd').map((r) => r.text);
  };
  const attMap = (atts) => Object.fromEntries((atts || []).map((a) => [a.id, a.data]));
  const renderBody = (c) => MD.render(c.body, { attachments: attMap(c.attachments), original: originalOf(c) });

  // --- building a file's table ---------------------------------------------
  // The rows on screen are the diff (or its whitespace-insensitive version)
  // with the unchanged lines between hunks folded into gap rows ('g'), plus any
  // lines expanded out of them ('x'). Expanded lines are context only: they are
  // not in the diff, so GitHub can't anchor a comment to them.
  function compose(f) {
    const base = hideWs && f.wsRows ? f.wsRows : f.full;
    if (hideWs && f.wsRows && !f.wsRows.length) return [{ t: 'm', text: 'Only whitespace changes. Press w (or Whitespace: hidden) to show them.' }];
    if (!base.some((r) => r.t === 'h')) return base;
    const out = [], L = f.lines;
    const xrow = (n, d) => {
      const k = n + ':' + d;
      if (!f.xrows.has(k)) f.xrows.set(k, { t: 'x', n2: n, n1: n + d, text: L[n - 1] ?? '' });
      return f.xrows.get(k);
    };
    const gap = (from, to, d, trailing) => {
      if (to == null) { if (canExpand) out.push({ t: 'g', from, to: null, d, trailing }); return; }
      for (let n = from; n <= to;) {
        if (L && f.shown.has(n)) { out.push(xrow(n, d)); n++; continue; }
        let e = n;
        while (e < to && !(L && f.shown.has(e + 1))) e++;
        out.push({ t: 'g', from: n, to: e, d, top: n === 1, trailing: trailing && e === to });
        n = e + 1;
      }
    };
    // A hunk side with zero lines (`+4,0`) names the line before the change, not the first one in it.
    let next = 1, delta = 0;
    base.forEach((r) => {
      if (r.t === 'h') {
        const nFirst = r.nc === 0 ? r.n + 1 : r.n, oFirst = r.oc === 0 ? r.o + 1 : r.o;
        gap(next, nFirst - 1, oFirst - nFirst, false);
        next = nFirst + r.nc;
        delta = oFirst + r.oc - next;
      }
      out.push(r);
    });
    if (f.status !== 'deleted' && f.status !== 'added') gap(next, L ? L.length : null, delta, true);
    return out;
  }

  // Highlight with state carried down each side, so a block comment or template
  // literal that spans lines colours all of them. A gap is unknown territory, so
  // the state restarts after one.
  function highlight(f) {
    let sN = {}, sO = {};
    f.rows.forEach((r) => {
      if (r.t === 'g') { sN = {}; sO = {}; return; }
      if (r.t === 'a') r.html = HL.hl(r.text, f.lang, sN);
      else if (r.t === 'd') r.html = HL.hl(r.text, f.lang, sO);
      else if (r.t === 'c' || r.t === 'x') { r.html = HL.hl(r.text, f.lang, sN); HL.hl(r.text, f.lang, sO); }
    });
    wordDiff(f.rows);
  }

  // Word-level changes. Each deleted line pairs with the added line in the same
  // position of the run that follows it (as split view pairs them), and the
  // tokens that differ get a <mark>. Lines with little in common are left alone,
  // since marking nearly everything says less than marking nothing.
  const WORDS = /\w+|\s+|[^\w\s]/gu;
  function changedRanges(a, b) {
    const ta = a.match(WORDS) || [], tb = b.match(WORDS) || [];
    if (ta.length * tb.length > 250000) return null;
    // LCS table, filled from the end so the walk below can go forwards.
    const n = ta.length, m = tb.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i][j] = ta[i] === tb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const keepA = new Array(n).fill(false), keepB = new Array(m).fill(false);
    let same = 0;
    for (let i = 0, j = 0; i < n && j < m;) {
      if (ta[i] === tb[j]) { keepA[i] = keepB[j] = true; if (/\S/.test(ta[i])) same += ta[i].length; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    const shorter = Math.min(a.replace(/\s/g, '').length, b.replace(/\s/g, '').length);
    if (!shorter || same < shorter / 2) return null;
    return [ranges(ta, keepA), ranges(tb, keepB)];
  }
  // Character ranges of the dropped tokens, with lone whitespace between two of them folded in.
  function ranges(toks, keep) {
    const out = [];
    let pos = 0;
    toks.forEach((t, i) => {
      const glue = keep[i] && !/\S/.test(t) && i > 0 && !keep[i - 1] && i + 1 < toks.length && !keep[i + 1];
      if (!keep[i] || glue) {
        const last = out[out.length - 1];
        if (last && last[1] === pos) last[1] += t.length; else out.push([pos, pos + t.length]);
      }
      pos += t.length;
    });
    return out;
  }
  // Wrap text offsets of highlighted HTML in <mark>, closing and reopening around
  // the highlighter's tags so the nesting stays valid. An entity is one character.
  function markHtml(html, rs) {
    let out = '', pos = 0, open = false, k = 0;
    for (let i = 0; i < html.length;) {
      if (html[i] === '<') {
        const e = html.indexOf('>', i) + 1;
        if (open) { out += '</mark>'; open = false; }
        out += html.slice(i, e); i = e;
        continue;
      }
      const e = html[i] === '&' ? html.indexOf(';', i) + 1 : i + 1;
      while (k < rs.length && rs[k][1] <= pos) k++;
      const inside = k < rs.length && rs[k][0] <= pos;
      if (inside && !open) { out += '<mark>'; open = true; }
      else if (!inside && open) { out += '</mark>'; open = false; }
      out += html.slice(i, e); i = e; pos++;
    }
    return open ? out + '</mark>' : out;
  }
  function wordDiff(rows) {
    for (let i = 0; i < rows.length;) {
      if (rows[i].t !== 'd') { i++; continue; }
      const ds = [], as = [];
      // Metadata rows ("\ No newline at end of file") can sit between the two runs.
      for (; i < rows.length && (rows[i].t === 'd' || rows[i].t === 'm'); i++) if (rows[i].t === 'd') ds.push(rows[i]);
      for (; i < rows.length && (rows[i].t === 'a' || rows[i].t === 'm'); i++) if (rows[i].t === 'a') as.push(rows[i]);
      for (let k = 0; k < Math.min(ds.length, as.length); k++) {
        const d = ds[k], a = as[k], rs = changedRanges(d.text, a.text);
        if (!rs) continue;
        if (rs[0].length) d.html = markHtml(d.html, rs[0]);
        if (rs[1].length) a.html = markHtml(a.html, rs[1]);
      }
    }
  }

  const SIGN = { a: '+', d: '-', c: ' ', x: ' ' };
  const TYPE = { a: 'ra', d: 'rd', c: 'rc', x: 'rx' };
  const codeHtml = (r) => esc(SIGN[r.t]) + (r.html != null ? r.html : esc(r.text));
  const gapHtml = (g, i) => {
    const n = g.to == null ? null : g.to - g.from + 1;
    const what = n == null ? 'More lines below' : plural(n, 'unchanged line');
    // Expanding reads the file through the local server, so say how to get it rather than hiding the reason in a tooltip.
    if (!canExpand) return '<span class="gtext">' + what + '</span><span class="gtext ghint">' +
      (META.headRev ? '&middot; serve the page (<code>--serve</code>) to expand' : '&middot; can\'t expand a diff piped in with --stdin') + '</span>';
    const b = (how, label, title) => '<button type="button" data-exp="' + how + '" data-g="' + i + '" title="' + title + '">' + label + '</button>';
    const btns = n != null && n <= 20 ? b('all', 'Expand', 'Show these lines')
      : (g.top ? '' : b('down', '&darr; 20', 'Show 20 more lines below the change above')) +
        (g.trailing ? '' : b('up', '&uarr; 20', 'Show 20 more lines above the change below')) +
        b('all', 'All', 'Show all of them');
    return btns + '<span class="gtext">' + what + '</span>';
  };
  // Unified row. `i` is the row's index in f.rows; without one (snippets) the gutter isn't clickable.
  function rowHtml(r, i, cols) {
    cols = cols || 3;
    if (r.t === 'h' || r.t === 'm') return '<tr class="' + r.t + '"><td colspan="' + cols + '">' + esc(r.text) + '</td></tr>';
    if (r.t === 'g') return '<tr class="g"><td colspan="' + cols + '">' + gapHtml(r, i) + '</td></tr>';
    const k = TYPE[r.t], d = i != null ? ' data-r="' + i + '"' : '';
    return '<tr class="' + r.t + '"' + d + '><td class="n ' + k + '"' + d + '>' + (r.n1 ?? '') + '</td><td class="n ' + k + '"' + d + '>' +
      (r.n2 ?? '') + '</td><td class="c ' + k + '">' + codeHtml(r) + '</td></tr>';
  }
  // Split view: deletions on the left paired with the additions that follow them.
  function pairUp(rows) {
    const out = [];
    for (let i = 0; i < rows.length;) {
      const t = rows[i].t;
      if (t === 'd' || t === 'a') {
        const ds = [], as = [];
        while (i < rows.length && rows[i].t === 'd') ds.push(i++);
        while (i < rows.length && rows[i].t === 'a') as.push(i++);
        for (let k = 0; k < Math.max(ds.length, as.length); k++) out.push({ l: ds[k], r: as[k] });
      } else if (t === 'c' || t === 'x') { out.push({ l: i, r: i }); i++; }
      else { out.push({ full: i }); i++; }
    }
    return out;
  }
  const halfHtml = (r, i, left) => {
    if (!r) return '<td class="n re"></td><td class="c re"></td>';
    const k = TYPE[r.t], d = ' data-r="' + i + '"';
    return '<td class="n ' + k + '"' + d + '>' + ((left ? r.n1 : r.n2) ?? '') + '</td><td class="c ' + k + '"' + d + '>' + codeHtml(r) + '</td>';
  };

  function buildTable(f) {
    f.rows = compose(f);
    f.rowAt = { RIGHT: new Map(), LEFT: new Map() };
    f.rows.forEach((r, i) => {
      if (r.t === 'a' || r.t === 'c' || r.t === 'x') f.rowAt.RIGHT.set(r.n2, i);
      if (r.t === 'd' || r.t === 'c') f.rowAt.LEFT.set(r.n1, i);
    });
    highlight(f);
    // Per row index: its <tr>, the cells it occupies (for the selection
    // highlight) and its line-number cells (for the "has a comment" marker).
    f.trOf = []; f.cellsOf = []; f.numsOf = [];
    f.cols = split ? 4 : 3;
    f.table.classList.toggle('split', split);
    if (!split) {
      f.table.innerHTML = f.rows.map((r, i) => rowHtml(r, i, 3)).join('');
      Array.from(f.table.rows).forEach((tr, i) => {
        f.trOf[i] = tr;
        f.cellsOf[i] = Array.from(tr.cells);
        f.numsOf[i] = f.cellsOf[i].filter((td) => td.classList.contains('n'));
      });
      return;
    }
    const pairs = pairUp(f.rows);
    // A fixed layout takes its column widths from the first row, which is a hunk header spanning all
    // four, so without explicit columns each gutter gets a quarter of the table. Size them to the
    // file's longest line number instead.
    const digits = String(f.rows.reduce((m, r) => Math.max(m, r.n1 || 0, r.n2 || 0), 0)).length;
    const gut = '<col style="width:calc(' + Math.max(digits, 2) + 'ch + 16px)">';
    f.table.innerHTML = '<colgroup>' + gut + '<col>' + gut + '<col></colgroup>' + pairs.map((p) => (p.full != null ? rowHtml(f.rows[p.full], p.full, 4)
      : '<tr class="sp">' + halfHtml(f.rows[p.l], p.l, true) + halfHtml(f.rows[p.r], p.r, false) + '</tr>')).join('');
    Array.from(f.table.rows).forEach((tr, k) => {
      const p = pairs[k], c = tr.cells;
      if (p.full != null) { f.trOf[p.full] = tr; f.cellsOf[p.full] = Array.from(c); f.numsOf[p.full] = []; return; }
      const add = (i, cells) => {
        if (i == null) return;
        f.trOf[i] = tr;
        (f.cellsOf[i] = f.cellsOf[i] || []).push(...cells);
        (f.numsOf[i] = f.numsOf[i] || []).push(cells[0]);
      };
      add(p.l, [c[0], c[1]]);
      add(p.r, [c[2], c[3]]);
    });
  }

  async function expand(f, gi, how) {
    const g = f.rows[gi];
    if (!g || g.t !== 'g') return;
    if (!f.lines) {
      try {
        const res = await fetch('/api/file?path=' + encodeURIComponent(f.name), { headers: { 'X-Review-Token': SERVER.token } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
        f.lines = (await res.text()).split('\n');
        if (f.lines[f.lines.length - 1] === '') f.lines.pop();
      } catch (e) { flash('Could not load ' + f.name + ': ' + e.message, true); return; }
    }
    const to = g.to == null ? f.lines.length : g.to;
    const [a, b] = how === 'down' ? [g.from, Math.min(to, g.from + 19)] : how === 'up' ? [Math.max(g.from, to - 19), to] : [g.from, to];
    for (let n = a; n <= b; n++) f.shown.add(n);
    // Expanding upward grows toward the change below the gap; keep that change where it is on screen.
    const anchor = how === 'up' ? f.rows[gi + 1] : null;
    const before = anchor ? f.trOf[gi + 1].getBoundingClientRect().top : 0;
    buildTable(f);
    renderFile(f);
    const at = anchor ? f.rows.indexOf(anchor) : -1;
    if (at !== -1) window.scrollBy(0, f.trOf[at].getBoundingClientRect().top - before);
  }

  // --- reading guide and auto-review --------------------------------------
  // Files the guide never mentions still render, in a trailing "Unsorted"
  // group — dropping one would quietly make the percent-reviewed number a lie.
  const claimed = new Set();
  const groups = [];
  (GUIDE.groups || []).forEach((g) => {
    const gf = [];
    (g.files || []).forEach((entry) => {
      const e = typeof entry === 'string' ? { path: entry } : entry;
      const f = byName.get(e.path);
      if (!f || claimed.has(f.name)) return;
      claimed.add(f.name);
      if (g.auto || e.auto) f.auto = { summary: e.summary || '' };
      gf.push(f);
    });
    if (gf.length) groups.push({ title: g.title || 'Group', why: g.why || '', auto: !!g.auto, summary: g.summary || '', points: g.points || [], files: gf });
  });
  const rest = files.filter((f) => !claimed.has(f.name));
  if (groups.length && rest.length) groups.push({ title: 'Unsorted', why: 'Not covered by the reading guide', summary: '', points: [], files: rest });
  const sections = groups.length ? groups : [{ title: null, why: '', summary: '', points: [], files }];
  const fileOrder = sections.flatMap((g) => g.files);

  // Pages built before the fix carry "**Nit:** nit: ...": keep the bold label, drop the agent's own.
  const oneLabel = (body) => body.replace(/^(\*\*(Blocking|Should|Nit):\*\* )\s*(\*\*)?(blocking|should|nit)\s*:\s*(\*\*)?\s*/i, '$1');
  const suggestions = (GUIDE.suggestions || []).map((s) =>
    Object.assign({ subject: s.line == null ? 'file' : 'line', side: 'RIGHT' }, s, { sid: 's' + hash(JSON.stringify(s)) }, s.body ? { body: oneLabel(s.body) } : {}));
  const pendingSuggestions = () => suggestions.filter((s) =>
    !state.dismissed.includes(s.sid) && !state.comments.some((c) => c.sid === s.sid));
  const commentFrom = (s) => ({ id: uid('c'), sid: s.sid, path: s.path, subject: s.subject, side: s.side, line: s.line,
    start_side: s.start_side ?? null, start_line: s.start_line ?? null, body: s.body, attachments: [], sig: sigOf(s.path) });

  // Recommendations: the higher-level calls the agent wants the reviewer to make, each a yes or a no.
  // One usually stands for several suggested comments (they ride in GUIDE.suggestions tagged with its
  // id), and a yes puts them all in the review. One with no comments is a general point: a yes adds it
  // to the summary. A suggested comment that belongs to no recommendation stands as its own, so every
  // one can be decided without reading the diff.
  const groupOf = (path) => { const g = sections.find((x) => x.files.some((f) => f.name === path)); return g ? g.title : null; };
  const headline = (body) => {
    const line = String(body || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('```')) || 'Suggested change';
    const t = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[>#\s]+/, '').replace(/\*\*|__/g, '').trim();
    return t.length > 90 ? t.slice(0, 88) + '…' : t;
  };
  // Blocking first, then should, then nits; a question or an unmarked one keeps its place after them.
  const SEV = { blocking: 'Blocking', should: 'Should', nit: 'Nit' };
  const SEV_RANK = (r) => ({ blocking: 0, should: 1, nit: 2 })[r.severity] ?? 3;
  const recs = (GUIDE.recommendations || []).map((r) => Object.assign({}, r, {
    rid: r.id, group: sections.some((g) => g.title && g.title === r.group) ? r.group : null,
    sids: suggestions.filter((s) => s.rec === r.id).map((s) => s.sid),
  })).sort((a, b) => SEV_RANK(a) - SEV_RANK(b)).concat(suggestions.filter((s) => !s.rec).map((s) => ({ rid: 'r' + s.sid, title: headline(s.body), why: '', group: groupOf(s.path), sids: [s.sid] })));
  const accepted = (sid) => state.comments.some((c) => c.sid === sid);
  function recStatus(r) {
    if (!r.sids.length) return state.recs[r.rid] || 'open';
    const yes = r.sids.filter(accepted).length, no = r.sids.filter((sid) => !accepted(sid) && state.dismissed.includes(sid)).length;
    return yes === r.sids.length ? 'yes' : no === r.sids.length ? 'no' : yes || no ? 'mixed' : 'open';
  }
  const recsDecided = () => recs.filter((r) => recStatus(r) !== 'open').length;
  const groupRecs = (g) => recs.filter((r) => r.group != null && r.group === g.title);
  // Pressing the lit button again takes the decision back. Taking back a yes keeps any comment the
  // reviewer has edited since, since that is their own words now.
  function decide(r, how) {
    if (editing && editing.sid && r.sids.includes(editing.sid)) { flash('Finish or cancel the open comment first.'); return; }
    const undo = recStatus(r) === how;
    if (!r.sids.length) { if (undo) delete state.recs[r.rid]; else state.recs[r.rid] = how; }
    suggestions.filter((s) => r.sids.includes(s.sid)).forEach((s) => {
      const mine = (c) => c.sid === s.sid;
      state.dismissed = state.dismissed.filter((x) => x !== s.sid);
      if (how === 'yes' && undo) state.comments = state.comments.filter((c) => !mine(c) || c.body !== s.body);
      else if (how === 'yes') { if (!state.comments.some(mine)) state.comments.push(commentFrom(s)); }
      else if (!undo) { state.comments = state.comments.filter((c) => !mine(c)); state.dismissed.push(s.sid); }
    });
    save();
    new Set(suggestions.filter((s) => r.sids.includes(s.sid)).map((s) => s.path)).forEach((p) => renderFile(byName.get(p)));
    render();
  }
  const oneLine = (t) => String(t || '').trim().replace(/\s*\n\s*/g, ' ');
  // The kind decides whether a recommendation has a proposal at all (a question doesn't).
  const shownProposal = (r) => (!r.kind || !REC_PARTS[r.kind] || REC_PARTS[r.kind].includes('proposal') ? r.proposal : '') || '';
  // refs maps a recommendation's id to the numbers of its diagrams in the diagrams comment, when they are posted.
  const recsMd = (refs = {}) => {
    const list = recs.filter((r) => !r.sids.length && recStatus(r) === 'yes');
    return list.length ? '**Recommendations**\n\n' + list.map((r) => '- ' + oneLine(r.body || r.title + (shownProposal(r) || r.why ? ': ' + (shownProposal(r) || r.why) : '')) +
      (r.principle && r.principle.name ? ' _(' + oneLine(r.principle.name) + (r.principle.title ? ', ' + r.principle.title : '') + ')_' : '') +
      (refs[r.rid] ? ' ' + seeDiagrams(refs[r.rid]) : '')).join('\n') : '';
  };

  // Feature checks: behaviour the agent thinks is worth confirming. The reviewer marks each one
  // "looks right" or "concern"; concerns (with their notes) go into the review summary.
  const checks = ((OV && OV.feature && OV.feature.checks) || []).map((c) => (typeof c === 'string' ? { text: c } : c))
    .map((c) => Object.assign({}, c, { kid: c.id || 'k' + hash(c.text) }));
  const checkOf = (c) => state.checks[c.kid] || {};
  const concerns = () => checks.filter((c) => checkOf(c).s === 'concern');
  const concernsMd = () => {
    const list = concerns();
    if (!list.length) return '';
    return '**Feature concerns**\n\n' + list.map((c) => '- ' + c.text.replace(/\s*\n\s*/g, ' ') +
      (checkOf(c).note && checkOf(c).note.trim() ? ': ' + checkOf(c).note.trim().replace(/\s*\n\s*/g, ' ') : '')).join('\n');
  };
  const fullBody = (refs) => [state.body.trim(), recsMd(refs), concernsMd()].filter(Boolean).join('\n\n');
  // Diagrams can sit in the overview, in a reading-guide group (shown under its header in the code step), or both.
  // A group's own visuals are diagrams pinned to it, so they show on its gist and above its code.
  const diagrams = ((OV && OV.diagrams) || []).concat((GUIDE.groups || []).flatMap((g) => (g.title ? g.visuals || [] : []).map((d) => Object.assign({ group: g.title }, d))));
  const diagramsIn = (section) => diagrams.filter((d) => (d.section || (d.group ? null : 'feature')) === section);

  // --- render the diff ----------------------------------------------------
  let tAdd = 0, tDel = 0, idx = 0;
  sections.forEach((g, gi) => {
    if (g.title) {
      const mh = document.createElement('div');
      mh.className = 'ghead'; mh.id = 'g' + gi;
      mh.innerHTML = '<h2><span class="gnum">' + (gi + 1) + '.</span>' + esc(g.title) +
        '<span class="gct"></span><button type="button" class="gfold" title="Fold or unfold every file in this group">Collapse group</button></h2>' + (g.why ? '<p class="gwhy">' + esc(g.why) + '</p>' : '');
      diagrams.filter((d) => d.group && d.group === g.title).forEach((d) => {
        const det = document.createElement('details');
        det.className = 'gdiag'; det.open = true;
        det.innerHTML = '<summary>Diagram' + (d.title ? ': ' + esc(d.title) : '') + '</summary>';
        det.appendChild(DIAG.render(Object.assign({}, d, { title: null }), mdHtml));
        mh.appendChild(det);
      });
      mh.querySelector('.gfold').addEventListener('click', (e) => {
        const fold = !g.files.every((f) => f.el.classList.contains('collapsed'));
        g.files.forEach((f) => { f.el.classList.toggle('collapsed', fold); f.el.classList.remove('peek'); });
        e.currentTarget.textContent = fold ? 'Expand group' : 'Collapse group';
      });
      main.appendChild(mh);
      // The sidebar outline: the group, its recommendations (in Recommendations) and its files.
      const og = document.createElement('details');
      og.className = 'og'; og.open = true; og.dataset.g = gi;
      og.innerHTML = '<summary class="ghead"><h2><span class="gnum">' + (gi + 1) + '.</span><a href="#g' + gi + '">' +
        esc(g.title) + '</a><span class="gct"></span></h2></summary><div class="orecs"></div>' +
        '<details class="ofiles"><summary>' + plural(g.files.length, 'file') + '</summary><div class="ofl"></div></details>';
      nav.appendChild(og);
      g.mainEl = mh; g.navEl = og; g.navFiles = og.querySelector('.ofl');
      g.ctEls = [mh.querySelector('.gct'), og.querySelector('.gct')];
    }
    g.files.forEach((f) => {
      const i = f.i = idx++;
      tAdd += f.add; tDel += f.del;
      const el = document.createElement('section');
      el.className = 'file' + (f.auto ? ' auto collapsed' : '') + (f.since ? ' since' : ''); el.id = 'f' + i;
      el.dataset.name = f.name.toLowerCase(); el.dataset.i = i;
      el.innerHTML = '<div class="fhead"><span class="chev">&#9660;</span><span class="fname">' + esc(f.name) +
        '</span>' + (f.auto ? '<span class="badge auto">auto-reviewed</span>' : '') +
        (f.since ? '<span class="badge since" title="This file changed after your last review">changed since your review</span>' : '') +
        (f.stale ? '<span class="badge stale" title="You marked this viewed, then the file changed">changed since you viewed it</span>' : '') +
        '<span class="badge">' + f.status + '</span><span class="cbadge"></span><span class="add">+' + f.add +
        '</span><span class="del">-' + f.del + '</span><button type="button" class="xfold hidden" title="Hide the unchanged lines you expanded">Fold context</button>' +
        '<button type="button" class="fcbtn" title="Comment on the whole file">Comment</button>' +
        '<label class="viewed-box"><input type="checkbox">Viewed</label></div>' +
        (f.auto ? '<div class="autonote"><b>Auto-reviewed:</b> ' + esc(f.auto.summary || 'no summary given') +
          ' &middot; expand to double-check, or tick Viewed to sign it off yourself.</div>' : '') +
        '<div class="body"><div class="fcomments"></div><table></table></div>';
      const box = el.querySelector('.viewed-box');
      const cb = box.querySelector('input');
      cb.checked = !!viewed[f.name];
      el.classList.toggle('viewed', cb.checked);
      box.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        // Collapsing pulls everything below the file upward. When the file's end is on screen, anchor
        // on it so you stay at the end of the file you just finished, instead of being thrown down
        // the page. When you're partway through, the end is still below the fold, and anchoring on it
        // would scroll back up by that unread remainder. Keep the (sticky) header where it is instead,
        // so the next file follows straight after it.
        const before = el.getBoundingClientRect();
        const endInView = before.bottom <= window.innerHeight;
        el.classList.toggle('viewed', cb.checked);
        el.classList.remove('peek');
        const after = el.getBoundingClientRect();
        const shift = endInView ? after.bottom - before.bottom : after.top - Math.max(before.top, hdr.offsetHeight);
        if (shift) window.scrollBy(0, shift);
        if (cb.checked) viewed[f.name] = f.sig; else delete viewed[f.name];
        saveViewed();
        render();
      });
      el.querySelector('.xfold').addEventListener('click', (e) => {
        e.stopPropagation();
        f.shown.clear();
        buildTable(f);
        renderFile(f);
      });
      el.querySelector('.fcbtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor({ path: f.name, subject: 'file', body: '', attachments: [] });
      });
      f.el = el; f.cb = cb;
      f.table = el.querySelector('table');
      f.fcEl = el.querySelector('.fcomments');
      f.cbadge = el.querySelector('.cbadge');
      el.querySelector('.fhead').addEventListener('click', () => {
        if (el.classList.contains('viewed') && !el.classList.contains('peek')) el.classList.add('peek');
        else if (el.classList.contains('peek')) el.classList.remove('peek');
        else el.classList.toggle('collapsed');
      });
      f.table.addEventListener('click', (e) => {
        const eb = e.target.closest('[data-exp]');
        if (eb) { e.stopPropagation(); expand(f, +eb.dataset.g, eb.dataset.exp); }
      });
      f.table.addEventListener('mousedown', (e) => onGutterDown(e, f));
      buildTable(f);
      main.appendChild(el);
      const a = document.createElement('a');
      a.href = '#f' + i; a.dataset.name = f.name.toLowerCase();
      a.innerHTML = '<span class="c"><span class="add">+' + f.add + '</span> <span class="del">-' + f.del +
        '</span></span>' + esc(f.name.split('/').pop());
      a.title = f.name;
      a.classList.toggle('since', f.since);
      f.navEl = a;
      (g.navFiles || nav).appendChild(a);
    });
  });
  $('stats').innerHTML = files.length + ' files &middot; <span class="add">+' + tAdd +
    '</span> <span class="del">-' + tDel + '</span>';

  const tLines = tAdd + tDel;
  let sinceOnly = false, readPct = 0;
  const ring = (pct) => {
    const r = 15, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="' + r + '" class="rt"/><circle cx="18" cy="18" r="' + r +
      '" class="rf" stroke-dasharray="' + (c * pct / 100).toFixed(2) + ' ' + c.toFixed(2) + '"/></svg>';
  };
  function render() {
    const covered = (f) => f.cb.checked || !!f.auto;
    const left = files.filter((f) => !covered(f));
    const autoOnly = files.filter((f) => f.auto && !f.cb.checked);
    const lines = (fs) => fs.reduce((s, f) => s + f.add + f.del, 0);
    const lLines = lines(left), seen = tLines - lLines, aLines = lines(autoOnly);
    readPct = tLines ? Math.round(seen / tLines * 100) : 100;
    files.forEach((f) => {
      f.navEl.classList.toggle('viewed', f.cb.checked);
      f.navEl.classList.toggle('auto', !!f.auto && !f.cb.checked);
    });
    // Each step counts what it is for: decisions in Recommendations, lines read in Code.
    const byRecs = mode === 'recs';
    sections.forEach((g) => {
      if (!g.title) return;
      const gDone = g.files.filter(covered).length, all = gDone === g.files.length;
      const gr = groupRecs(g), gDecided = gr.filter((r) => recStatus(r) !== 'open').length;
      g.ctEls[0].textContent = (all ? '✓ ' : '') + gDone + ' / ' + g.files.length;
      g.ctEls[1].textContent = !byRecs ? g.ctEls[0].textContent : gr.length ? (gDecided === gr.length ? '✓ ' : '') + gDecided + ' / ' + gr.length : '';
      g.mainEl.classList.toggle('done', all);
      g.navEl.classList.toggle('done', byRecs ? gr.length > 0 && gDecided === gr.length : all);
    });
    const nc = state.comments.length;
    if (document.body.dataset.view !== 'code') { const hp = document.querySelector('#gocode .hpct'); if (hp) hp.textContent = readPct + '%'; }
    if (byRecs) {
      const n = recs.length, by = (st) => recs.filter((r) => recStatus(r) === st).length, decided = recsDecided();
      const pct = n ? Math.round(decided / n * 100) : 100;
      $('meta').innerHTML = '<div class="prog">' + ring(pct) + '<div><div class="pnum">' + decided + '<span> / ' + n + '</span></div>' +
        '<div class="plbl">recommendations decided</div></div></div>' +
        (n ? '<div class="pfoot"><span class="yes">' + by('yes') + ' added</span><span class="no">' + by('no') + ' ignored</span>' +
          (by('mixed') ? '<span>' + by('mixed') + ' in part</span>' : '') + '</div>' : '');
    } else {
      const openThreads = threads.filter((t) => !t.resolved).length;
      const lr = META.lastReview, since = META.since;
      const day = (at) => at ? new Date(at).toLocaleDateString() : '';
      let review = '';
      if (since) {
        review = '<div class="row"><span>Changes since</span><b>' + esc(since.sha.slice(0, 7)) + (since.at ? ' · ' + day(since.at) : '') + '</b></div>' +
          (since.rebased ? '<div class="row"><span>Rebased since, so this includes upstream changes</span></div>' : '');
      } else if (lr && lr.changed) {
        review = '<div class="row"><span>Your last review</span><b>' + esc(lr.sha.slice(0, 7)) + ' · ' + day(lr.at) + '</b></div>' +
          (changedSince.size
            ? '<div class="row"><span>Changed since</span><b>' + plural(changedSince.size, 'file') +
              ' <button type="button" data-act="sinceonly">' + (sinceOnly ? 'Show all' : 'Only these') + '</button></b></div>'
            : '<div class="row"><span>Nothing changed since</span></div>');
      }
      $('meta').innerHTML = '<div class="prog">' + ring(readPct) + '<div><div class="pnum">' + readPct + '<span>%</span></div>' +
        '<div class="plbl">of changed lines read</div></div></div>' +
        '<div class="row"><span>Files</span><b>' + (files.length - left.length) + ' / ' + files.length + '</b></div>' +
        (autoOnly.length ? '<div class="row"><span>Auto-reviewed</span><b>' + plural(autoOnly.length, 'file') + ', ' + plural(aLines, 'line') + '</b></div>' : '') +
        (left.length ? '<div class="row"><span>Left to read</span><b>' + lLines.toLocaleString() + ' line' + (lLines === 1 ? '' : 's') + '</b></div>' : '') +
        (threads.length ? '<div class="row"><span>Threads</span><b>' + threads.length + (openThreads ? ' (' + openThreads + ' open)' : '') + '</b></div>' : '') +
        review;
    }
    renderRail();
    if (byRecs) refreshOutline();
  }

  // --- comments in the diff -----------------------------------------------
  // The one open draft: {id?, sid?, thread_id?, path, subject, side, line, start_*, body, attachments, el}
  let editing = null;

  // Press on a line number and drag to another to comment on the range; a plain click is one line.
  // The range stops at the edge of the hunk, since GitHub can't anchor a comment across hunks.
  let drag = null; // {f, start, lo, hi} while the mouse is down on a gutter
  const paintDrag = () => {
    drag.f.table.querySelectorAll('td.dragsel').forEach((td) => td.classList.remove('dragsel'));
    for (let i = drag.lo; i <= drag.hi; i++) (drag.f.cellsOf[i] || []).forEach((td) => td.classList.add('dragsel'));
  };
  function onGutterDown(e, f) {
    if (e.button !== 0) return;
    const td = e.target.closest('td.n');
    if (!td) return;
    if (td.dataset.r === undefined) {
      return;
    }
    const r = +td.dataset.r;
    if (!'acdx'.includes(f.rows[r].t)) return;
    e.preventDefault(); // no text selection while dragging
    drag = { f, start: r, lo: r, hi: r };
    document.body.classList.add('dragging');
    paintDrag();
  }
  document.addEventListener('mouseover', (e) => {
    if (!drag) return;
    const el = e.target.closest && e.target.closest('[data-r]');
    if (!el || !drag.f.table.contains(el)) return;
    const rows = drag.f.rows, target = +el.dataset.r, step = target > drag.start ? 1 : -1;
    const inHunk = (i) => rows[i] && 'acdx'.includes(rows[i].t) && (rows[i].t === 'x') === (rows[drag.start].t === 'x') && rows[i].hunk === rows[drag.start].hunk;
    let end = drag.start;
    while (end !== target && inHunk(end + step)) end += step;
    drag.lo = Math.min(drag.start, end); drag.hi = Math.max(drag.start, end);
    paintDrag();
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove('dragging');
    d.f.table.querySelectorAll('td.dragsel').forEach((td) => td.classList.remove('dragsel'));
    openEditor(Object.assign({ path: d.f.name, subject: 'line', body: '', attachments: [] }, spanLoc(d.f, d.lo, d.hi)));
  });
  const spanLoc = (f, s, e) => {
    const a = f.rows[s], b = f.rows[e];
    return s === e
      ? { side: sideOf(b), line: lineOf(b), start_side: null, start_line: null }
      : { side: sideOf(b), line: lineOf(b), start_side: sideOf(a), start_line: lineOf(a) };
  };

  function openEditor(draft) {
    if (!byName.has(draft.path)) {
      // A --since page shares the PR's drafts but not every file; there is nowhere to show the editor.
      flash(draft.path + ' is not in this page. Edit that comment from the full PR page.', true);
      return;
    }
    if (editing && (editing.body.trim() || editing.attachments.length) && !(draft.id && draft.id === editing.id)) {
      // Never throw away typed text; send the reviewer back to it instead.
      if (editing.inRecs) { focusRec(recOfSid(editing.sid)); goStep('recs'); }
      else goToFile(byName.get(editing.path));
      editing.el.scrollIntoView({ block: 'center' });
      editing.el.querySelector('textarea').focus();
      flash('Finish or cancel the open comment first.');
      return;
    }
    const prev = editing;
    const f = byName.get(draft.path);
    draft.el = makeEditor(draft, {
      suggest: () => {
        const span = rowsOf(draft);
        return span && f.rows.slice(span[0], span[1] + 1).every((r) => r.t !== 'd') ? originalOf(draft) : null;
      },
      onSave: () => saveDraft(),
      onCancel: () => { editing = null; renderFile(f); },
    });
    editing = draft;
    if (prev && prev.inRecs) redrawRec(recOfSid(prev.sid));
    else if (prev && prev.path !== draft.path) renderFile(byName.get(prev.path));
    goToFile(f);
    renderFile(f);
    editing.el.querySelector('textarea').focus();
  }

  function saveDraft() {
    const d = editing;
    if (!d.body.trim() && !d.attachments.length) return;
    const c = { id: d.id || uid('c'), sid: d.sid, thread_id: d.thread_id, path: d.path, subject: d.subject, side: d.side, line: d.line,
      start_side: d.start_side, start_line: d.start_line, body: d.body, attachments: d.attachments,
      sig: d.subject === 'line' ? sigOf(d.path) : undefined };
    const at = state.comments.findIndex((x) => x.id === c.id);
    if (at === -1) state.comments.push(c); else state.comments[at] = c;
    editing = null;
    save();
    renderFile(byName.get(c.path));
    render();
    if (d.inRecs) redrawRec(recOfSid(d.sid));
    if (document.body.classList.contains('submitting')) renderSubmit();
  }

  function goToFile(f) {
    if (!f) return;
    if (location.hash === '#submit') {
      history.pushState(null, '', '#f' + f.i);
      setView();
    }
    f.el.classList.remove('collapsed');
    if (f.cb.checked) f.el.classList.add('peek');
  }

  // Same shape as a comment in Recommendations: where it sits, the words, then a footer with its state and actions.
  function cardHtml(c, pending) {
    const btn = (act, id, label, cls) => '<button type="button"' + (cls ? ' class="' + cls + '"' : '') + ' data-act="' + act + '" data-id="' + id + '">' + label + '</button>';
    const acts = pending
      ? '<span class="reccst">Suggested comment</span><span class="sp"></span>' + btn('dismiss', c.sid, 'Dismiss', 'quiet') +
        btn('edit-s', c.sid, 'Edit', 'quiet') + btn('accept', c.sid, 'Accept', 'primary')
      : '<span class="reccst yes">In your review</span><span class="sp"></span>' + btn('delete', c.id, 'Delete', 'quiet') + btn('edit', c.id, 'Edit');
    const label = c.subject === 'reply' ? 'Your reply' : esc(locLabel(c)) + orphanNote(c);
    return '<div class="card ' + (pending ? 'sugg-pending' : 'yes') + '"><div class="chead"><span>' + label + '</span></div>' +
      '<div class="md">' + renderBody(c) + '</div><div class="reccfoot">' + acts + '</div></div>';
  }

  const when = (at) => { try { return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return at; } };
  function threadHtml(t) {
    const replies = state.comments.filter((c) => c.subject === 'reply' && c.thread_id === t.tid && c.id !== (editing && editing.id));
    const replying = editing && editing.subject === 'reply' && editing.thread_id === t.tid;
    const open = replying || (t.open ?? (!t.resolved || replies.length > 0));
    const original = originalOf(t);
    const posts = t.comments.map((c) => '<div class="tcm"><div class="tmeta"><b>' + esc(c.author) + '</b> &middot; ' + esc(when(c.at)) +
      (c.url ? ' &middot; <a href="' + esc(c.url) + '" target="_blank" rel="noopener">on GitHub</a>' : '') + '</div><div class="md">' +
      MD.render(c.body || '', { original }) + '</div></div>').join('');
    return '<div class="thread' + (open ? ' open' : '') + (t.resolved ? ' resolved' : '') + '" data-tid="' + esc(t.tid) + '">' +
      '<div class="chead"><span>' + esc(locLabel(t)) + orphanNote(t) + '</span>' +
      (t.resolved ? '<span class="tag done">Resolved</span>' : '') + (t.outdated ? '<span class="tag">Outdated</span>' : '') +
      '<span>' + esc(t.comments[0].author) + ' &middot; ' + plural(t.comments.length, 'comment') + '</span><span class="sp"></span>' +
      '<button type="button" data-act="reply" data-id="' + esc(t.tid) + '">Reply</button>' +
      '<button type="button" data-act="tthread" data-id="' + esc(t.tid) + '">' + (open ? 'Hide' : 'Show') + '</button></div>' +
      '<div class="tposts">' + posts + replies.map((c) => cardHtml(c, false)).join('') + '<div class="rslot"></div></div></div>';
  }

  function renderFile(f) {
    if (!f) return;
    f.table.querySelectorAll('tr.cmt').forEach((tr) => tr.remove());
    f.table.querySelectorAll('.sel, .hc').forEach((td) => td.classList.remove('sel', 'hc'));
    f.fcEl.innerHTML = '';
    const mine = state.comments.filter((c) => c.path === f.name && c.subject !== 'reply' && c.id !== (editing && editing.id));
    const pend = pendingSuggestions().filter((s) => s.path === f.name && s.sid !== (editing && editing.sid));
    const ths = threads.filter((t) => t.path === f.name);
    const byRow = new Map();
    const place = (c, html) => {
      const span = rowsOf(c);
      if (!span) { f.fcEl.insertAdjacentHTML('beforeend', html); return; }
      for (let i = span[0]; i <= span[1]; i++) (f.numsOf[i] || []).forEach((td) => td.classList.add('hc'));
      if (!byRow.has(span[1])) byRow.set(span[1], []);
      byRow.get(span[1]).push(html);
    };
    ths.forEach((t) => place(t, threadHtml(t)));
    mine.forEach((c) => place(c, cardHtml(c, false)));
    pend.forEach((s) => place(s, cardHtml(s, true)));
    const insertAfter = (ri, node) => {
      let ref = f.trOf[ri];
      while (ref.nextElementSibling && ref.nextElementSibling.classList.contains('cmt')) ref = ref.nextElementSibling;
      ref.after(node);
    };
    byRow.forEach((htmls, ri) => {
      const tr = document.createElement('tr');
      tr.className = 'cmt';
      tr.innerHTML = '<td colspan="' + f.cols + '">' + htmls.join('') + '</td>';
      insertAfter(ri, tr);
    });
    if (editing && editing.path === f.name && !editing.inRecs) {
      const span = editing.subject === 'reply' ? null : rowsOf(editing);
      const slot = editing.subject === 'reply' && f.el.querySelector('.thread[data-tid="' + editing.thread_id + '"] .rslot');
      if (slot) slot.appendChild(editing.el);
      else if (span) {
        for (let i = span[0]; i <= span[1]; i++) (f.cellsOf[i] || []).forEach((td) => td.classList.add('sel'));
        const tr = document.createElement('tr');
        tr.className = 'cmt';
        const td = document.createElement('td');
        td.colSpan = f.cols;
        td.appendChild(editing.el);
        tr.appendChild(td);
        insertAfter(span[1], tr);
      } else f.fcEl.appendChild(editing.el);
      editing.el.querySelector('.eloc').textContent = locLabel(editing);
      editing.el.querySelector('[data-tool="suggest"]').disabled = !editing.el.suggestable();
    }
    f.el.querySelector('.xfold').classList.toggle('hidden', !f.shown.size);
    const n = state.comments.filter((c) => c.path === f.name).length;
    f.cbadge.textContent = [n ? plural(n, 'comment') : '', ths.length ? plural(ths.length, 'thread') : ''].filter(Boolean).join(' · ');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    const id = b.dataset.id, act = b.dataset.act;
    if (act === 'sinceonly') { sinceOnly = !sinceOnly; applyFilter(); render(); return; }
    if (act === 'reply' || act === 'tthread') {
      const t = threadById.get(id);
      if (!t) return;
      if (act === 'reply') { t.open = true; openEditor({ subject: 'reply', thread_id: t.tid, path: t.path, body: '', attachments: [] }); }
      else { t.open = !b.closest('.thread').classList.contains('open'); renderFile(byName.get(t.path)); }
      return;
    }
    const c = state.comments.find((x) => x.id === id);
    const s = suggestions.find((x) => x.sid === id);
    if (act === 'delete' && c) {
      state.comments = state.comments.filter((x) => x !== c);
      if (c.sid && !state.dismissed.includes(c.sid)) state.dismissed.push(c.sid);
    } else if (act === 'edit' && c) {
      openEditor(Object.assign({}, c, { attachments: (c.attachments || []).slice() }));
      return;
    } else if (act === 'accept' && s) {
      state.comments.push(commentFrom(s));
    } else if (act === 'edit-s' && s) {
      openEditor({ sid: s.sid, path: s.path, subject: s.subject, side: s.side, line: s.line,
        start_side: s.start_side ?? null, start_line: s.start_line ?? null, body: s.body, attachments: [], sig: sigOf(s.path) });
      return;
    } else if (act === 'dismiss' && s) {
      state.dismissed.push(s.sid);
    } else return;
    save();
    renderFile(byName.get((c || s).path));
    render();
    if (document.body.classList.contains('submitting')) renderSubmit();
  });

  // --- the Markdown editor ------------------------------------------------
  const TOOLS = [['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['code', '&lt;/&gt;', 'Code'], ['link', 'Link', 'Link'],
    ['quote', 'Quote', 'Quote'], ['list', 'List', 'Bulleted list'], ['task', 'Task', 'Task list']];
  const MAX_ATT = 3 * 1024 * 1024;

  function makeEditor(draft, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'editor' + (opts.inline ? ' inline' : '');
    wrap.innerHTML =
      '<div class="etabs"><button type="button" data-tab="write" class="on">Write</button>' +
      '<button type="button" data-tab="preview">' + (opts.previewLabel || 'Preview') + '</button>' +
      (opts.inline ? '' : '<span class="eloc svnote"></span>') + '<span class="etools">' +
      TOOLS.map((t) => '<button type="button" data-tool="' + t[0] + '" title="' + t[2] + '">' + t[1] + '</button>').join('') +
      '<button type="button" data-tool="suggest" title="Suggest a replacement for the selected new-side lines">Suggest</button>' +
      '<button type="button" data-tool="attach" title="Attach files (you can also paste or drop them)">Attach</button></span></div>' +
      '<textarea placeholder="' + (opts.placeholder || 'Leave a comment. Markdown supported.') + '"></textarea>' +
      '<div class="md epreview hidden"></div><div class="eatts"></div><input type="file" multiple class="hidden">' +
      '<div class="efoot"><span class="hint">Markdown &middot; paste or drop files' +
      (opts.inline ? '' : ' &middot; &#8984;&#8629; to save &middot; Esc to cancel') + '</span>' +
      (opts.inline ? '' : '<button type="button" data-ed="cancel">Cancel</button><button type="button" data-ed="save" class="primary">' +
        (draft.id ? 'Update comment' : draft.subject === 'reply' ? 'Add reply to review' : 'Add to review') + '</button>') + '</div>';
    const ta = wrap.querySelector('textarea'), pv = wrap.querySelector('.epreview'), hint = wrap.querySelector('.hint');
    const hintText = hint.innerHTML;
    const atts = wrap.querySelector('.eatts'), picker = wrap.querySelector('input[type=file]');
    ta.value = draft.body || '';
    wrap.suggestable = () => !!(opts.suggest && opts.suggest());
    if (!opts.suggest) wrap.querySelector('[data-tool="suggest"]').remove();
    else wrap.querySelector('[data-tool="suggest"]').disabled = !wrap.suggestable();
    const changed = () => { draft.body = ta.value; if (opts.onInput) opts.onInput(); };
    ta.addEventListener('input', changed);
    const tell = (msg, err) => {
      hint.innerHTML = esc(msg); hint.classList.toggle('err', !!err);
      setTimeout(() => { hint.innerHTML = hintText; hint.classList.remove('err'); }, 4000);
    };

    const replace = (s, e, text, selFrom, selTo) => {
      ta.focus();
      ta.setRangeText(text, s, e, 'end');
      if (selFrom != null) ta.setSelectionRange(s + selFrom, s + selTo);
      changed();
    };
    const wrapSel = (before, after, placeholder) => {
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder;
      replace(s, e, before + sel + after, before.length, before.length + sel.length);
    };
    const prefix = (p) => {
      const v = ta.value, s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      let e = v.indexOf('\n', ta.selectionEnd); if (e === -1) e = v.length;
      const text = v.slice(s, e).split('\n').map((l) => p + l).join('\n');
      replace(s, e, text, text.length, text.length);
    };
    const block = (text) => {
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const pre = s && v[s - 1] !== '\n' ? '\n' : '', post = v[e] && v[e] !== '\n' ? '\n' : '';
      replace(s, e, pre + text + post, (pre + text).length, (pre + text).length);
    };
    const tools = {
      bold: () => wrapSel('**', '**', 'bold text'),
      italic: () => wrapSel('_', '_', 'italic text'),
      code: () => (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')
        ? wrapSel('```\n', '\n```', '') : wrapSel('`', '`', 'code')),
      link: () => {
        const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'text';
        replace(s, e, '[' + sel + '](url)', sel.length + 3, sel.length + 6);
      },
      quote: () => prefix('> '),
      list: () => prefix('- '),
      task: () => prefix('- [ ] '),
      suggest: () => { const orig = opts.suggest && opts.suggest(); if (orig) block('```suggestion\n' + orig.join('\n') + '\n```\n'); },
      attach: () => picker.click(),
    };

    const renderAtts = () => {
      atts.innerHTML = draft.attachments.map((a) => '<span class="chip">' + esc(a.name) + ' &middot; ' +
        Math.max(1, Math.round(a.size / 1024)) + ' KB<button type="button" data-rm="' + a.id + '" title="Remove">&times;</button></span>').join('');
    };
    const addFiles = (list) => Array.from(list || []).forEach((file) => {
      if (file.size > MAX_ATT) { tell(file.name + ' is over 3 MB; link to it instead.', true); return; }
      const rd = new FileReader();
      rd.onload = () => {
        const a = { id: uid('a'), name: file.name || 'pasted-image.png', type: file.type, size: file.size, data: rd.result };
        draft.attachments.push(a);
        block((a.type.startsWith('image/') ? '!' : '') + '[' + a.name + '](attachment:' + a.id + ')');
        renderAtts();
      };
      rd.readAsDataURL(file);
    });
    picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
    ta.addEventListener('paste', (e) => { if (e.clipboardData && e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
    ta.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drag'); });
    ta.addEventListener('dragleave', () => wrap.classList.remove('drag'));
    ta.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drag'); addFiles(e.dataTransfer.files); });
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && opts.onSave) { e.preventDefault(); opts.onSave(); }
      if (e.key === 'Escape' && opts.onCancel && !ta.value.trim()) opts.onCancel();
    });
    wrap.addEventListener('click', (e) => {
      // Keep clicks from reaching the file header behind, but let links in a preview work.
      if (!e.target.closest('a')) e.stopPropagation();
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.rm) {
        draft.attachments = draft.attachments.filter((a) => a.id !== t.dataset.rm);
        ta.value = ta.value.replace(new RegExp('!?\\[[^\\]]*\\]\\(attachment:' + t.dataset.rm + '\\)\\n?', 'g'), '');
        changed(); renderAtts();
      } else if (t.dataset.tab) {
        const prev = t.dataset.tab === 'preview';
        wrap.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === t));
        // Preview shows what will be posted and nothing else: the toolbar, hint and attachment chips go.
        wrap.classList.toggle('previewing', prev);
        ta.classList.toggle('hidden', prev); pv.classList.toggle('hidden', !prev);
        if (prev) pv.innerHTML = (opts.preview ? opts.preview() : MD.render(ta.value, { attachments: attMap(draft.attachments), original: originalOf(draft) })) ||
          '<p class="svnote">Nothing to preview</p>';
      } else if (t.dataset.tool) tools[t.dataset.tool]();
      else if (t.dataset.ed === 'save') opts.onSave();
      else if (t.dataset.ed === 'cancel') opts.onCancel();
    });
    renderAtts();
    return wrap;
  }

  // --- the overview: step 1 ------------------------------------------------
  // The feature and the shape of the change, before any code. The agent writes the prose, checks
  // and diagrams (GUIDE.overview); where the change lands and how file sizes moved come from git.
  const ovv = $('overviewview');
  const SIZES = META.sizes || null;
  const fileLink = (name, html) => {
    const f = byName.get(name);
    return f ? '<a href="#f' + f.i + '">' + (html || esc(name)) + '</a>' : (html || esc(name));
  };
  function checksLabel() {
    const n = checks.filter((c) => checkOf(c).s).length, k = concerns().length;
    return n + ' / ' + checks.length + (k ? ' · ' + plural(k, 'concern') : '');
  }
  const areaOf = (name) => {
    const hit = ((OV && OV.shape && OV.shape.areas) || []).find((a) => a.prefix && name.startsWith(a.prefix));
    if (hit) return hit.label || hit.prefix;
    const dir = name.split('/').slice(0, -1);
    return dir.slice(0, 3).join('/') || '(root)';
  };
  // A file that crosses this many lines in the change gets a badge: a nudge, not a rule.
  const LARGE = 400;
  const sign = (n) => (n > 0 ? '+' : '') + n.toLocaleString();
  // Where the change lands and how the files' sizes moved, as one table: an area per row, with its
  // lines added and removed, opening to its files' sizes before and after.
  function landsHtml() {
    const size = (f) => (SIZES && SIZES[f.name]) || [];
    const m = new Map();
    files.forEach((f) => {
      const k = areaOf(f.name), a = m.get(k) || { k, add: 0, del: 0, files: [], b: 0, a: 0 };
      a.add += f.add; a.del += f.del; a.files.push(f); a.b += size(f)[0] || 0; a.a += size(f)[1] || 0;
      m.set(k, a);
    });
    const areas = Array.from(m.values()).sort((x, y) => y.add + y.del - (x.add + x.del));
    const max = Math.max(1, ...areas.map((r) => r.add + r.del));
    const fmax = Math.max(1, ...files.map((f) => Math.max(size(f)[0] || 0, size(f)[1] || 0)));
    const net = (f) => (size(f)[1] || 0) - (size(f)[0] || 0);
    const fileRow = (f) => {
      const [b, a] = size(f);
      return '<tr><td>' + fileLink(f.name, '<code>' + esc(f.name.split('/').pop()) + '</code>') +
        (f.status !== 'modified' ? ' <span class="badge">' + f.status + '</span>' : '') +
        ((a || 0) > LARGE && (b || 0) <= LARGE ? ' <span class="badge stale" title="Crossed ' + LARGE + ' lines in this change">now ' + a + ' lines</span>' : '') +
        '</td><td class="ovnum"><span class="add">+' + f.add + '</span> <span class="del">-' + f.del + '</span></td>' +
        (SIZES ? '<td class="ovnum muted">' + (b ?? '–') + ' → ' + (a ?? '–') + '</td><td class="ovsize" title="Before (grey) and after (accent), to scale">' +
          '<i class="b" style="width:' + ((b || 0) / fmax * 100) + '%"></i><i class="a" style="width:' + ((a || 0) / fmax * 100) + '%"></i></td>' : '') + '</tr>';
    };
    let total = '';
    if (SIZES) {
      const tb = files.reduce((n, f) => n + (size(f)[0] || 0), 0), ta = files.reduce((n, f) => n + (size(f)[1] || 0), 0);
      const nNew = files.filter((f) => f.status === 'added').length, nGone = files.filter((f) => f.status === 'deleted').length;
      total = '<p class="ovtotal">The touched files went from <b>' + tb.toLocaleString() + '</b> to <b>' + ta.toLocaleString() + '</b> lines (' + sign(ta - tb) + ')' +
        (nNew ? ', ' + plural(nNew, 'new file') : '') + (nGone ? ', ' + plural(nGone, 'deleted file') : '') + '. Open an area for its files.</p>';
    }
    return total + '<div class="lands">' + areas.map((r) => '<details class="land"><summary><span class="lk"><code>' + esc(r.k) + '</code></span>' +
      '<span class="ln">' + plural(r.files.length, 'file') + '</span><span class="ovbar"><span><i class="a" style="width:' + (r.add / max * 100) +
      '%"></i><i class="d" style="width:' + (r.del / max * 100) + '%"></i></span></span><span class="ovnum"><span class="add">+' + r.add +
      '</span> <span class="del">-' + r.del + '</span></span>' + (SIZES ? '<span class="ovnum lnet ' + (r.a > r.b ? 'add' : r.a < r.b ? 'del' : '') + '" title="Net change in the files\' length">' +
      sign(r.a - r.b) + ' net</span>' : '') + '</summary><table class="ovsizes"><tbody>' +
      r.files.slice().sort((x, y) => Math.abs(net(y)) - Math.abs(net(x)) || x.i - y.i).map(fileRow).join('') + '</tbody></table></details>').join('') + '</div>';
  }
  const STATUS_TAG = { new: 'new', changed: 'changed', removed: 'removed', same: 'unchanged' };
  function shapeFactsHtml(sh) {
    const objs = sh.objects || [], deps = sh.dependencies || [], deps2 = deps.map((d) => (typeof d === 'string' ? { name: d } : d));
    let h = '';
    if ((sh.layers || []).length) h += '<div class="ovrow"><span class="ovlbl">Layers touched</span>' + sh.layers.map((l) => '<span class="chip">' + esc(l) + '</span>').join(' ') + '</div>';
    if (objs.length) {
      h += '<table class="ovobjs"><thead><tr><th>Object</th><th></th><th>Responsibility</th></tr></thead><tbody>' + objs.map((o) => {
        const s = STATUS_TAG[o.status] ? o.status : 'changed';
        return '<tr><td>' + (o.path ? fileLink(o.path, '<code>' + esc(o.name) + '</code>') : '<code>' + esc(o.name) + '</code>') +
          '</td><td><span class="stag ' + s + '">' + STATUS_TAG[s] + '</span></td><td class="md">' + mdHtml(o.note) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (deps2.length) h += '<div class="ovrow"><span class="ovlbl">New dependencies</span>' + deps2.map((d) => '<span class="chip">' + esc(d.name) +
      '</span>' + (d.note ? ' <span class="svnote">' + esc(d.note) + '</span>' : '')).join(' ') + '</div>';
    return h;
  }
  function departuresHtml(sh) {
    const list = (sh.departures || []).map((d) => (typeof d === 'string' ? { text: d } : d));
    if (!list.length) return '';
    return '<div class="ovwarn"><b>Departures from the architecture</b><ul>' + list.map((d) => '<li><span class="md">' + mdHtml(d.text) + '</span>' +
      (d.path ? ' ' + fileLink(d.path, '<code>' + esc(d.path) + (d.line ? ':' + d.line : '') + '</code>') : '') + '</li>').join('') + '</ul></div>';
  }
  // Checks can sit with a step of the feature overview (by `id`), next to the part of the flow they
  // test; the rest are listed under the feature. Each renders once, wherever it lands.
  const CX = (OV && OV.connection) || null;
  const cxSteps = (CX && CX.steps) || [];
  const placed = new Set(cxSteps.flatMap((st) => st.checks || []));
  const looseChecks = checks.filter((c) => !(c.id && placed.has(c.id)));
  const DESC = readJSON('desc-src', null);
  function checksHtml(list) {
    return list.map((c) => {
      const k = checkOf(c);
      return '<div class="chk ' + (k.s || '') + '" data-k="' + esc(c.kid) + '"><div class="chkbtns">' +
        '<button type="button" data-chk="ok" class="' + (k.s === 'ok' ? 'on' : '') + '">Looks right</button>' +
        '<button type="button" data-chk="concern" class="' + (k.s === 'concern' ? 'on' : '') + '">Concern</button></div>' +
        (c.kind === 'should'
          ? '<div class="chktext"><span class="ktag should" title="Behaviour the change should have but doesn\'t yet">Should</span>'
          : '<div class="chktext"><span class="ktag does" title="Behaviour the change implements. Confirm it works and is wanted.">Does</span>') +
        '<span class="md">' + mdHtml(c.text) + '</span></div>' +
        (c.how ? '<div class="chkhow md"><b>How to check:</b> ' + mdHtml(c.how) + '</div>' : '') +
        (c.path ? '<div class="chkfile">' + fileLink(c.path, '<code>' + esc(c.path) + '</code>') + '</div>' : '') +
        (k.s === 'concern' ? '<textarea class="chknote" placeholder="What is wrong? This goes into the review summary.">' + esc(k.note || '') + '</textarea>' : '') +
        '</div>';
    }).join('');
  }
  const figures = (list) => {
    const box = document.createElement('div');
    box.className = 'ovdiags';
    list.forEach((d) => box.appendChild(DIAG.render(d, mdHtml)));
    return box;
  };
  // The PR description: the agent's digest of what the author said, the author's screenshots, and the
  // full text folded away. Screenshots were downloaded at build time and ride in as data URLs.
  function authorHtml() {
    const au = (OV && OV.author) || {};
    if (!DESC && !au.summary) return '';
    const media = DESC ? Object.entries(DESC.images) : [];
    const thumbs = media.map(([id, src]) => '<figure class="dmedia">' + (src.startsWith('data:video/')
      ? '<video src="' + esc(src) + '" controls muted loop playsinline preload="metadata"></video>'
      : '<img src="' + esc(src) + '" alt="Screenshot from the PR description" title="Click to enlarge">') + '</figure>').join('');
    return '<section class="ovblock" id="ov-author"><h3>From the PR description' + (DESC && DESC.author ? ' <span class="ovct">by ' +
        (DESC.url ? '<a href="' + esc(DESC.url) + '" target="_blank" rel="noopener">@' + esc(DESC.author) + '</a>' : '@' + esc(DESC.author)) + '</span>' : '') + '</h3>' +
      (au.summary ? '<div class="md">' + mdHtml(au.summary) + '</div>' : '') +
      ((au.points || []).length ? '<ul class="rgpoints">' + au.points.map((p) => '<li class="md">' + inlineMd(p) + '</li>').join('') + '</ul>' : '') +
      (au.differs ? '<div class="ovwarn"><b>Where the code differs from the description</b><div class="md">' + mdHtml(au.differs) + '</div></div>' : '') +
      (thumbs ? '<div class="ovthumbs">' + thumbs + '</div>' : '') +
      (DESC && DESC.body.trim() ? '<details class="ovmore"' + (au.summary ? '' : ' open') + '><summary>The full description</summary><div class="md ovdesc">' +
        MD.render(DESC.body, { attachments: DESC.images }) + '</div></details>' : '') + '</section>';
  }

  // CI at the PR head, read when the page was built. Red or pending comes first, with links; the
  // passing checks fold away.
  const CI = PR && PR.ci;
  const ciCount = (b) => CI ? CI.checks.filter((c) => c.bucket === b).length : 0;
  const ciLabel = () => !CI ? '' : !CI.checks.length ? 'no checks' : ciCount('fail') ? ciCount('fail') + ' failing'
    : ciCount('pending') ? ciCount('pending') + ' running' : 'passing';
  function ciHtml() {
    if (!CI) return '';
    const link = (c) => (c.link ? '<a href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name)) +
      (c.workflow && c.workflow !== c.name ? ' <span class="svnote">' + esc(c.workflow) + '</span>' : '');
    const bad = CI.checks.filter((c) => c.bucket === 'fail' || c.bucket === 'pending' || c.bucket === 'cancel');
    const good = CI.checks.filter((c) => !bad.includes(c));
    const tone = ciCount('fail') || ciCount('cancel') ? 'fail' : ciCount('pending') ? 'pending' : 'pass';
    return '<section class="ovci ' + tone + '"><b>CI ' + esc(ciLabel()) + '</b> <span class="svnote">at the PR head, as of ' + esc(when(CI.at)) +
      (META.commitId && META.commitId !== PR.headSha ? '; this page shows an earlier commit' : '') + '</span>' +
      (bad.length ? '<ul>' + bad.map((c) => '<li><span class="stag ' + (c.bucket === 'pending' ? 'changed' : 'removed') + '">' +
        esc(c.bucket === 'fail' ? 'failed' : c.bucket) + '</span> ' + link(c) + '</li>').join('') + '</ul>' : '') +
      (good.length ? '<details class="ovmore"><summary>' + plural(good.length, 'check') + ' ' + (bad.length ? 'passed or skipped' : 'passed') +
        '</summary><ul>' + good.map((c) => '<li>' + link(c) + '</li>').join('') + '</ul></details>' : '') + '</section>';
  }

  // The feature overview: how the pieces come together, end to end. Each step pairs what the person
  // using the product sees (screenshots, recordings) with what runs underneath, links to the groups
  // and files that do it, and carries the checks that test it.
  const gIndex = (t) => sections.findIndex((g) => g.title === t);
  // The map: the connection diagram whose parts name their steps. It shows whole above the steps, and
  // a small copy floats beside them, lit at the step being read (mini, below).
  const connectionMap = () => {
    const m = (cxSteps.length > 1 ? diagramsIn('connection').find(DIAG.isStaged) : null) || null;
    // The map's steps are the connection steps, so its breadcrumbs carry their titles.
    if (m && !m.stages) m.stages = cxSteps.map((st) => st.title.replace(/`/g, ''));
    return m;
  };
  function connectionHtml() {
    if (!CX) return '';
    const step = (st, i) => {
      const links = (st.groups || []).filter((t) => gIndex(t) !== -1).map((t) => '<a class="cxgroup" href="#recs" data-rg="' + gIndex(t) +
          '"><span class="gnum">' + (gIndex(t) + 1) + '.</span> ' + esc(t) + '</a>').join('') +
        (st.files || []).map((n) => fileLink(n, '<span class="rfile">' + esc(n.split('/').pop()) + '</span>')).join('');
      const vis = (st.visuals || []).length;
      return '<li class="cxstep' + (vis ? '' : ' novis') + '"><div class="cxnum">' + (i + 1) + '</div><div class="cxbody">' +
        (vis ? '<div class="cxvis" data-cxvis="' + i + '"></div>' : '') + '<div class="cxtext"><h4>' + inlineMd(st.title) + '</h4>' +
        (st.user ? '<div class="md cxuser">' + mdHtml(st.user) + '</div>' : '') +
        (links ? '<div class="cxlinks">' + links + '</div>' : '') + '</div></div></li>';
    };
    return '<section class="ovblock" id="ov-connection"><h3>How it comes together</h3>' +
      (CX.summary ? '<div class="md">' + mdHtml(CX.summary) + '</div>' : '') + '<div data-diags="connection"></div>' +
      (CX.technical ? '<h4>How it works</h4><div class="md">' + mdHtml(CX.technical) + '</div>' : '') +
      (cxSteps.length ? '<h4>Step by step</h4><ol class="cxsteps' + (connectionMap() ? ' mapped' : '') + '">' + cxSteps.map(step).join('') + '</ol>' : '') + '</section>';
  }

  // The first three steps each show one part of the overview: the story, the checks, the shape.
  const stepHead = (eyebrow, title, note) => '<div class="ovhead"><div class="eyebrow">' + eyebrow + '</div><h2>' + title + '</h2>' +
    (note ? '<p class="lede">' + note + '</p>' : '') + '</div>';
  const stepFoot = (cur) => {
    const at = STEPS.findIndex((s) => s.id === cur), b = STEPS[at - 1], n = STEPS[at + 1];
    return '<div class="ovfoot">' + (b ? '<button type="button" class="quiet" data-across="-1">' + b.label + ' <kbd>k</kbd></button>' : '') +
      '<span class="sp"></span>' + (n ? '<button type="button" class="primary big" data-across="1">Next: ' + n.label + ' <kbd>j</kbd></button>' : '') + '</div>';
  };
  function checksByStep() {
    const block = (title, list) => list.length ? '<section class="ovblock' + (title ? '' : ' untitled') + '">' + (title ? '<h3>' + title + '</h3>' : '') + checksHtml(list) + '</section>' : '';
    const stepBlock = (st, i) => {
      const list = (st.checks || []).map((id) => checks.find((c) => c.id === id)).filter(Boolean);
      if (!list.length) return '';
      const n = (st.visuals || []).length;
      return '<section class="ovblock chkstep"><h3><span class="cxn">' + (i + 1) + '</span>' + inlineMd(st.title) + '</h3>' +
        (st.user ? '<div class="md cxuser">' + mdHtml(st.user) + '</div>' : '') +
        (n ? '<details class="chkvis"><summary>' + (n === 1 ? 'The screen' : 'The ' + n + ' screens') + ' for this step</summary><div class="cxvis" data-cxvis="' + i + '"></div></details>' : '') +
        checksHtml(list) + '</section>';
    };
    return block(placed.size ? 'The feature as a whole' : '', looseChecks) + cxSteps.map(stepBlock).join('');
  }
  function renderOverview(step) {
    const fe = (OV && OV.feature) || {}, sh = (OV && OV.shape) || {};
    let h;
    if (step === 'story') {
      h = stepHead('Understand', 'What this change is for', 'The author\'s account, then how the feature comes together. No code yet.') +
        ciHtml() + authorHtml() +
        (OV ? '' : '<div class="ovblock"><p class="svnote">No overview was written for this change. The agent adds one under <code>overview</code> in the reading guide.</p></div>') +
        (OV && (fe.summary || fe.behavior || diagramsIn('feature').length)
          ? '<section class="ovblock" id="ov-feature"><h3>The feature</h3>' + (fe.summary ? '<div class="md">' + mdHtml(fe.summary) + '</div>' : '') +
            (fe.behavior ? '<h4>Behaviour</h4><div class="md">' + mdHtml(fe.behavior) + '</div>' : '') + '<div data-diags="feature"></div></section>' : '') +
        connectionHtml();
    } else if (step === 'checks') {
      h = stepHead('Understand', 'Does it behave the way it should?', 'Confirm each check in the app or by reasoning. A concern and its note go into your review summary.') +
        '<div class="chkct" id="ovchkct"></div>' + checksByStep();
    } else {
      h = stepHead('Understand', 'How the code is shaped', 'What was added, changed and removed, and where the lines landed.') +
        '<section class="ovblock" id="ov-shape">' + (sh.summary ? '<div class="md">' + mdHtml(sh.summary) + '</div>' : '') +
        '<div data-diags="shape"></div>' + shapeFactsHtml(sh) + departuresHtml(sh) + '</section>' +
        '<section class="ovblock"><h3>Where the change lands</h3>' + (sh.codebase ? '<div class="md">' + mdHtml(sh.codebase) + '</div>' : '') + landsHtml() + '</section>';
    }
    ovv.innerHTML = '<div class="ovcol">' + h + stepFoot(step) + '</div>';
    ['feature', 'connection', 'shape'].forEach((sec) => {
      const slot = ovv.querySelector('[data-diags="' + sec + '"]');
      const list = diagramsIn(sec);
      if (slot && list.length) slot.replaceWith(figures(list));
    });
    mini.set(connectionMap());
    cxSteps.forEach((st, i) => {
      const slot = ovv.querySelector('[data-cxvis="' + i + '"]');
      if (slot) (st.visuals || []).forEach((d) => slot.appendChild(DIAG.render(d, mdHtml)));
    });
    const ct = $('ovchkct');
    if (ct) ct.textContent = checksLabel() + ' checked';
  }
  // The minimap: the whole map, small, floating beside the steps while they're on screen, lit at
  // the step being read. Clicking it opens the walkthrough at that step.
  const mini = (() => {
    const el = document.createElement('aside');
    el.className = 'cxmini hidden';
    el.title = 'Open the walkthrough';
    document.body.appendChild(el);
    let map = null, at = -1;
    const sync = () => {
      const list = ovv.querySelector('.cxsteps'), fig = el.querySelector('figure');
      const show = !!(map && list && fig && document.body.dataset.view === 'story' && lightbox.classList.contains('hidden'));
      const r = show && list.getBoundingClientRect();
      const inView = show && r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.4;
      el.classList.toggle('hidden', !inView);
      if (!inView) return;
      el.classList.toggle('gutter', (window.innerWidth - Math.min(list.closest('.ovcol').offsetWidth, window.innerWidth)) / 2 > 280);
      let n = 0;
      list.querySelectorAll(':scope > .cxstep').forEach((li, i) => { if (li.getBoundingClientRect().top < window.innerHeight * 0.45) n = i + 1; });
      if (n === at) return;
      at = n;
      DIAG.focus(fig, n);
      el.querySelector('.cxminih').innerHTML = n ? '<b>' + n + '</b> of ' + cxSteps.length + ' · ' + inlineMd(cxSteps[n - 1].title) : 'The whole picture';
    };
    el.addEventListener('click', () => { if (map) openWalk(map, at > 0 ? at : 0); });
    addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    addEventListener('resize', sync);
    addEventListener('hashchange', () => setTimeout(sync));
    return {
      set(m) {
        map = m; at = -1;
        el.innerHTML = '<div class="cxminih"></div>';
        if (m) el.appendChild(DIAG.render(Object.assign({}, m, { title: null, caption: null }), mdHtml, { plain: true, big: true }));
        sync();
      },
      sync,
    };
  })();

  // A check can show in the overview and on a recommendation; both share its state.
  function onCheck(b, root) {
    const kid = b.closest('.chk').dataset.k, cur = state.checks[kid] || {};
    state.checks[kid] = cur.s === b.dataset.chk ? {} : { s: b.dataset.chk, note: cur.note || '' };
    concernDecides(checks.find((c) => c.kid === kid), state.checks[kid].s === 'concern');
    save();
    // Redraw only this check: it may sit inside a step, next to a recording that is playing.
    b.closest('.chk').outerHTML = checksHtml(checks.filter((c) => c.kid === kid));
    if ($('ovchkct')) $('ovchkct').textContent = checksLabel() + ' checked';
    render();
    if (b.dataset.chk === 'concern' && state.checks[kid].s) {
      const ta = root.querySelector('.chk[data-k="' + kid + '"] .chknote');
      if (ta) ta.focus();
    }
  }
  // A concern on a check says yes to the open recommendations linked to it: the reviewer has just
  // agreed something is wrong there. Taking the concern back undoes those yeses, unless the reviewer
  // has decided the recommendation themselves since. A recommendation already decided is left alone.
  function concernDecides(c, on) {
    if (!c || !c.id) return;
    const linked = recs.filter((r) => (r.checks || []).includes(c.id));
    const said = [];
    linked.forEach((r) => {
      if (on && recStatus(r) === 'open') { decide(r, 'yes'); if (recStatus(r) !== 'open') { state.autoYes[r.rid] = c.kid; said.push(r.title); } }
      else if (!on && state.autoYes[r.rid] === c.kid) {
        if (recStatus(r) === 'yes') decide(r, 'yes');
        delete state.autoYes[r.rid];
      }
      redrawRec(r);
    });
    if (said.length) flash('Added ' + said.map((t) => '“' + t + '”').join(', ') + '. Change it under Recommendations.');
  }
  function onCheckNote(e) {
    if (!e.target.classList.contains('chknote')) return;
    const kid = e.target.closest('.chk').dataset.k;
    state.checks[kid] = Object.assign({}, state.checks[kid], { note: e.target.value });
    save();
  }
  ovv.addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (j) { e.preventDefault(); const el = $(j.dataset.jump); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hdr.offsetHeight - 8); return; }
    const b = e.target.closest('[data-chk]');
    if (b) onCheck(b, ovv);
  });
  ovv.addEventListener('input', onCheckNote);

  // --- recommendations: the code step's default mode -------------------------
  // The change at the height of the reading guide: each group as a short gist, its points, its
  // diagrams, screenshots and recordings, its files as chips, and the recommendations to decide.
  // The diff behind any of it is one click (or r) away.
  const rv = $('recsview');
  const KIND = { bug: 'Bug', risk: 'Risk', design: 'Design', tests: 'Tests', style: 'Style', question: 'Question' };
  const inlineMd = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
  const refLabel = (s) => s.line == null ? 'file' : (s.start_line != null && s.start_line !== s.line ? s.start_line + '–' : '') + s.line;
  // A recommendation's short sections. Its kind decides which it has: a question has no proposal,
  // a bug no tradeoffs. Keep in step with REC_PARTS in build-review.cjs.
  const PART_LABEL = { context: 'Context', problem: 'Problem', proposal: 'Proposal', tradeoffs: 'Tradeoffs' };
  const PARTS = Object.keys(PART_LABEL);
  const REC_PARTS = { bug: ['context', 'problem', 'proposal'], risk: PARTS, design: PARTS, tests: ['context', 'problem', 'proposal'],
    style: ['context', 'proposal', 'tradeoffs'], question: ['context', 'problem', 'tradeoffs'] };
  const RENAME = { bug: { proposal: 'Fix' }, risk: { problem: 'Risk' }, tests: { problem: 'Gap' }, question: { problem: 'Question' } };
  const partsHtml = (r) => {
    const list = (REC_PARTS[r.kind] || PARTS).filter((p) => r[p] && String(r[p]).trim());
    if (!list.length) return '';
    return '<dl class="recparts">' + list.map((p) => '<div class="recpart ' + p + '"><dt>' + ((RENAME[r.kind] || {})[p] || PART_LABEL[p]) +
      '</dt><dd class="md">' + mdHtml(r[p]) + '</dd></div>').join('') + '</dl>';
  };
  // One suggested comment inside a recommendation, with its own Accept / Edit / Dismiss. What shows is
  // the reviewer's version once they have accepted or edited it.
  const goLink = (s, html, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="#f' + byName.get(s.path).i + '" data-go="' + esc(s.sid) +
    '" title="Open ' + esc(s.path) + ' at this line">' + html + '</a>';
  function recCommentHtml(s) {
    const c = state.comments.find((x) => x.sid === s.sid);
    const st = c ? 'yes' : state.dismissed.includes(s.sid) ? 'no' : 'open';
    const btn = (act, label, cls) => '<button type="button"' + (cls ? ' class="' + cls + '"' : '') + ' data-rc="' + act + '" data-sid="' + esc(s.sid) + '">' + label + '</button>';
    // The actions sit in the card's own footer: the state on the left, the quiet choices, then the main one.
    const acts = st === 'open' ? '<span class="reccst">Suggested comment</span><span class="sp"></span>' + btn('dismiss', 'Dismiss', 'quiet') + btn('edit', 'Edit', 'quiet') + btn('accept', 'Accept', 'primary')
      : st === 'yes' ? '<span class="reccst yes">In your review</span><span class="sp"></span>' + btn('remove', 'Remove', 'quiet') + btn('edit', 'Edit')
        : '<span class="reccst">Dismissed</span><span class="sp"></span>' + btn('restore', 'Restore');
    const mine = editing && editing.inRecs && editing.sid === s.sid;
    return '<div class="recc ' + st + '" data-sid="' + esc(s.sid) + '"><div class="svfile">' + goLink(s, esc(s.path) + ' &middot; ' + esc(locLabel(s))) + '</div>' + snippetHtml(s) +
      (mine ? '<div class="recedit"></div>' : '<div class="md">' + renderBody(c || s) + '</div><div class="reccfoot">' + acts + '</div>') + '</div>';
  }
  // The guide section a recommendation rests on, folded: the standard, a click away, in its own words.
  const principleHtml = (r) => {
    const p = r.principle;
    if (!p || !(p.name || p.title)) return '';
    const label = '<span class="cxlbl">Principle</span> ' + esc(p.name || p.title) + (p.name && p.title ? ' <span class="svnote">&middot; ' + esc(p.title) + '</span>' : '');
    return p.text ? '<details class="recprin"><summary>' + label + '</summary><div class="md">' + mdHtml(p.text) + '</div></details>'
      : '<div class="recprin">' + label + '</div>';
  };
  function recHtml(r) {
    const st = recStatus(r), sugs = suggestions.filter((s) => r.sids.includes(s.sid)), n = sugs.length;
    const inReview = sugs.filter((s) => accepted(s.sid)).length;
    const what = !n ? { open: 'Add puts it in your summary', yes: 'In your summary', no: 'Ignored' }[st]
      : { open: 'Add puts ' + plural(n, 'comment') + ' in your review', yes: plural(n, 'comment') + ' in your review', no: 'Ignored',
        mixed: inReview + ' of ' + plural(n, 'comment') + ' in your review' }[st];
    const parts = partsHtml(r), mine = (r.checks || []).map((id) => checks.find((c) => c.id === id)).filter(Boolean);
    return '<article class="rec ' + st + '" data-rid="' + esc(r.rid) + '"><div class="rectop">' +
      // Kind and severity read as one quiet line over the title, not as badges beside it.
      (r.kind || SEV[r.severity] ? '<div class="recmeta">' +
        (r.kind ? '<span class="stag ' + esc(r.kind) + '">' + esc(KIND[r.kind] || r.kind) + '</span>' : '') +
        (SEV[r.severity] ? '<span class="sevtag ' + esc(r.severity) + '">' + SEV[r.severity] + '</span>' : '') + '</div>' : '') +
      '<h3 class="rectitle">' + inlineMd(r.title) + '</h3></div>' +
      // A picture often says what the prose can't, so it comes first.
      ((r.visuals || []).length ? '<div class="recvis" data-recvis="' + esc(r.rid) + '"></div>' : '') +
      (parts || (r.why ? '<div class="recwhy md">' + mdHtml(r.why) + '</div>' : '')) +
      principleHtml(r) +
      (state.autoYes[r.rid] && st !== 'open' ? '<div class="recauto">Added because you raised a concern on its feature check. Change it here if that is not what you meant.</div>' : '') +
      // Related checks stay folded, unless one is a concern: then it is why this was flagged.
      (mine.length ? '<details class="recchecks"' + (mine.some((c) => checkOf(c).s === 'concern') ? ' open' : '') + '><summary>' +
        plural(mine.length, 'related feature check') + (mine.some((c) => checkOf(c).s === 'concern') ? ' &middot; <span class="del">concern raised</span>' : '') +
        '</summary>' + checksHtml(mine) + '</details>' : '') +
      // In the focused view the comments are the evidence, so they show open.
      (n ? '<div class="reccomments"><div class="cxlbl">' + (n === 1 ? 'The comment' : 'The ' + n + ' comments') + '</div>' + sugs.map(recCommentHtml).join('') + '</div>' : '') +
      '<div class="recdecide">' + (n ? goLink(sugs[0], 'Show in code', 'btn recgo') : '') + '<span class="recwhat">' + what + '</span><span class="sp"></span>' +
      // A lit button reads as the decision made ("Added", "Ignored"); pressing it again takes it back.
      '<button type="button" data-rec="no" class="no' + (st === 'no' ? ' on' : '') + '">' + (st === 'no' ? 'Ignored' : 'Ignore') + ' <kbd>i</kbd></button>' +
      '<button type="button" data-rec="yes" class="yes' + (st === 'yes' ? ' on' : '') + '">' + (st === 'yes' ? 'Added' : 'Add') + ' <kbd>a</kbd></button></div></article>';
  }

  // The flow: one group at a time, its gist first, then each of its recommendations. Recommendations
  // that belong to no group come first, as "Across the change". The sidebar outline keeps the whole
  // review in sight, and any item in it is one click away.
  const general = recs.filter((r) => r.group == null);
  const recGroups = (general.length ? [{ key: 'gen', title: 'Across the change', why: '', summary: '', points: [], files: [], recs: general, diags: [], gi: -1 }] : [])
    .concat(sections.map((g, gi) => ({ key: 'g' + gi, title: g.title || 'All files', why: g.why, summary: g.summary, points: g.points, files: g.files,
      recs: groupRecs(g), diags: g.title ? diagrams.filter((d) => d.group === g.title) : [], gi, sec: g })));
  recGroups[0].diags = diagramsIn('recs').concat(recGroups[0].diags);
  const hasGist = (G) => !!(G.why || G.summary || G.points.length || G.diags.length || G.files.length);
  const itemsOf = (G) => (hasGist(G) ? ['gist'] : []).concat(G.recs);
  const POS_KEY = KEY + ':recpos';
  let pos = load(POS_KEY, { g: 0, i: 0 });
  const clampPos = () => {
    pos.g = Math.max(0, Math.min(recGroups.length - 1, pos.g | 0));
    pos.i = Math.max(0, Math.min(itemsOf(recGroups[pos.g]).length - 1, pos.i | 0));
  };
  const curItem = () => itemsOf(recGroups[pos.g])[pos.i];
  // In Recommendations only the group you are in stays open in the outline; in Code every group does.
  function syncOutline() {
    const recsView = mode === 'recs';
    recGroups.forEach((G, g) => { const og = outlineOf(G); if (og) og.open = !recsView || g === pos.g; });
    sections.forEach((g) => { const of = g.navEl && g.navEl.querySelector && g.navEl.querySelector('.ofiles'); if (of) of.open = !recsView; });
  }
  function moveTo(g, i) {
    const was = pos.g;
    pos = { g, i };
    clampPos();
    store.set(POS_KEY, JSON.stringify(pos));
    renderRecs();
    if (was !== pos.g) syncOutline();
    refreshOutline();
    window.scrollTo(0, 0);
  }
  function stepFlow(dir) {
    const n = itemsOf(recGroups[pos.g]).length;
    if (dir > 0) {
      if (pos.i < n - 1) moveTo(pos.g, pos.i + 1);
      else if (pos.g < recGroups.length - 1) moveTo(pos.g + 1, 0);
      else goStep('submit');
    } else if (pos.i > 0) moveTo(pos.g, pos.i - 1);
    else if (pos.g > 0) moveTo(pos.g - 1, itemsOf(recGroups[pos.g - 1]).length - 1);
    else stepAcross(-1);
  }
  // j and k walk the whole review: through each step, and item by item inside Recommendations.
  // Coming into Recommendations from behind starts at its last item, so k retraces j exactly.
  function stepAcross(dir) {
    const at = STEPS.findIndex((st) => st.id === document.body.dataset.view), next = STEPS[at + dir];
    if (at === -1 || !next) return;
    if (next.id === 'recs') {
      const g = dir > 0 ? 0 : recGroups.length - 1;
      pos = { g, i: dir > 0 ? 0 : Math.max(0, itemsOf(recGroups[g]).length - 1) };
      store.set(POS_KEY, JSON.stringify(pos));
      store.set(KEY + ':recsseen', '1');
    }
    goStep(next.id);
  }
  function focusRec(r) {
    recGroups.forEach((G, g) => { const i = itemsOf(G).indexOf(r); if (i !== -1) pos = { g, i }; });
    store.set(POS_KEY, JSON.stringify(pos));
  }
  function focusGroup(gi) {
    const g = recGroups.findIndex((G) => G.gi === gi);
    if (g !== -1) { pos = { g, i: 0 }; store.set(POS_KEY, JSON.stringify(pos)); }
  }

  const fileChips = (list) => list.map((f) => '<a class="rfile ' + f.status + (f.cb.checked ? ' viewed' : '') + (f.auto ? ' auto' : '') + '" href="#f' + f.i +
    '" title="' + esc(f.name + (f.auto ? ' — auto-reviewed: ' + (f.auto.summary || '') : '')) + '">' + esc(f.name.split('/').pop()) +
    ' <span class="add">+' + f.add + '</span><span class="del">-' + f.del + '</span></a>').join('');
  function gistHtml(G) {
    return '<article class="gist">' + (G.why ? '<p class="lede">' + esc(G.why) + '</p>' : '') +
      (G.summary ? '<div class="md">' + mdHtml(G.summary) + '</div>' : '') +
      (G.points.length ? '<ul class="rgpoints">' + G.points.map((p) => '<li class="md">' + inlineMd(p) + '</li>').join('') + '</ul>' : '') +
      '<div data-gvis></div>' +
      (G.files.length ? '<details class="gfiles"><summary>' + plural(G.files.length, 'file') + '</summary><div class="rgfiles">' + fileChips(G.files) + '</div></details>' : '') +
      '<p class="gnext">' + (G.recs.length ? plural(G.recs.length, 'recommendation') + ' to decide next.' : 'Nothing to decide in this group.') + '</p></article>';
  }
  function pillsHtml() {
    const G = recGroups[pos.g], items = itemsOf(G);
    if (items.length < 2) return '';
    return items.map((x, j) => '<button type="button" class="pill ' + (x === 'gist' ? 'pgist' : recStatus(x)) + (j === pos.i ? ' on' : '') + '" data-at="' + j +
      '" title="' + esc(x === 'gist' ? 'Summary' : x.title) + '">' + (x === 'gist' ? 'Summary' : hasGist(G) ? j : j + 1) + '</button>').join('');
  }
  function renderRecs() {
    clampPos();
    const G = recGroups[pos.g], items = itemsOf(G), it = items[pos.i];
    const titled = sections.filter((x) => x.title).length;
    const eyebrow = G.key === 'gen' ? 'Before the groups' : G.sec.title ? 'Group ' + (G.gi + 1) + ' of ' + titled : 'The change';
    const nx = items[pos.i + 1], ng = recGroups[pos.g + 1];
    const upNext = nx ? (nx === 'gist' ? 'Summary' : inlineMd(nx.title)) : ng ? 'Next group: ' + esc(ng.title) : 'Submit your review';
    // Back and Next sit in the header row with the pills, so they stay put however tall the card is.
    // Add and Ignore already move on, so on a recommendation the flow buttons step back to quiet links;
    // only the gist, which has nothing to decide, keeps Next as its main action.
    const onRec = it && it !== 'gist';
    const groupCode = G.sec && G.sec.title ? '<a class="btn fcode" href="#g' + G.gi + '">Read this group\'s code</a>' : '';
    rv.innerHTML = '<div class="fhero"><div class="ftitle"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h2>' + esc(G.title) + '</h2></div>' + groupCode + '</div>' +
      '<div class="fbar"><div class="pills">' + pillsHtml() + '</div>' +
      '<div class="fnav' + (onRec ? ' quiet' : '') + '"><span class="fnext">Up next: <b>' + upNext + '</b></span>' +
      '<button type="button" data-flow="-1"' + (pos.g === 0 && pos.i === 0 && STEPS[0].id === 'recs' ? ' disabled' : '') + '>Back <kbd>k</kbd></button>' +
      '<button type="button"' + (onRec ? '' : ' class="primary"') + ' data-flow="1">' + (onRec ? 'Skip' : 'Next') + ' <kbd>j</kbd></button></div></div></div>' +
      '<div class="fstage">' + (it === 'gist' ? gistHtml(G) : it ? recHtml(it) : '') + '</div>';
    const gv = rv.querySelector('[data-gvis]');
    if (gv) { if (G.diags.length) gv.replaceWith(figures(G.diags)); else gv.remove(); }
    mountRecVisuals(rv);
    mountRecEditor();
  }
  const outlineOf = (G) => (G.key === 'gen' ? genNav : G.sec && G.sec.title ? G.sec.navEl : null);
  function refreshOutline() {
    recGroups.forEach((G, g) => {
      const og = outlineOf(G);
      if (!og) return;
      og.querySelector('.orecs').innerHTML = itemsOf(G).map((x, i) => x === 'gist' ? '' : '<a href="#recs" class="orec ' + recStatus(x) +
        (g === pos.g && i === pos.i ? ' on' : '') + '" data-goto="' + g + ':' + i + '"><i></i><span>' + inlineMd(x.title) + '</span></a>').join('');
      og.classList.toggle('cur', g === pos.g);
    });
  }
  // The recommendations that belong to no group get their own section at the top of the outline.
  const genNav = general.length ? (() => {
    const og = document.createElement('details');
    og.className = 'og gen recsonly'; og.open = true;
    og.innerHTML = '<summary class="ghead"><h2><a href="#recs">Across the change</a><span class="gct"></span></h2></summary><div class="orecs"></div>';
    nav.prepend(og);
    return og;
  })() : null;
  nav.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); const [g, i] = go.dataset.goto.split(':').map(Number); moveTo(g, i); return; }
    // In Recommendations a group's title opens its gist; in Code it is a link to the group's files.
    const head = mode === 'recs' && e.target.closest('.og > summary a');
    if (head) {
      e.preventDefault();
      const og = head.closest('.og'), g = recGroups.findIndex((G) => outlineOf(G) === og);
      if (g !== -1) moveTo(g, 0);
    }
  });
  // An editor opened from a recommendation lives in its card; every redraw puts it back in its slot.
  function mountRecEditor() {
    const slot = editing && editing.inRecs && rv.querySelector('.recc[data-sid="' + editing.sid + '"] .recedit');
    if (slot) slot.appendChild(editing.el);
  }
  function mountRecVisuals(within) {
    within.querySelectorAll('[data-recvis]').forEach((el) => {
      const r = recs.find((x) => x.rid === el.dataset.recvis);
      if (r && !el.childElementCount) (r.visuals || []).forEach((d) => el.appendChild(DIAG.render(d, mdHtml)));
    });
  }
  // Redraw just this card, so a playing recording elsewhere keeps going.
  function redrawRec(r) {
    const el = r && rv.querySelector('.rec[data-rid="' + r.rid + '"]');
    if (el) {
      el.outerHTML = recHtml(r);
      const now = rv.querySelector('.rec[data-rid="' + r.rid + '"]');
      mountRecVisuals(now);
      mountRecEditor();
    }
    const p = rv.querySelector('.pills');
    if (p) p.innerHTML = pillsHtml();
    if (mode === 'recs') refreshOutline();
  }
  // Deciding stays on the card, so the reviewer can see what the decision did; Next moves on.
  function decideAndAdvance(r, how) {
    delete state.autoYes[r.rid];
    decide(r, how);
    redrawRec(r);
  }
  const recOfSid = (sid) => recs.find((r) => r.sids.includes(sid));
  // Edit one suggested comment where it sits in its recommendation; saving puts it in the review.
  function editInRecs(s) {
    if (editing && (editing.body.trim() || editing.attachments.length) && editing.sid !== s.sid) {
      flash('Finish or cancel the open comment first.');
      if (editing.inRecs) editing.el.querySelector('textarea').focus();
      return;
    }
    const prev = editing, c = state.comments.find((x) => x.sid === s.sid);
    const draft = c ? Object.assign({}, c, { attachments: (c.attachments || []).slice() }) : Object.assign(commentFrom(s), { id: undefined });
    draft.inRecs = true;
    draft.el = makeEditor(draft, {
      suggest: () => {
        const span = rowsOf(draft), f = byName.get(draft.path);
        return span && f.rows.slice(span[0], span[1] + 1).every((r) => r.t !== 'd') ? originalOf(draft) : null;
      },
      onSave: () => saveDraft(),
      onCancel: () => { editing = null; redrawRec(recOfSid(s.sid)); },
    });
    draft.el.querySelector('.eloc').textContent = locLabel(draft);
    editing = draft;
    if (prev && prev.inRecs) redrawRec(recOfSid(prev.sid));
    else if (prev) renderFile(byName.get(prev.path));
    redrawRec(recOfSid(s.sid));
    editing.el.querySelector('textarea').focus();
  }
  // Open the diff at the lines a suggested comment sits on.
  function showInDiff(s) {
    const f = byName.get(s.path);
    if (!f) return;
    history.pushState(null, '', '#f' + f.i);
    setView();
    goToFile(f);
    const span = rowsOf(s), tr = span && f.trOf[span[1]];
    if (!tr) return;
    window.scrollTo(0, tr.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3);
    const cells = [];
    for (let i = span[0]; i <= span[1]; i++) cells.push(...(f.cellsOf[i] || []));
    cells.forEach((td) => td.classList.add('goflash'));
    setTimeout(() => cells.forEach((td) => td.classList.remove('goflash')), 1600);
  }
  rv.addEventListener('input', onCheckNote);
  rv.addEventListener('click', (e) => {
    const chk = e.target.closest('[data-chk]');
    if (chk) { onCheck(chk, rv); return; }
    const go = e.target.closest('[data-go]');
    if (go) {
      const s = suggestions.find((x) => x.sid === go.dataset.go);
      if (s) { e.preventDefault(); showInDiff(s); }
      return;
    }
    const rc = e.target.closest('[data-rc]');
    if (rc) {
      const s = suggestions.find((x) => x.sid === rc.dataset.sid), act = rc.dataset.rc;
      if (!s) return;
      if (act === 'edit') { editInRecs(s); return; }
      delete state.autoYes[(recOfSid(s.sid) || {}).rid];
      state.dismissed = state.dismissed.filter((x) => x !== s.sid);
      if (act === 'accept') { if (!accepted(s.sid)) state.comments.push(commentFrom(s)); }
      else if (act === 'dismiss' || act === 'remove') { state.comments = state.comments.filter((c) => c.sid !== s.sid); state.dismissed.push(s.sid); }
      save();
      renderFile(byName.get(s.path));
      render();
      redrawRec(recOfSid(s.sid));
      return;
    }
    const fl = e.target.closest('[data-flow]');
    if (fl) { stepFlow(+fl.dataset.flow); return; }
    const at = e.target.closest('[data-at]');
    if (at) { moveTo(pos.g, +at.dataset.at); return; }
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    const r = recs.find((x) => x.rid === b.closest('.rec').dataset.rid);
    if (r) decideAndAdvance(r, b.dataset.rec);
  });

  // --- the submit view ----------------------------------------------------
  // The last step is for writing the final message and sending it. What still needs the reviewer
  // sits in one strip at the top; the summary editor's preview shows the whole review as it will be
  // posted; one button per verdict submits it. The comments, recommendations and checks behind it
  // are folded underneath, with their counts showing.
  const sv = $('submitview');
  const SHIPIT = ':shipit:';
  // GitHub refuses Approve and Request changes from a PR's own author.
  const ownPr = !!(PR && PR.viewer && PR.author && PR.viewer === PR.author);
  const VERDICTS = [
    { ev: 'REQUEST_CHANGES', label: 'Request changes', cls: 'danger', tip: 'Feedback that must be addressed before merging' },
    { ev: 'COMMENT', label: 'Comment', cls: '', tip: 'Feedback without approving' },
    { ev: 'APPROVE', label: 'Approve', cls: 'primary', tip: 'Approve merging these changes' },
    { ev: 'APPROVE', shipit: true, label: 'Ship it', cls: 'primary shipit',
      tip: 'Approve, with ' + SHIPIT + ' added to the summary' },
  ];
  sv.innerHTML =
    '<div class="svhead"><div><h2>Finish your review</h2><div class="svtarget" id="svtarget"></div></div></div>' +
    '<div class="svready" id="svready"></div>' +
    '<div class="svblock svcompose"><div id="svbody"></div><div class="svposts" id="svposts"></div><div class="svsev" id="svsev"></div>' +
    (PR ? '<div class="svverdicts">' + VERDICTS.map((v, i) => '<button type="button" class="' + v.cls + '" data-verdict="' + i + '" title="' +
      esc(v.tip) + '">' + v.label + '</button>').join('') + '</div>'
      : '<div class="svverdicts"><button type="button" class="primary" id="svmd2">Copy review as Markdown</button></div>') +
    '<div class="svnote" id="svhelp"></div><div class="svstatus" id="svstatus"></div></div>' +
    '<details class="svfold" id="svcomments"><summary id="svcount"></summary><div id="svlist"></div></details>' +
    '<details class="svfold" id="svrecblock"><summary id="svrecsum"></summary><div id="svrec"></div></details>' +
    '<details class="svfold" id="svchkblock"><summary id="svchksum"></summary><div id="svchk"></div></details>' +
    '<details class="svfold" id="svautoblock"><summary id="svautosum"></summary><ul class="svauto" id="svauto"></ul></details>' +
    '<div class="svexport"><span class="svexlbl">Export</span>' +
    '<button type="button" id="svmd">Copy as Markdown</button><button type="button" id="svjson">Copy as JSON</button></div>';

  // The whole review as GitHub will show it: the summary, then what the page adds to it, then a
  // line on what rides along as line comments. Ship it adds the squirrel.
  const bodyFor = (shipit, refs) => [fullBody(refs), shipit ? SHIPIT : ''].filter(Boolean).join('\n\n');
  function fullPreview() {
    const body = bodyFor(false), n = state.comments.length;
    const nr = state.comments.filter((c) => c.subject === 'reply').length;
    const extra = MD.render(body, { attachments: attMap(state.bodyAttachments) });
    return (extra || '<p class="svnote">No summary. ' + (n ? 'The review is its comments.' : 'Approve is the only verdict that can post with nothing written.') + '</p>') +
      (n ? '<p class="svprevmore">Plus ' + [n - nr ? plural(n - nr, 'line comment') : '', nr ? plural(nr, 'reply', 'replies') : ''].filter(Boolean).join(' and ') +
        ', posted on their lines. <a href="#" data-open="svcomments">See them</a></p>' : '');
  }

  let bodyDraft;
  const mountBody = () => {
    bodyDraft = { get body() { return state.body; }, set body(v) { state.body = v; }, attachments: state.bodyAttachments };
    $('svbody').innerHTML = '';
    $('svbody').appendChild(makeEditor(bodyDraft, {
      inline: true, placeholder: 'Your overall message (optional). Markdown supported.',
      previewLabel: 'Preview the full review', preview: fullPreview,
      onInput: () => { state.bodyAttachments = bodyDraft.attachments; save(); refreshSubmit(); },
    }));
  };
  mountBody();
  sv.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); const d = $(o.dataset.open); if (d) { d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } return; }
    const v = e.target.closest('[data-verdict]');
    if (v && !v.disabled) submitAs(VERDICTS[+v.dataset.verdict], v);
  });

  const sortKey = (c) => {
    const f = byName.get(c.path), span = rowsOf(c);
    return [f ? f.i : 1e9, c.subject === 'file' ? -1 : span ? span[1] : 1e9];
  };
  const ordered = (list) => list.slice().sort((a, b) => {
    const x = sortKey(a), y = sortKey(b);
    return x[0] - y[0] || x[1] - y[1];
  });
  const snippetHtml = (c) => {
    const span = rowsOf(c), f = byName.get(c.path);
    if (!span) return '';
    return '<div class="snippet"><table>' + f.rows.slice(span[0], span[1] + 1).map((r) => rowHtml(r)).join('') + '</table></div>';
  };
  // What a reply answers: the last comment in its thread.
  const replyingTo = (c) => {
    const t = c.subject === 'reply' && threadById.get(c.thread_id);
    if (!t) return null;
    const last = t.comments[t.comments.length - 1];
    const text = (last.body || '').trim();
    return { author: last.author, excerpt: text.length > 280 ? text.slice(0, 280) + '…' : text };
  };

  function renderSubmit() {
    $('svtarget').innerHTML = PR
      ? 'Posting to <a href="' + esc(PR.url) + '" target="_blank" rel="noopener">' + esc(PR.owner + '/' + PR.repo + '#' + PR.number) +
        '</a>' + (PR.title ? ' &middot; ' + esc(PR.title) : '') + (META.commitId ? ' &middot; at <code>' + esc(META.commitId.slice(0, 10)) + '</code>' : '')
      : 'No pull request linked, so nothing is sent to GitHub. Copy the review as Markdown to hand it to an agent, edit it, or paste it anywhere.';
    const all = ordered(state.comments), pend = ordered(pendingSuggestions());
    const nr = all.filter((c) => c.subject === 'reply').length;
    $('svcount').innerHTML = '<b>Comments</b> <span class="svnote">' + plural(all.length - nr, 'comment') + (nr ? ' · ' + plural(nr, 'reply', 'replies') : '') +
      (pend.length ? ' · ' + plural(pend.length, 'suggestion') + ' waiting for you' : '') + '</span>';
    let html = '', last = null;
    all.concat(pend).forEach((c) => {
      if (c.path !== last) { html += '<div class="svfile">' + esc(c.path) + '</div>'; last = c.path; }
      const card = cardHtml(c, !!(c.sid && !c.id));
      const r = replyingTo(c);
      const quote = r ? '<div class="rquote"><b>' + esc(r.author) + '</b> ' + esc(r.excerpt) + '</div>' : '';
      html += card.replace('<div class="md">', snippetHtml(c) + quote + '<div class="md">');
    });
    $('svlist').innerHTML = html || '<p class="svnote">No comments yet. Click a line number in the diff to comment on it, drag across line numbers to comment on a range, or use a file\'s Comment button.</p>';
    $('svchkblock').classList.toggle('hidden', !checks.length);
    if (checks.length) {
      const open = checks.filter((c) => !checkOf(c).s).length, list = concerns();
      $('svchksum').innerHTML = '<b>Feature checks</b> <span class="svnote">' + esc(checksLabel()) + ' checked</span>';
      $('svchk').innerHTML = '<p class="svnote" style="margin-top:0">' +
        (open ? '<a href="#checks">' + plural(open, 'check') + ' still open</a>. ' : '') +
        (list.length ? 'These concerns are added to the summary:' : 'No concerns raised.') + '</p>' +
        (list.length ? '<ul class="svauto">' + list.map((c) => '<li><span class="md">' + mdHtml(c.text) + '</span>' +
          (checkOf(c).note ? ' <span class="svnote">' + esc(checkOf(c).note) + '</span>' : '') + '</li>').join('') + '</ul>' : '');
    }
    $('svrecblock').classList.toggle('hidden', !recs.length);
    if (recs.length) {
      const open = recs.length - recsDecided(), gen = recs.filter((r) => !r.sids.length && recStatus(r) === 'yes').length;
      const MARK = { yes: '&#10003;', no: '&#10007;', mixed: '&#9680;', open: '&middot;' };
      $('svrecsum').innerHTML = '<b>Recommendations</b> <span class="svnote">' + recsDecided() + ' / ' + recs.length + ' decided</span>';
      $('svrec').innerHTML = '<p class="svnote" style="margin-top:0">' +
        (open ? '<a href="#recs">' + plural(open, 'recommendation') + ' still open</a>. ' : '') +
        (gen ? plural(gen, 'general recommendation') + ' will be added to the summary.' : '') + '</p>' +
        '<ul class="svauto svrecs">' + recs.map((r) => '<li class="' + recStatus(r) + '">' + MARK[recStatus(r)] + ' ' + inlineMd(r.title) +
          (r.sids.length ? ' <span class="svnote">' + plural(r.sids.length, 'comment') + '</span>' : '') + '</li>').join('') + '</ul>';
    }
    const autos = files.filter((f) => f.auto);
    $('svautoblock').classList.toggle('hidden', !autos.length);
    $('svautosum').innerHTML = '<b>Auto-reviewed files</b> <span class="svnote">' + plural(autos.length, 'file') + '</span>';
    $('svauto').innerHTML = autos.map((f) => '<li><code>' + esc(f.name) + '</code> ' + esc(f.auto.summary || '') +
      (f.cb.checked ? ' <span class="svnote">(you also viewed it)</span>' : '') + '</li>').join('');
    // The preview shows the full review, which the decisions above feed; keep an open preview current.
    const pv = sv.querySelector('.editor.previewing .epreview');
    if (pv) pv.innerHTML = fullPreview();
    refreshSubmit();
    if (state.submitted) status('Last submitted ' + new Date(state.submitted.at).toLocaleString() + ': ' + state.submitted.url, 'ok');
  }

  // What still needs the reviewer, as one line of links. Only stale comments stop a submit; the rest
  // are reminders.
  function readiness() {
    const items = [], stale = state.comments.filter(isStale).length;
    const openRecs = recs.length - recsDecided(), openChecks = checks.filter((c) => !checkOf(c).s).length, waiting = pendingSuggestions().length;
    if (PR && PR.ci) items.push(ciCount('fail') ? { bad: 1, html: '<a href="#story">CI ' + esc(ciLabel()) + '</a>' }
      : ciCount('pending') ? { warn: 1, html: '<a href="#story">CI ' + esc(ciLabel()) + '</a>' } : { ok: 1, html: 'CI ' + esc(ciLabel()) });
    if (stale) items.push({ bad: 1, html: '<a href="#" data-open="svcomments">' + plural(stale, 'comment') + ' on changed code</a> (blocks submitting)' });
    if (openRecs) items.push({ warn: 1, html: '<a href="#recs">' + plural(openRecs, 'recommendation') + ' undecided</a>' });
    if (openChecks) items.push({ warn: 1, html: '<a href="#checks">' + plural(openChecks, 'feature check') + ' unchecked</a>' });
    if (waiting) items.push({ warn: 1, html: '<a href="#" data-open="svcomments">' + plural(waiting, 'suggested comment') + ' not in your review</a>' });
    if (concerns().length) items.push({ warn: 1, html: plural(concerns().length, 'concern') + ' in the summary' });
    if (!items.some((i) => i.bad || i.warn)) items.push({ ok: 1, html: 'Everything is decided' });
    return items.map((i) => '<span class="svchip' + (i.bad ? ' bad' : i.warn ? ' warn' : ' ok') + '">' + i.html + '</span>').join('');
  }

  // How much of what is going out blocks merging: the comments of each severity, plus summary-only
  // recommendations said yes to, which count as one each.
  function severityTally() {
    const recOf = new Map(recs.flatMap((r) => r.sids.map((sid) => [sid, r])));
    const n = { blocking: 0, should: 0, nit: 0, question: 0 };
    state.comments.forEach((c) => {
      const r = recOf.get(c.sid);
      if (r && n[r.severity] != null) n[r.severity]++;
      else if (r && r.kind === 'question') n.question++;
    });
    recs.filter((r) => !r.sids.length && recStatus(r) === 'yes').forEach((r) => {
      if (n[r.severity] != null) n[r.severity]++;
      else if (r.kind === 'question') n.question++;
    });
    const LABEL = Object.assign({ question: 'Question' }, SEV);
    const parts = Object.keys(n).filter((k) => n[k]).map((k) => '<span class="sevtag ' + k + '"><b>' + n[k] + '</b> ' + LABEL[k] + '</span>');
    return parts.length ? parts.join('') : '';
  }

  function refreshSubmit() {
    $('svready').innerHTML = readiness();
    const n = state.comments.length, nr = state.comments.filter((c) => c.subject === 'reply').length;
    $('svposts').innerHTML = n || fullBody() ? 'Posts ' + [fullBody() ? 'your summary' : '', n - nr ? plural(n - nr, 'line comment') : '', nr ? plural(nr, 'reply', 'replies') : '']
      .filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : 'Nothing written yet.';
    $('svsev').innerHTML = severityTally();
    if (!PR) { $('svhelp').innerHTML = ''; return; }
    const stale = state.comments.filter(isStale).length;
    // GitHub takes an Approve with nothing else, but a Comment or Request changes needs a summary or a comment.
    const empty = !n && !fullBody();
    sv.querySelectorAll('[data-verdict]').forEach((b) => {
      const v = VERDICTS[+b.dataset.verdict];
      const why = !SERVER ? 'Needs the local server (--serve)' : stale ? 'Some comments sit on code that changed; check them first'
        : ownPr && v.ev !== 'COMMENT' ? 'GitHub doesn\'t let you approve or request changes on your own pull request'
        : empty && v.ev !== 'APPROVE' ? 'Write a summary or add a comment first' : '';
      b.disabled = !!why;
      b.title = why || v.tip;
      if (!b.dataset.confirm) b.classList.toggle('risky', v.ev === 'APPROVE' && !!(PR.ci && ciCount('fail')));
    });
    $('svhelp').innerHTML = !SERVER
      ? 'Submitting needs the local server: rebuild with <code>--serve</code>, or Copy JSON and have the agent run <code>pbpaste | node ~/.claude/skills/feature-review/scripts/submit-review.cjs -</code>.'
      : ownPr ? 'This is your own pull request, so only Comment is open.'
      : 'Each button posts everything above as one review. Comments on lines GitHub can\'t anchor to go into the summary instead.';
    if (stale) status(plural(stale, 'comment') + ' sit on files that changed since you wrote them. Check each one, then Edit and save it (or delete it) to submit.', 'err');
    else if ($('svstatus').classList.contains('err')) status('');
  }

  function reviewData(verdict) {
    const ev = verdict ? verdict.ev : state.event, shipit = !!(verdict && verdict.shipit);
    const strip = (a) => ({ id: a.id, name: a.name, type: a.type, data: a.data });
    // Submitting posts the diagrams after the review, so the first comment of each recommendation points at its own.
    const refs = verdict && PR ? diagramRefs() : {}, pointed = new Set();
    const withRefs = (c) => {
      const r = c.sid && recOfSid(c.sid);
      if (!r || !refs[r.rid] || pointed.has(r.rid)) return c.body;
      pointed.add(r.rid);
      return c.body.trimEnd() + '\n\n' + seeDiagrams(refs[r.rid]);
    };
    const comments = ordered(state.comments).map((c) => {
      const span = rowsOf(c), f = byName.get(c.path);
      const t = c.subject === 'reply' ? threadById.get(c.thread_id) : null;
      const line = c.subject === 'file' ? undefined : c.subject === 'reply' ? (t ? t.line ?? undefined : undefined) : c.line;
      return {
        path: c.path, subject: c.subject, side: c.subject === 'line' ? c.side : undefined, line,
        start_line: c.subject === 'line' ? c.start_line ?? undefined : undefined,
        start_side: c.subject === 'line' && c.start_line != null ? c.start_side : undefined,
        thread_id: c.subject === 'reply' ? c.thread_id : undefined,
        in_reply_to: t ? t.comments[0].id : undefined,
        replying_to: replyingTo(c) || undefined,
        label: locLabel(c),
        body: withRefs(c),
        attachments: (c.attachments || []).map(strip),
        snippet: span ? f.rows.slice(span[0], span[1] + 1).map((r) => SIGN[r.t] + r.text) : [],
      };
    });
    const data = { version: 1, title: META.title, slug: META.slug, range: META.range || null, pr: PR, commit_id: META.commitId || null,
      event: PR ? ev : null, shipit: shipit || undefined, body: bodyFor(shipit, refs), attachments: (state.bodyAttachments || []).map(strip), comments,
      feature_checks: checks.map((c) => ({ text: c.text, status: checkOf(c).s || 'open', note: checkOf(c).note || undefined })),
      recommendations: recs.map((r) => ({ id: r.rid, title: r.title, kind: r.kind || null, severity: r.severity || null, status: recStatus(r), comments: r.sids.length,
        principle: r.principle && r.principle.name ? { name: r.principle.name, guide: r.principle.guide || null } : null,
        from_concern: !!state.autoYes[r.rid] || undefined })),
      auto_reviewed: files.filter((f) => f.auto).map((f) => ({ path: f.name, summary: f.auto.summary || '' })) };
    data.markdown = toMarkdown(data);
    return data;
  }

  function toMarkdown(d) {
    const VERDICT = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' };
    const out = ['# Review: ' + d.title, ''];
    if (d.pr) out.push('PR: ' + d.pr.url + (d.commit_id ? ' at `' + d.commit_id.slice(0, 10) + '`' : ''), 'Verdict: ' + VERDICT[d.event], '');
    else if (d.range) out.push('Range: `' + d.range + '`', '');
    if (d.body.trim()) out.push('## Summary', '', d.body.trim(), '');
    if (d.comments.length) out.push('## Comments', '');
    d.comments.forEach((c) => {
      out.push('### `' + c.path + '` · ' + c.label, '');
      if (c.snippet.length) out.push('```diff', ...c.snippet, '```', '');
      if (c.replying_to) out.push('> **' + c.replying_to.author + ':** ' + c.replying_to.excerpt.replace(/\n/g, '\n> '), '');
      out.push(c.body.trim(), '');
    });
    if (d.recommendations.length) {
      out.push('## Recommendations', '');
      d.recommendations.forEach((r) => out.push('- [' + r.status + '] ' + r.title + (r.comments ? ' (' + plural(r.comments, 'comment') + ')' : '')));
      out.push('');
    }
    if (d.auto_reviewed.length) {
      out.push('## Auto-reviewed files', '');
      d.auto_reviewed.forEach((a) => out.push('- `' + a.path + '`' + (a.summary ? ': ' + a.summary : '')));
      out.push('');
    }
    // Attachments are inlined as data in the JSON; in Markdown they stay as
    // attachment:<id> links, which serve-review.cjs rewrites to saved file paths.
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  const status = (msg, kind) => { const el = $('svstatus'); el.textContent = msg; el.className = 'svstatus' + (kind ? ' ' + kind : ''); };
  let flashTimer = null;
  function flash(msg, err) {
    if (document.body.classList.contains('submitting')) { status(msg, err ? 'err' : ''); return; }
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    clearTimeout(flashTimer);
    el.textContent = msg; el.className = 'show' + (err ? ' err' : '');
    flashTimer = setTimeout(() => { el.className = ''; }, 3500);
  }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    status('Copied ' + what + ' to the clipboard.', 'ok');
  }
  async function post(path, review) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': SERVER.token },
      body: JSON.stringify(review) });
    const json = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
    if (!res.ok || json.error) throw new Error(json.error || 'HTTP ' + res.status);
    return json;
  }

  $('svmd').onclick = () => copy(reviewData().markdown, 'the review as Markdown');
  $('svjson').onclick = () => copy(JSON.stringify(reviewData(), null, 2), 'the review JSON');
  if ($('svmd2')) $('svmd2').onclick = () => $('svmd').click();
  // Approving a red build takes a second click on the same button, which says why.
  async function submitAs(v, btn) {
    if (v.ev === 'APPROVE' && PR.ci && ciCount('fail') && btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.dataset.label = btn.innerHTML;
      btn.innerHTML = 'CI is failing. ' + (v.shipit ? 'Ship it' : 'Approve') + ' anyway?';
      setTimeout(() => { if (btn.dataset.confirm === '1') { btn.innerHTML = btn.dataset.label; delete btn.dataset.confirm; } }, 5000);
      return;
    }
    delete btn.dataset.confirm;
    const all = sv.querySelectorAll('[data-verdict]');
    all.forEach((b) => { b.disabled = true; });
    status('Submitting…');
    try {
      state.event = v.ev;
      const data = reviewData(v);
      if (diagramList().length) { status('Drawing diagrams…'); data.diagrams = await diagramPngs(); status('Submitting…'); }
      const r = await post('/api/submit', data);
      const nr = data.comments.filter((c) => c.subject === 'reply').length;
      state.submitted = { url: r.url, at: Date.now(), event: data.event, shipit: !!v.shipit, comments: data.comments.length - nr, replies: nr, notes: r.notes || [] };
      state.comments = []; state.body = ''; state.bodyAttachments = []; state.checks = {}; state.recs = {}; state.autoYes = {};
      save();
      mountBody();
      files.forEach(renderFile);
      render();
      // Leave the review behind: the server has exited, so there is nothing more to do on it.
      history.replaceState(null, '', location.pathname + location.search + '#done');
      setView();
    } catch (e) {
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
      refreshSubmit();
      status(e.message, 'err');
    }
  }
  // Diagrams on the recommendations going out (said yes to, or partly) are posted as images in one
  // comment after the review. Each is drawn off screen with the page's own styles, then rasterized.
  const diagramList = () => recs.filter((r) => ['yes', 'mixed'].includes(recStatus(r)))
    .flatMap((r) => (r.visuals || []).filter((d) => d && d.kind !== 'video').map((d) => ({ rid: r.rid, rec: r.title, d })));
  // Diagrams are numbered in the order they are posted: "Diagram 2: …" in the diagrams comment, "See diagram 2" where it belongs.
  const diagramRefs = () => diagramList().reduce((m, x, i) => Object.assign(m, { [x.rid]: (m[x.rid] || []).concat(i + 1) }), {});
  const seeDiagrams = (ns) => 'See diagram' + (ns.length > 1 ? 's ' + ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1] : ' ' + ns[0]) + ' below.';
  const nextFrame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  async function rasterize(src, w, h) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = 2, c = document.createElement('canvas');
    c.width = Math.ceil((w || img.naturalWidth) * k); c.height = Math.ceil((h || img.naturalHeight) * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0, w || img.naturalWidth, h || img.naturalHeight);
    return c.toDataURL('image/png');
  }
  async function diagramPng(d) {
    if (d.kind === 'image') return /^data:image\/png;/.test(d.data || '') ? d.data : d.data ? rasterize(d.data) : null;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:880px;padding:16px;background:var(--panel)';
    host.appendChild(DIAG.render(d, mdHtml));
    document.body.appendChild(host);
    try {
      await nextFrame();
      const box = host.getBoundingClientRect(), w = Math.ceil(box.width), h = Math.ceil(box.height);
      // A clone loses shadow roots, so a raw diagram's markup is copied in as plain children.
      const clone = host.cloneNode(true), shadows = Array.from(host.querySelectorAll('.draw')), copies = Array.from(clone.querySelectorAll('.draw'));
      shadows.forEach((el, i) => { if (el.shadowRoot && copies[i]) copies[i].innerHTML = el.shadowRoot.innerHTML; });
      clone.querySelectorAll('.dexpand').forEach((b) => b.remove());
      clone.style.cssText = 'width:' + w + 'px;padding:16px;box-sizing:border-box';
      const css = Array.from(document.querySelectorAll('style')).map((x) => x.textContent).join('\n');
      const cs = getComputedStyle(document.documentElement);
      const vars = Array.from(new Set(css.match(/--[\w-]+(?=\s*:)/g) || [])).map((v) => v + ':' + cs.getPropertyValue(v)).join(';');
      const wrap = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + esc(vars) + ';background:var(--panel);color:var(--text);' +
        'font:14px -apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif"><style><![CDATA[' + css + ']]></style>' +
        new XMLSerializer().serializeToString(clone) + '</div>';
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="100%" height="100%">' +
        wrap + '</foreignObject></svg>';
      return await rasterize('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), w, h);
    } finally { host.remove(); }
  }
  async function diagramPngs() {
    const out = [];
    for (const [i, { rec, d }] of diagramList().entries()) {
      try {
        const data = await diagramPng(d);
        if (data) out.push({ rec, n: i + 1, alt: d.title || rec, data });
      } catch (e) { console.warn('could not draw diagram', d.title || rec, e); }
    }
    return out;
  }

  // With the server up, ask it what GitHub will do before the reviewer commits to it.
  async function precheck() {
    if (!SERVER || !PR || !state.comments.length) return;
    try {
      const r = await post('/api/check', Object.assign(reviewData(), { diagrams: diagramList().map((x) => ({ rec: x.rec })) }));
      if (r.notes && r.notes.length) status(r.notes.join('\n'));
    } catch (e) { status(e.message, 'err'); }
  }

  // --- the "submitted" page -----------------------------------------------
  function renderDone() {
    const s = state.submitted;
    if (!s) return false;
    const VERDICT = { COMMENT: 'Commented', APPROVE: 'Approved', REQUEST_CHANGES: 'Requested changes' };
    const what = [s.comments ? plural(s.comments, 'comment') : '', s.replies ? plural(s.replies, 'reply', 'replies') : ''].filter(Boolean).join(' and ');
    $('doneview').innerHTML = '<div class="donebox"><div class="donecheck">' + (s.shipit ? '<span class="squirrel">&#x1F43F;&#xFE0F;</span>' : '&#10003;') +
      '</div><h2>' + (s.shipit ? 'Shipped it' : 'Review submitted') + '</h2>' +
      '<p>' + esc(VERDICT[s.event] || 'Reviewed') + (PR ? ' on <a href="' + esc(PR.url) + '" target="_blank" rel="noopener">' +
        esc(PR.owner + '/' + PR.repo + '#' + PR.number) + '</a>' : '') + (what ? ' with ' + what : '') + ', ' + esc(new Date(s.at).toLocaleString()) + '.</p>' +
      (s.notes && s.notes.length ? '<ul class="donenotes">' + s.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      '<div class="svactions">' + (s.url ? '<a class="btn primary" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the review on GitHub</a>' : '') +
      '<button type="button" id="doneback">Back to the diff</button></div>' +
      '<p class="svnote">You can close this tab.</p></div>';
    $('doneback').onclick = () => { history.pushState(null, '', '#code'); setView(); };
    return true;
  }

  // --- steps, the header rail ---------------------------------------------
  // Understand (story, checks, shape), then review (recommendations, code), then submit. Each step
  // is one view; the rail shows each one's own progress and nothing else. A file or group anchor
  // (#f3, #g1) opens the code there. With no hash, the page reopens on the step you were last on.
  const STEPS = [
    { id: 'story', label: 'Story' },
    { id: 'checks', label: 'Checks', when: () => checks.length > 0 },
    { id: 'shape', label: 'Shape' },
    { id: 'recs', label: 'Recommendations', sep: true },
    { id: 'submit', label: 'Submit', sep: true },
  ].filter((st) => !st.when || st.when());
  const OVERVIEW = ['story', 'checks', 'shape'];
  const STEP_KEY = KEY + ':step';
  const ANCHOR = /^#[fg]\d+$/;
  const ALIAS = { overview: 'story' };
  let mode = 'diff', codeFrom = 'recs';
  const ys = {};
  function railState(id) {
    if (id === 'story') return CI && ciCount('fail') ? { text: 'CI failing', bad: 1 } : {};
    if (id === 'checks') { const n = checks.filter((c) => checkOf(c).s).length; return { text: n + '/' + checks.length, done: n === checks.length, bad: concerns().length > 0 }; }
    if (id === 'recs') return recs.length ? { text: recsDecided() + '/' + recs.length, done: recsDecided() === recs.length } : {};
    if (id === 'submit') return state.comments.length ? { text: String(state.comments.length) } : {};
    return {};
  }
  function renderRail() {
    const v = document.body.dataset.view;
    $('steps').innerHTML = STEPS.map((st, i) => {
      const r = railState(st.id);
      return (st.sep ? '<li class="sep" aria-hidden="true"></li>' : '') + '<li class="' + [st.id === v ? 'on' : '', r.done ? 'done' : '', r.bad ? 'bad' : ''].join(' ') + '">' +
        '<button type="button" data-step="' + st.id + '" title="' + st.label + ' (' + (i + 1) + ')"><span class="rn">' + (i + 1) + '</span>' +
        '<span class="rl">' + st.label + '</span>' + (r.text ? '<span class="rs">' + esc(r.text) + '</span>' : '') + '</button></li>';
    }).join('');
  }
  $('hrepo').innerHTML = PR
    ? '<a href="' + esc(PR.url) + '" target="_blank" rel="noopener">' + esc(PR.owner + '/' + PR.repo) + '</a> <span>#' + PR.number + '</span>' +
      (PR.author ? ' <span>by @' + esc(PR.author) + '</span>' : '') + (META.since ? ' <span class="pillnote">since your last review</span>' : '')
    : esc(META.range || 'Local diff');
  // The file count and line totals sit with the rest of what describes the PR.
  $('hrepo').appendChild($('stats'));

  function setView() {
    const h = location.hash, was = document.body.dataset.view;
    const done = h === '#done' && renderDone();
    const known = (x) => STEPS.some((st) => st.id === x);
    let step = done ? 'done' : ANCHOR.test(h) || h === '#code' ? 'code' : ALIAS[h.slice(1)] || h.slice(1);
    if (step !== 'done' && step !== 'code' && !known(step)) {
      const last = store.get(STEP_KEY);
      step = last === 'code' || known(ALIAS[last] || last) ? ALIAS[last] || last : 'story';
    }
    if (was) ys[was] = window.scrollY;
    if (step !== 'code' && step !== 'done') codeFrom = step;
    $('gocode').innerHTML = step === 'code' ? 'Back to ' + esc((STEPS.find((x) => x.id === codeFrom) || STEPS[0]).label) : 'View code <span class="hpct">' + readPct + '%</span>';
    mode = step === 'recs' ? 'recs' : 'diff';
    document.body.dataset.view = step;
    document.body.classList.toggle('overviewing', OVERVIEW.includes(step));
    document.body.classList.toggle('submitting', step === 'submit');
    document.body.classList.toggle('done', step === 'done');
    document.body.classList.toggle('recs', step === 'recs');
    if (step !== 'done') store.set(STEP_KEY, step);
    if (step === 'submit') { renderSubmit(); precheck(); }
    if (OVERVIEW.includes(step)) renderOverview(step);
    // The first visit always opens on the first group's overview, wherever earlier clicks left the
    // position; after that it comes back to where the reviewer was.
    if (step === 'recs' && !store.get(KEY + ':recsseen')) {
      store.set(KEY + ':recsseen', '1');
      pos = { g: 0, i: 0 };
      store.set(POS_KEY, JSON.stringify(pos));
    }
    if (step === 'recs') renderRecs();
    if (step === 'recs' || step === 'code') syncOutline();
    render();
    if (step !== 'code') { window.scrollTo(0, step === 'recs' && was === 'recs' ? ys.recs || 0 : 0); return; }
    const el = ANCHOR.test(h) && $(h.slice(1));
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hdr.offsetHeight);
    else if (was !== 'code') window.scrollTo(0, ys.code || 0);
  }
  addEventListener('hashchange', setView);
  // How wide the reading columns run, remembered across reviews.
  const WIDTHS = [['Narrow', '880px'], ['Normal', '1120px'], ['Wide', '1440px'], ['Full', '100%']];
  let widthAt = +(store.get('frwidth') ?? 1);
  const setWidth = (i) => {
    widthAt = WIDTHS[i] ? i : 1;
    document.documentElement.style.setProperty('--colw', WIDTHS[widthAt][1]);
    store.set('frwidth', String(widthAt));
    drawSettings();
  };
  // Contrast, remembered the same way: high darkens text, rules, diff washes and syntax colours.
  let contrast = store.get('frcontrast') === 'high' ? 'high' : 'normal';
  const setContrast = (c) => {
    contrast = c === 'high' ? 'high' : 'normal';
    document.documentElement.classList.toggle('hc', contrast === 'high');
    store.set('frcontrast', contrast);
    drawSettings();
  };
  const seg = (attr, opts, on) => '<div class="seg">' + opts.map(([label, v]) =>
    '<button type="button" ' + attr + '="' + v + '" class="' + (v === on ? 'on' : '') + '">' + label + '</button>').join('') + '</div>';
  function drawSettings() {
    $('setpanel').innerHTML = '<div class="setlbl">Page width</div>' + seg('data-width', WIDTHS.map((w, j) => [w[0], String(j)]), String(widthAt)) +
      '<div class="setlbl">Contrast</div>' + seg('data-contrast', [['Normal', 'normal'], ['High', 'high']], contrast);
  }
  setWidth(widthAt);
  setContrast(contrast);
  // In Recommendations the reading column stays centred where every other step puts it, and the
  // sidebar sits in the left gutter beside it. Only when the gutter is too narrow for the sidebar
  // does the column move over to make room, so nothing ever overlaps.
  // The sidebar narrows from its full width to a floor before giving up the gutter.
  const NAV_W = 300, NAV_MIN = 230, NAV_GAP = 40, COL_PAD = 24;
  function placeSidebar() {
    const vw = document.documentElement.clientWidth, w = WIDTHS[widthAt][1];
    const col = w.endsWith('%') ? vw : Math.min(parseInt(w, 10), vw - 2 * COL_PAD);
    const gutter = (vw - col) / 2, navW = Math.min(NAV_W, gutter - NAV_GAP);
    document.body.classList.toggle('gutter', navW >= NAV_MIN);
    document.documentElement.style.setProperty('--navw', navW + 'px');
    document.documentElement.style.setProperty('--navx', Math.max(0, gutter - navW - NAV_GAP) + 'px');
  }
  placeSidebar();
  addEventListener('resize', placeSidebar);
  // The settings panel: a gear in the header opens it; a click elsewhere or Esc closes it.
  const setPanel = (open) => {
    $('setpanel').classList.toggle('hidden', !open);
    $('setbtn').setAttribute('aria-expanded', String(open));
  };
  $('setbtn').onclick = (e) => { e.stopPropagation(); setPanel($('setpanel').classList.contains('hidden')); };
  $('setpanel').addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-width]');
    if (b) { setWidth(+b.dataset.width); placeSidebar(); }
    const c = e.target.closest('[data-contrast]');
    if (c) setContrast(c.dataset.contrast);
  });
  document.addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });
  const goStep = (step) => { if (location.hash === '#' + step) setView(); else location.hash = step; };
  document.addEventListener('click', (e) => {
    // A group link from the story opens the Recommendations at that group's gist.
    const rg = e.target.closest('[data-rg]');
    if (rg) { e.preventDefault(); focusGroup(+rg.dataset.rg); goStep('recs'); return; }
    const b = e.target.closest('[data-step]');
    if (b) { e.preventDefault(); goStep(b.dataset.step); return; }
    const ac = e.target.closest('[data-across]');
    if (ac) { e.preventDefault(); stepAcross(+ac.dataset.across); }
  });
  $('gocode').onclick = () => goStep(document.body.dataset.view === 'code' ? codeFrom : 'code');

  // An expanded diagram fills the window. A drawn one scales through its viewBox (CSS does that); a
  // hand-written one has no viewBox, so it is measured at its natural size and zoomed to fit.
  function fitBig(panel) {
    panel.querySelectorAll('.dbody').forEach((box) => {
      const raw = box.querySelector(':scope > .draw');
      if (!raw) return;
      raw.style.zoom = '';
      const w = raw.scrollWidth, h = raw.scrollHeight;
      if (!w || !h) return;
      raw.style.zoom = String(Math.max(1, Math.min(box.clientWidth / w, box.clientHeight / h, 3)));
    });
  }
  addEventListener('resize', () => { const p = lightbox.querySelector('.lbpanel'); if (p) fitBig(p); });
  // Screenshots open full size, and a click anywhere closes them. A diagram opens from the expand
  // button in its corner, drawn again to fill the window; it closes on the backdrop, x or Esc, so
  // its text can be selected.
  const lightbox = document.createElement('div');
  lightbox.id = 'lightbox'; lightbox.className = 'hidden';
  document.body.appendChild(lightbox);
  // Screenshots and diagrams that sit together (a description's screenshots, a step's visuals, a
  // compare's two sides) open as one gallery: arrows or the side buttons move through it.
  const SCOPE = '.ovthumbs, .ovdesc, .cxvis, .recvis, .rgvis, .ovdiags, .rec, .gist, .ovblock';
  let gallery = [], gi = 0;
  function galleryOf(start) {
    const scope = start.closest(SCOPE) || start.closest('section') || document.body;
    const items = [], hosts = new Set();
    scope.querySelectorAll('.dmedia img, .ovdesc img, .dexpand').forEach((el) => {
      if (el.tagName === 'IMG') { items.push({ img: el }); return; }
      const host = el.closest('.dside') || el.closest('figure.diagram');
      if (host && host.diag && !hosts.has(host) && !host.querySelector('.dmedia img')) { hosts.add(host); items.push({ host, fig: el.closest('figure.diagram') }); }
    });
    return items;
  }
  function showItem(i) {
    gi = (i + gallery.length) % gallery.length;
    const it = gallery[gi], nav = gallery.length > 1 ? '<button type="button" class="lbnav prev" title="Previous (←)">&#8249;</button>' +
      '<button type="button" class="lbnav next" title="Next (→)">&#8250;</button><div class="lbcount">' + (gi + 1) + ' / ' + gallery.length + '</div>' : '';
    if (it.img) {
      lightbox.className = '';
      lightbox.innerHTML = nav;
      // A marked screenshot opens with its marks.
      const stage = it.img.closest('.dstage');
      lightbox.prepend(stage ? stage.cloneNode(true) : it.img.cloneNode());
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'lbpanel';
    panel.innerHTML = '<button type="button" class="lbclose" title="Close (Esc)">&times;</button>';
    panel.appendChild(DIAG.render(it.host.diag, it.fig && it.fig.md, { big: true }));
    lightbox.className = 'lbdiag';
    lightbox.innerHTML = nav;
    lightbox.prepend(panel);
    fitBig(panel);
  }
  // A diagram that builds opens as a walkthrough: breadcrumbs above, previous and next below.
  let walking = null;
  function openWalk(d, n) {
    gallery = [];
    const panel = document.createElement('div');
    panel.className = 'lbpanel';
    panel.innerHTML = '<button type="button" class="lbclose" title="Close (Esc)">&times;</button>';
    walking = DIAG.walk(d, mdHtml, n);
    panel.appendChild(walking);
    lightbox.className = 'lbdiag lbwalk';
    lightbox.innerHTML = '';
    lightbox.appendChild(panel);
    fitBig(panel);
    mini.sync();
  }
  const openGallery = (el, match) => {
    gallery = galleryOf(el);
    const at = gallery.findIndex(match);
    showItem(at === -1 ? 0 : at);
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const nb = e.target.closest('.lbnav');
    if (nb) { e.stopPropagation(); showItem(gi + (nb.classList.contains('next') ? 1 : -1)); return; }
    const img = e.target.closest('.dmedia img, .ovdesc img'), ex = e.target.closest('.dexpand');
    if (img && !img.closest('#lightbox')) openGallery(img, (x) => x.img === img);
    else if (ex && !ex.closest('#lightbox')) {
      const host = ex.closest('.dside') || ex.closest('figure.diagram');
      if (!host || !host.diag) return;
      e.stopPropagation();
      if (DIAG.isStaged(host.diag) && DIAG.stagesOf(host.diag).length) openWalk(host.diag, +(host.dataset.at || 0));
      else openGallery(ex, (x) => x.host === host);
    } else if (e.target.closest('#lightbox') && (!lightbox.classList.contains('lbdiag') || e.target === lightbox || e.target.closest('.lbclose'))) {
      lightbox.className = 'hidden';
      mini.sync();
    }
  });

  // Hovering a box or a line traces it (DIAG.trace): what it connects to lights up, the rest quiets.
  document.addEventListener('pointerover', (e) => {
    const svg = e.target.closest && e.target.closest('.dsvg');
    if (!svg) return;
    const n = e.target.closest('.dn[data-id]'), l = !n && e.target.closest('[data-from]');
    DIAG.trace(svg, n ? { id: n.dataset.id } : l ? { from: l.dataset.from, to: l.dataset.to, label: (l.dataset.el || '').split(': ').slice(1).join(': ') } : null);
  });
  document.addEventListener('pointerout', (e) => {
    const svg = e.target.closest && e.target.closest('.dsvg');
    if (svg && !(e.relatedTarget && svg.contains(e.relatedTarget))) DIAG.trace(svg, null);
  });

  files.forEach(renderFile);
  render();
  setView();

  $('reset').onclick = () => {
    files.forEach((f) => { f.cb.checked = false; f.el.classList.remove('viewed', 'peek'); });
    viewed = {}; saveViewed(); render();
  };
  $('expand').onclick = () => document.querySelectorAll('.file').forEach((e) => e.classList.remove('collapsed'));
  $('collapse').onclick = () => document.querySelectorAll('.file').forEach((e) => e.classList.add('collapsed'));
  function applyFilter() {
    const q = $('q').value.toLowerCase();
    files.forEach((f) => {
      const hide = (!!q && !f.name.toLowerCase().includes(q)) || (sinceOnly && !f.since);
      f.el.classList.toggle('hidden', hide);
      f.navEl.classList.toggle('hidden', hide);
    });
    // A group header follows its children, or it strands over an empty list.
    sections.forEach((g) => {
      if (!g.title) return;
      const none = g.files.every((f) => f.el.classList.contains('hidden'));
      g.mainEl.classList.toggle('hidden', none);
      g.navEl.classList.toggle('hidden', none);
    });
  }
  $('q').addEventListener('input', applyFilter);

  const hlBtn = $('hltoggle');
  const setHl = (on) => {
    document.body.classList.toggle('nohl', !on);
    hlBtn.textContent = 'Syntax highlighting: ' + (on ? 'on' : 'off');
    store.set('diffsyntax', on ? '1' : '0');
  };
  setHl(store.get('diffsyntax') !== '0');
  hlBtn.onclick = () => setHl(document.body.classList.contains('nohl'));

  // Rebuilding every table moves things around; keep the file you're in where it was.
  const currentFile = () => {
    const vis = fileOrder.filter((f) => !f.el.classList.contains('hidden'));
    let cur = vis[0] || null;
    for (const f of vis) { if (f.el.getBoundingClientRect().top <= hdr.offsetHeight + 2) cur = f; else break; }
    return cur;
  };
  const rebuildAll = () => {
    const f = currentFile(), top = f ? f.el.getBoundingClientRect().top : 0;
    files.forEach((x) => { buildTable(x); renderFile(x); });
    if (f) window.scrollBy(0, f.el.getBoundingClientRect().top - top);
  };
  const wsBtn = $('wstoggle'), splitBtn = $('splittoggle');
  const showWsLabel = () => { wsBtn.textContent = 'Whitespace: ' + (hideWs ? 'hidden' : 'shown'); };
  if (!WS) { wsBtn.disabled = true; wsBtn.title = 'Needs a page built from git (not --stdin)'; }
  else if (!Object.keys(WS).length) { wsBtn.disabled = true; wsBtn.title = 'No whitespace-only changes in this diff'; }
  const setWs = (on) => { if (wsBtn.disabled) return; hideWs = on; store.set('diffhidews', on ? '1' : '0'); showWsLabel(); rebuildAll(); };
  const setSplit = (on) => { split = on; store.set('diffsplit', on ? '1' : '0'); splitBtn.textContent = 'View: ' + (on ? 'split' : 'unified'); rebuildAll(); };
  showWsLabel();
  splitBtn.textContent = 'View: ' + (split ? 'split' : 'unified');
  wsBtn.onclick = () => setWs(!hideWs);
  splitBtn.onclick = () => setSplit(!split);

  // --- keyboard -------------------------------------------------------------
  const KEYS = [['v', 'Toggle Viewed on the current file'], ['x', 'Collapse or expand the current file'],
    ['n / p', 'Next / previous comment or thread'], ['/', 'Filter files'], ['s', 'Split or unified view'],
    ['w', 'Show or hide whitespace changes'], ['a / i', 'Add or ignore the recommendation in view'], ['j / k', 'Next / previous, through every step and each recommendation (also → / ←); files in Code'], ['c', 'Open the code, or go back to where you were'], ['1 – ' + STEPS.length, STEPS.map((x) => x.label).join(', ')], ['← / →', 'Previous / next image or diagram, when one is open'], ['?', 'This help'], ['Esc', 'Close this help']];
  const help = document.createElement('div');
  help.id = 'keyhelp'; help.className = 'hidden';
  help.innerHTML = '<div class="kbox"><h3>Keyboard shortcuts</h3><table>' +
    KEYS.map((k) => '<tr><td>' + k[0].split(' / ').map((x) => '<kbd>' + esc(x) + '</kbd>').join(' / ') + '</td><td>' + esc(k[1]) + '</td></tr>').join('') +
    '</table><p class="svnote">In Code, j / k move between files, and the current file is the one whose header is pinned under the toolbar.</p></div>';
  document.body.appendChild(help);
  const toggleKeys = (on) => help.classList.toggle('hidden', on === undefined ? !help.classList.contains('hidden') : !on);
  help.addEventListener('click', (e) => { if (e.target === help) toggleKeys(false); });
  $('keys').onclick = () => toggleKeys();

  const scrollToEl = (el, pad) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hdr.offsetHeight - (pad || 0));
  const markCur = (f) => files.forEach((x) => x.el.classList.toggle('cur', x === f));
  // Offsets are from the toolbar's bottom edge, where a file sits right after a jump. Within a few
  // pixels of it counts as "here", so k from the top of a file goes to the previous one, and k from
  // partway down a file goes back to its top.
  function stepFile(dir) {
    const vis = fileOrder.filter((f) => !f.el.classList.contains('hidden'));
    const off = (x) => x.el.getBoundingClientRect().top - hdr.offsetHeight;
    const f = dir > 0 ? vis.find((x) => off(x) > 4) : vis.filter((x) => off(x) < -4).pop();
    if (f) { scrollToEl(f.el); markCur(f); }
  }
  // Comments and threads in files that are open; a reply card inside a thread moves with its thread.
  function stepComment(dir) {
    const pad = 48, line = hdr.offsetHeight + pad;
    const els = Array.from(main.querySelectorAll('.card, .thread, .editor'))
      .filter((el) => el.offsetParent !== null && !(el.parentElement && el.parentElement.closest('.thread, .editor')));
    const el = dir > 0 ? els.find((x) => x.getBoundingClientRect().top > line + 1)
      : els.filter((x) => x.getBoundingClientRect().top < line - 1).pop();
    if (!el) { flash(dir > 0 ? 'No more comments below.' : 'No more comments above.'); return; }
    scrollToEl(el, pad);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 900);
  }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape' && t.id === 'q') t.blur();
      return;
    }
    if (e.key === '?') { toggleKeys(); e.preventDefault(); return; }
    if (e.key === 'Escape') { toggleKeys(false); lightbox.className = 'hidden'; mini.sync(); return; }
    if (lightbox.classList.contains('lbwalk') && walking && ['ArrowLeft', 'ArrowRight', 'j', 'k'].includes(e.key)) {
      walking.step(e.key === 'ArrowRight' || e.key === 'j' ? 1 : -1); e.preventDefault(); return;
    }
    if (!lightbox.classList.contains('hidden') && gallery.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      showItem(gi + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault(); return;
    }
    if (/^[1-9]$/.test(e.key) && STEPS[+e.key - 1]) { goStep(STEPS[+e.key - 1].id); e.preventDefault(); return; }
    const k = e.key, view = document.body.dataset.view;
    if (view === 'recs') {
      const it = curItem();
      if (k === 'j' || k === 'ArrowRight') stepFlow(1);
      else if (k === 'k' || k === 'ArrowLeft') stepFlow(-1);
      // a / i, with y / n kept for hands that learned them.
      else if ('aiyn'.includes(k) && k.length === 1 && it && it !== 'gist') decideAndAdvance(it, k === 'a' || k === 'y' ? 'yes' : 'no');
      else if (k === 'r' || k === 'c') goStep('code');
      else return;
      e.preventDefault();
      return;
    }
    if (k === 'c' && view !== 'code') { goStep('code'); e.preventDefault(); return; }
    if (view !== 'code' && ['j', 'k', 'ArrowRight', 'ArrowLeft'].includes(k)) { stepAcross(k === 'j' || k === 'ArrowRight' ? 1 : -1); e.preventDefault(); return; }
    if (view !== 'code') return;
    if (k === 'r' || k === 'c') { goStep(codeFrom); e.preventDefault(); return; }
    if (k === 'j') stepFile(1);
    else if (k === 'k') stepFile(-1);
    else if (k === 'n') stepComment(1);
    else if (k === 'p') stepComment(-1);
    else if (k === 'v' || k === 'x') {
      const f = currentFile();
      if (!f) return;
      markCur(f);
      if (k === 'v') { f.cb.checked = !f.cb.checked; f.cb.dispatchEvent(new Event('change')); }
      else f.el.querySelector('.fhead').click();
    }
    else if (k === '/') $('q').focus();
    else if (k === 's') setSplit(!split);
    else if (k === 'w') setWs(!hideWs);
    else return;
    e.preventDefault();
  });

  const setHH = () => document.documentElement.style.setProperty('--hh', hdr.offsetHeight + 'px');
  // The header changes height when step switches show or hide the diff-only buttons, not just on window resize.
  setHH(); new ResizeObserver(setHH).observe(hdr);
})();
