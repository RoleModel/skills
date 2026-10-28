/**
 * The review page. build-review.cjs inlines this after diff-parse, highlight,
 * markdown and diagrams, alongside JSON islands: #diff-src (the raw diff),
 * #ws-src (the whitespace-insensitive diff for the files where it differs),
 * #threads-src (the PR's existing review threads), #guide-src (overview,
 * reading guide, auto-reviewed files, suggested comments) and #meta-src (title,
 * slug, PR, commit, file blobs and sizes, last review).
 *
 * The review runs in three steps, one view each: Overview (#overview: the
 * feature and the shape of the change, with diagrams), Code (#code, or a file
 * or group anchor) and Submit (#submit), then #done once posted. The code step
 * has two modes: Recommendations (the default: each reading-guide group as a
 * short gist with its visuals, and the agent's recommendations to say yes or no
 * to) and Code (the diff). #server-src is null from file:// and carries a token
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
  const orphanNote = (c) => {
    if (isStale(c)) return ' &middot; the file changed since you wrote this: check the line, then Edit and save to keep it';
    if (c.subject !== 'line' || rowsOf(c)) return '';
    const f = byName.get(c.path);
    if (hideWs && f && f.fullAt[c.side || 'RIGHT'].has(c.line)) return ' &middot; hidden with whitespace changes';
    return c.tid ? (threadsInline ? '' : ' &middot; at the PR head') : ' &middot; not in this diff';
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
    const k = TYPE[r.t], d = i != null && r.t !== 'x' ? ' data-r="' + i + '"' : '';
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
    const k = TYPE[r.t], d = r.t !== 'x' ? ' data-r="' + i + '"' : '';
    return '<td class="n ' + k + '"' + d + '>' + ((left ? r.n1 : r.n2) ?? '') + '</td><td class="c ' + k + '"' + d + '>' + codeHtml(r) + '</td>';
  };

  function buildTable(f) {
    f.rows = compose(f);
    f.rowAt = { RIGHT: new Map(), LEFT: new Map() };
    f.rows.forEach((r, i) => {
      if (r.t === 'a' || r.t === 'c') f.rowAt.RIGHT.set(r.n2, i);
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

  const suggestions = (GUIDE.suggestions || []).map((s) =>
    Object.assign({ subject: s.line == null ? 'file' : 'line', side: 'RIGHT' }, s, { sid: 's' + hash(JSON.stringify(s)) }));
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
  const recs = (GUIDE.recommendations || []).map((r) => Object.assign({}, r, {
    rid: r.id, group: sections.some((g) => g.title && g.title === r.group) ? r.group : null,
    sids: suggestions.filter((s) => s.rec === r.id).map((s) => s.sid),
  })).concat(suggestions.filter((s) => !s.rec).map((s) => ({ rid: 'r' + s.sid, title: headline(s.body), why: '', group: groupOf(s.path), sids: [s.sid] })));
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
  const recsMd = () => {
    const list = recs.filter((r) => !r.sids.length && recStatus(r) === 'yes');
    return list.length ? '**Recommendations**\n\n' + list.map((r) => '- ' + oneLine(r.body || r.title + (shownProposal(r) || r.why ? ': ' + (shownProposal(r) || r.why) : '')) +
      (r.principle && r.principle.name ? ' _(' + oneLine(r.principle.name) + (r.principle.title ? ', ' + r.principle.title : '') + ')_' : '')).join('\n') : '';
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
  const fullBody = () => [state.body.trim(), recsMd(), concernsMd()].filter(Boolean).join('\n\n');
  // Diagrams can sit in the overview, in a reading-guide group (shown under its header in the code step), or both.
  const diagrams = (OV && OV.diagrams) || [];
  const diagramsIn = (section) => diagrams.filter((d) => (d.section || (d.group ? null : 'feature')) === section);

  // --- render the diff ----------------------------------------------------
  let tAdd = 0, tDel = 0, idx = 0;
  sections.forEach((g, gi) => {
    if (g.title) {
      const mh = document.createElement('div');
      mh.className = 'ghead'; mh.id = 'g' + gi;
      mh.innerHTML = '<h2><span class="gnum">' + (gi + 1) + '.</span>' + esc(g.title) +
        '<span class="gct"></span></h2>' + (g.why ? '<p class="gwhy">' + esc(g.why) + '</p>' : '');
      diagrams.filter((d) => d.group && d.group === g.title).forEach((d) => {
        const det = document.createElement('details');
        det.className = 'gdiag'; det.open = true;
        det.innerHTML = '<summary>Diagram' + (d.title ? ': ' + esc(d.title) : '') + '</summary>';
        det.appendChild(DIAG.render(Object.assign({}, d, { title: null }), mdHtml));
        mh.appendChild(det);
      });
      main.appendChild(mh);
      const nh = document.createElement('div');
      nh.className = 'ghead';
      nh.innerHTML = '<h2><span class="gnum">' + (gi + 1) + '.</span><a href="#g' + gi + '">' +
        esc(g.title) + '</a><span class="gct"></span></h2>';
      nav.appendChild(nh);
      g.mainEl = mh; g.navEl = nh;
      g.ctEls = [mh.querySelector('.gct'), nh.querySelector('.gct')];
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
        '</span><span class="del">-' + f.del + '</span><button type="button" class="fcbtn" title="Comment on the whole file">Comment</button>' +
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
      nav.appendChild(a);
    });
  });
  $('stats').innerHTML = files.length + ' files &middot; <span class="add">+' + tAdd +
    '</span> <span class="del">-' + tDel + '</span>';

  const tLines = tAdd + tDel;
  const ciRow = () => PR && PR.ci ? '<div class="row' + (ciCount('fail') ? ' ci-fail' : '') + '"><span>CI</span><b><a href="#overview">' + esc(ciLabel()) + '</a></b></div>' : '';
  let sinceOnly = false;
  function render() {
    const covered = (f) => f.cb.checked || !!f.auto;
    const left = files.filter((f) => !covered(f));
    const autoOnly = files.filter((f) => f.auto && !f.cb.checked);
    const lines = (fs) => fs.reduce((s, f) => s + f.add + f.del, 0);
    const lAdd = left.reduce((s, f) => s + f.add, 0), lDel = left.reduce((s, f) => s + f.del, 0);
    const lLines = lAdd + lDel, seen = tLines - lLines, aLines = lines(autoOnly);
    const pct = tLines ? Math.round(seen / tLines * 100) : 100;
    const mine = tLines ? (seen - aLines) / tLines * 100 : 100, auto = tLines ? aLines / tLines * 100 : 0;
    files.forEach((f) => {
      f.navEl.classList.toggle('viewed', f.cb.checked);
      f.navEl.classList.toggle('auto', !!f.auto && !f.cb.checked);
    });
    // In the Recommendations mode, progress is decisions, not lines: the reviewer is reading at the
    // height of the groups, and the diff's line count would sit near zero the whole time.
    const byRecs = mode === 'recs' && recs.length > 0;
    sections.forEach((g) => {
      if (!g.title) return;
      const gDone = g.files.filter(covered).length;
      const all = gDone === g.files.length;
      const gr = groupRecs(g), gDecided = gr.filter((r) => recStatus(r) !== 'open').length;
      g.ctEls[0].textContent = (all ? '✓ ' : '') + gDone + ' / ' + g.files.length;
      g.ctEls[1].textContent = !byRecs ? g.ctEls[0].textContent : gr.length ? (gDecided === gr.length ? '✓ ' : '') + gDecided + ' / ' + gr.length : '';
      g.mainEl.classList.toggle('done', all);
      g.navEl.classList.toggle('done', byRecs ? gr.length > 0 && gDecided === gr.length : all);
    });
    const nc = state.comments.length, ns = pendingSuggestions().length;
    const openThreads = threads.filter((t) => !t.resolved).length;
    const lr = META.lastReview, since = META.since;
    const day = (at) => at ? new Date(at).toLocaleDateString() : '';
    let review = '';
    if (since) {
      review = '<hr><div class="row"><span>Showing changes since</span><b>' + esc(since.sha.slice(0, 7)) + (since.at ? ' · ' + day(since.at) : '') + '</b></div>' +
        (since.rebased ? '<div class="row"><span>Rebased since then, so this includes upstream changes</span></div>' : '');
    } else if (lr && lr.changed) {
      review = '<hr><div class="row"><span>Your last review</span><b>' + esc(lr.sha.slice(0, 7)) + ' · ' + day(lr.at) + '</b></div>' +
        (changedSince.size
          ? '<div class="row"><span>Changed since</span><b>' + plural(changedSince.size, 'file') +
            ' <button type="button" data-act="sinceonly">' + (sinceOnly ? 'Show all' : 'Only these') + '</button></b></div>'
          : '<div class="row"><span>Nothing changed since</span></div>');
    }
    if (byRecs) {
      const n = recs.length, by = (st) => recs.filter((r) => recStatus(r) === st);
      const yes = by('yes'), no = by('no'), mixed = by('mixed'), open = by('open'), decided = n - open.length;
      const rPct = Math.round(decided / n * 100), w = (list) => list.length / n * 100;
      const inReview = state.comments.filter((c) => c.sid && recs.some((r) => r.sids.includes(c.sid))).length;
      $('meta').innerHTML =
        '<div class="pctrow"><span class="pct' + (rPct === 100 ? ' done' : '') + '">' + rPct +
        '%</span><span class="pctlbl">recommendations decided</span></div>' +
        '<span class="progress" title="' + decided + ' of ' + n + ' recommendations decided"><i style="width:' + w(yes) +
        '%"></i><i class="mixed" style="width:' + w(mixed) + '%"></i><i class="no" style="width:' + w(no) + '%"></i></span>' +
        '<div class="row"><span>Decided</span><b>' + decided + ' / ' + n + '</b></div>' +
        '<div class="row"><span>Yes</span><b>' + yes.length + (mixed.length ? ' (+' + mixed.length + ' in part)' : '') + '</b></div>' +
        '<div class="row"><span>No</span><b>' + no.length + '</b></div>' +
        '<div class="row"><span>Comments</span><b>' + nc + (inReview ? ' (' + inReview + ' from recommendations)' : '') + '</b></div>' +
        (checks.length ? '<div class="row"><span>Feature checks</span><b><a href="#overview">' + checksLabel() + '</a></b></div>' : '') +
        ciRow() +
        (threads.length ? '<div class="row"><span>Threads</span><b>' + threads.length + (openThreads ? ' (' + openThreads + ' unresolved)' : '') + '</b></div>' : '') +
        review +
        '<hr><div class="row"><span>Code read</span><b><a href="#code" data-mode="diff">' + pct + '% of lines</a></b></div>' +
        (open.length ? '<div class="row"><span>Remaining</span><b>' + plural(open.length, 'recommendation') + '</b></div>'
          : '<div class="row done"><span>&#10003; All recommendations decided</span></div>');
      $('gosubmit').textContent = 'Finish review' + (nc ? ' (' + nc + ')' : '');
      return;
    }
    $('meta').innerHTML =
      '<div class="pctrow"><span class="pct' + (pct === 100 ? ' done' : '') + '">' + pct +
      '%</span><span class="pctlbl">lines reviewed</span></div>' +
      '<span class="progress" title="' + seen + ' of ' + tLines + ' changed lines"><i style="width:' + mine +
      '%"></i><i class="auto" style="width:' + auto + '%"></i></span>' +
      '<div class="row"><span>Lines</span><b>' + seen.toLocaleString() + ' / ' + tLines.toLocaleString() + '</b></div>' +
      '<div class="row"><span>Files</span><b>' + (files.length - left.length) + ' / ' + files.length + '</b></div>' +
      (autoOnly.length ? '<div class="row"><span>Auto-reviewed</span><b>' + plural(autoOnly.length, 'file') + ', ' +
        plural(aLines, 'line') + '</b></div>' : '') +
      '<div class="row"><span>Comments</span><b>' + nc + (ns ? ' (+' + ns + ' suggested)' : '') + '</b></div>' +
      (checks.length ? '<div class="row"><span>Feature checks</span><b><a href="#overview">' + checksLabel() + '</a></b></div>' : '') +
      (recs.length ? '<div class="row"><span>Recommendations</span><b><a href="#code" data-mode="recs">' + recsDecided() + ' / ' + recs.length +
        ' decided</a></b></div>' : '') +
      ciRow() +
      (threads.length ? '<div class="row"><span>Threads</span><b>' + threads.length + (openThreads ? ' (' + openThreads + ' unresolved)' : '') + '</b></div>' : '') +
      review +
      '<hr><div class="row"><span>Total change</span><b><span class="add">+' + tAdd +
      '</span> <span class="del">-' + tDel + '</span></b></div>' +
      (left.length
        ? '<div class="row"><span>Remaining</span><b>' + plural(left.length, 'file') + ', ' + lLines.toLocaleString() +
          ' line' + (lLines === 1 ? '' : 's') + '</b></div>' +
          '<div class="row"><span></span><b><span class="add">+' + lAdd +
          '</span> <span class="del">-' + lDel + '</span></b></div>'
        : '<div class="row done"><span>&#10003; All files reviewed</span></div>');
    $('gosubmit').textContent = 'Finish review' + (nc ? ' (' + nc + ')' : '');
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
      if (td.classList.contains('rx')) flash('Expanded lines are outside the diff, so GitHub can\'t anchor a comment there. Use the file\'s Comment button.');
      return;
    }
    const r = +td.dataset.r;
    if (!'acd'.includes(f.rows[r].t)) return;
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
    const inHunk = (i) => rows[i] && 'acd'.includes(rows[i].t) && rows[i].hunk === rows[drag.start].hunk;
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
      if (editing.inRecs) { goStep('code'); setMode('recs'); }
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

  function cardHtml(c, pending) {
    const tag = c.sid ? '<span class="tag">Suggested</span>' : '';
    const acts = pending
      ? '<button type="button" data-act="accept" data-id="' + c.sid + '">Accept</button>' +
        '<button type="button" data-act="edit-s" data-id="' + c.sid + '">Edit</button>' +
        '<button type="button" data-act="dismiss" data-id="' + c.sid + '">Dismiss</button>'
      : '<button type="button" data-act="edit" data-id="' + c.id + '">Edit</button>' +
        '<button type="button" data-act="delete" data-id="' + c.id + '">Delete</button>';
    const label = c.subject === 'reply' ? 'Your reply' : esc(locLabel(c)) + orphanNote(c);
    return '<div class="card' + (pending ? ' sugg-pending' : '') + '"><div class="chead"><span>' + label +
      '</span>' + tag + (pending ? '<span>not in review yet</span>' : '') + '<span class="sp"></span>' + acts +
      '</div><div class="md">' + renderBody(c) + '</div></div>';
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
  function landsHtml() {
    const m = new Map();
    files.forEach((f) => {
      const k = areaOf(f.name), a = m.get(k) || { k, add: 0, del: 0, n: 0 };
      a.add += f.add; a.del += f.del; a.n++;
      m.set(k, a);
    });
    const rows = Array.from(m.values()).sort((a, b) => b.add + b.del - (a.add + a.del));
    const max = Math.max(1, ...rows.map((r) => r.add + r.del));
    return '<table class="ovbars">' + rows.map((r) => '<tr><td class="ovk"><code>' + esc(r.k) + '</code></td><td class="ovn">' +
      plural(r.n, 'file') + '</td><td class="ovbar"><span><i class="a" style="width:' + (r.add / max * 100) + '%"></i><i class="d" style="width:' +
      (r.del / max * 100) + '%"></i></span></td><td class="ovnum"><span class="add">+' + r.add + '</span> <span class="del">-' + r.del +
      '</span></td></tr>').join('') + '</table>';
  }
  // A file that crosses this many lines in the change gets a badge: a nudge, not a rule.
  const LARGE = 400;
  function sizesHtml() {
    if (!SIZES) return '<p class="svnote">File sizes need a page built from git (not <code>--stdin</code>).</p>';
    const rows = files.map((f) => ({ f, b: (SIZES[f.name] || [])[0], a: (SIZES[f.name] || [])[1] }))
      .filter((r) => r.b != null || r.a != null);
    if (!rows.length) return '<p class="svnote">Only binary files changed.</p>';
    const tb = rows.reduce((s, r) => s + (r.b || 0), 0), ta = rows.reduce((s, r) => s + (r.a || 0), 0);
    const net = (r) => (r.a || 0) - (r.b || 0);
    rows.sort((x, y) => Math.abs(net(y)) - Math.abs(net(x)) || x.f.i - y.f.i);
    const max = Math.max(1, ...rows.map((r) => Math.max(r.a || 0, r.b || 0)));
    const sign = (n) => (n > 0 ? '+' : '') + n.toLocaleString();
    const tr = (r) => '<tr><td>' + fileLink(r.f.name, '<code>' + esc(r.f.name) + '</code>') +
      (r.f.status !== 'modified' ? ' <span class="badge">' + r.f.status + '</span>' : '') +
      ((r.a || 0) > LARGE && (r.b || 0) <= LARGE ? ' <span class="badge stale" title="Crossed ' + LARGE + ' lines in this change">now ' +
        r.a + ' lines</span>' : '') + '</td><td class="ovnum">' + (r.b ?? '–') + ' → ' + (r.a ?? '–') + '</td><td class="ovnum ' +
      (net(r) > 0 ? 'add' : net(r) < 0 ? 'del' : '') + '">' + sign(net(r)) + '</td><td class="ovsize" title="Before (grey) and after (blue), to scale">' +
      '<i class="b" style="width:' + ((r.b || 0) / max * 100) + '%"></i><i class="a" style="width:' + ((r.a || 0) / max * 100) + '%"></i></td></tr>';
    const TOP = 12, head = '<thead><tr><th>File</th><th>Lines</th><th>Net</th><th>Size, before and after</th></tr></thead>';
    const nNew = rows.filter((r) => r.f.status === 'added').length, nGone = rows.filter((r) => r.f.status === 'deleted').length;
    return '<p class="ovtotal">The touched files went from <b>' + tb.toLocaleString() + '</b> to <b>' + ta.toLocaleString() + '</b> lines (' +
      sign(ta - tb) + ')' + (nNew ? ', ' + plural(nNew, 'new file') : '') + (nGone ? ', ' + plural(nGone, 'deleted file') : '') + '.</p>' +
      '<table class="ovsizes">' + head + '<tbody>' + rows.slice(0, TOP).map(tr).join('') + '</tbody></table>' +
      (rows.length > TOP ? '<details class="ovmore"><summary>' + plural(rows.length - TOP, 'more file') + '</summary><table class="ovsizes"><tbody>' +
        rows.slice(TOP).map(tr).join('') + '</tbody></table></details>' : '');
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
        '<button type="button" data-chk="ok" class="' + (k.s === 'ok' ? 'on' : '') + '">&#10003; Looks right</button>' +
        '<button type="button" data-chk="concern" class="' + (k.s === 'concern' ? 'on' : '') + '">! Concern</button></div>' +
        '<div class="chktext md">' + mdHtml(c.text) + '</div>' +
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
  function connectionHtml() {
    if (!CX) return '';
    const step = (st, i) => {
      const mine = (st.checks || []).map((id) => checks.find((c) => c.id === id)).filter(Boolean);
      const links = (st.groups || []).filter((t) => gIndex(t) !== -1).map((t) => '<a class="cxgroup" href="#code" data-mode="recs" data-rg="' + gIndex(t) +
          '"><span class="gnum">' + (gIndex(t) + 1) + '.</span> ' + esc(t) + '</a>').join('') +
        (st.files || []).map((n) => fileLink(n, '<span class="rfile">' + esc(n.split('/').pop()) + '</span>')).join('');
      const vis = (st.visuals || []).length;
      return '<li class="cxstep' + (vis ? '' : ' novis') + '"><div class="cxnum">' + (i + 1) + '</div><div class="cxbody">' +
        (vis ? '<div class="cxvis" data-cxvis="' + i + '"></div>' : '') + '<div class="cxtext"><h4>' + inlineMd(st.title) + '</h4>' +
        (st.user ? '<div class="md cxuser">' + mdHtml(st.user) + '</div>' : '') +
        // The code side stays folded: the step should read as the feature, with the detail on request.
        (st.tech ? '<details class="cxtech"><summary class="cxlbl">Under the hood</summary><div class="md">' + mdHtml(st.tech) + '</div></details>' : '') +
        (links ? '<div class="cxlinks">' + links + '</div>' : '') +
        (mine.length ? '<div class="cxchecks">' + checksHtml(mine) + '</div>' : '') + '</div></div></li>';
    };
    return '<section class="ovblock" id="ov-connection"><h3>Feature overview</h3>' +
      (CX.summary ? '<div class="md">' + mdHtml(CX.summary) + '</div>' : '') + '<div data-diags="connection"></div>' +
      (CX.technical ? '<h4>How it works</h4><div class="md">' + mdHtml(CX.technical) + '</div>' : '') +
      (cxSteps.length ? '<h4>Step by step</h4><ol class="cxsteps">' + cxSteps.map(step).join('') + '</ol>' : '') + '</section>';
  }

  function renderOverview() {
    const fe = (OV && OV.feature) || {}, sh = (OV && OV.shape) || {};
    ovv.innerHTML =
      '<div class="ovhead"><div><div class="ovstep">Step 1 of 3</div><h2>What this change does, and its shape</h2>' +
      '<p class="svnote">Read this before the code: decide whether the feature is right and the change is shaped well. The code is step 2.</p></div>' +
      '<button type="button" class="primary" data-step="code">Start the code review &rarr;</button></div>' +
      ciHtml() + authorHtml() +
      (OV ? '' : '<div class="ovblock"><p class="svnote">No overview was written for this change, so only the computed shape is shown. ' +
        'The agent adds one under <code>overview</code> in the reading guide.</p></div>') +
      (OV && (fe.summary || fe.behavior || checks.length || diagramsIn('feature').length)
        ? '<section class="ovblock" id="ov-feature"><h3>The feature</h3>' + (fe.summary ? '<div class="md">' + mdHtml(fe.summary) + '</div>' : '') +
          (fe.behavior ? '<h4>Behaviour</h4><div class="md">' + mdHtml(fe.behavior) + '</div>' : '') + '<div data-diags="feature"></div>' +
          (checks.length ? '<h4>Feature checks <span class="ovct" id="ovchkct"></span></h4><p class="svnote">Confirm each in the app or by reasoning; ' +
            'a concern and its note go into the review summary.' + (placed.size ? ' ' + (looseChecks.length ? 'More' : 'They') +
            ' sit with their step in <a href="#ov-connection" data-jump="ov-connection">Feature overview</a>.' : '') + '</p>' +
            '<div id="ovchecks">' + checksHtml(looseChecks) + '</div>' : '') + '</section>'
        : '') +
      connectionHtml() +
      '<section class="ovblock" id="ov-shape"><h3>The shape of the change</h3>' + (sh.summary ? '<div class="md">' + mdHtml(sh.summary) + '</div>' : '') +
      '<div data-diags="shape"></div>' + shapeFactsHtml(sh) + departuresHtml(sh) +
      '<h4>Where the change lands</h4>' + landsHtml() +
      '<h4>How the codebase\'s shape moved</h4>' + (sh.codebase ? '<div class="md">' + mdHtml(sh.codebase) + '</div>' : '') + sizesHtml() +
      '</section>' +
      '<div class="ovfoot"><button type="button" class="primary" data-step="code">Start the code review &rarr;</button></div>';
    ['feature', 'connection', 'shape'].forEach((sec) => {
      const slot = ovv.querySelector('[data-diags="' + sec + '"]');
      const list = diagramsIn(sec);
      if (slot && list.length) slot.replaceWith(figures(list));
    });
    cxSteps.forEach((st, i) => {
      const slot = ovv.querySelector('[data-cxvis="' + i + '"]');
      if (slot) (st.visuals || []).forEach((d) => slot.appendChild(DIAG.render(d, mdHtml)));
    });
    const ct = $('ovchkct');
    if (ct) ct.textContent = checksLabel();
  }
  // A check can show in the overview and on a recommendation; both share its state.
  function onCheck(b, root) {
    const kid = b.closest('.chk').dataset.k, cur = state.checks[kid] || {};
    state.checks[kid] = cur.s === b.dataset.chk ? {} : { s: b.dataset.chk, note: cur.note || '' };
    concernDecides(checks.find((c) => c.kid === kid), state.checks[kid].s === 'concern');
    save();
    // Redraw only this check: it may sit inside a step, next to a recording that is playing.
    b.closest('.chk').outerHTML = checksHtml(checks.filter((c) => c.kid === kid));
    if ($('ovchkct')) $('ovchkct').textContent = checksLabel();
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
    if (said.length) flash('Said yes to ' + said.map((t) => '“' + t + '”').join(', ') + '. Change it under Recommendations.');
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
    const btn = (act, label) => '<button type="button" data-rc="' + act + '" data-sid="' + esc(s.sid) + '">' + label + '</button>';
    const acts = st === 'open' ? btn('accept', '&#10003; Accept') + btn('edit', 'Edit') + btn('dismiss', '&#10007; Dismiss')
      : st === 'yes' ? '<span class="tag done">In review</span>' + btn('edit', 'Edit') + btn('remove', 'Remove')
        : '<span class="tag">Dismissed</span>' + btn('restore', 'Restore');
    const mine = editing && editing.inRecs && editing.sid === s.sid;
    return '<div class="recc ' + st + '" data-sid="' + esc(s.sid) + '"><div class="svfile">' + goLink(s, esc(s.path) + ' &middot; ' + esc(locLabel(s))) +
      '<span class="sp"></span>' + (mine ? '' : acts) + '</div>' + snippetHtml(s) +
      (mine ? '<div class="recedit"></div>' : '<div class="md">' + renderBody(c || s) + '</div>') + '</div>';
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
    const what = !n ? { open: 'A yes adds it to your summary', yes: 'In your summary', no: 'Left out' }[st]
      : { open: 'A yes adds ' + plural(n, 'comment') + ' to your review', yes: plural(n, 'comment') + ' in your review', no: 'Left out',
        mixed: inReview + ' of ' + plural(n, 'comment') + ' in your review' }[st];
    const refs = sugs.map((s) => goLink(s, esc(s.path.split('/').pop()) + ':' + refLabel(s), 'rref')).join('');
    const editingHere = editing && editing.inRecs && r.sids.includes(editing.sid);
    const more = n ? '<details class="recmore"' + (editingHere ? ' open' : '') + '><summary>' + (n === 1 ? 'The comment' : 'The ' + n + ' comments') +
      '</summary>' + sugs.map(recCommentHtml).join('') + '</details>' : '';
    const parts = partsHtml(r), mine = (r.checks || []).map((id) => checks.find((c) => c.id === id)).filter(Boolean);
    return '<div class="rec ' + st + '" data-rid="' + esc(r.rid) + '"><div class="rectop"><div class="rectitle">' +
      (r.kind ? '<span class="stag ' + esc(r.kind) + '">' + esc(KIND[r.kind] || r.kind) + '</span> ' : '') + inlineMd(r.title) + '</div>' +
      '<div class="recbtns"><button type="button" data-rec="yes" class="' + (st === 'yes' ? 'on' : '') + '">&#10003; Yes</button>' +
      '<button type="button" data-rec="no" class="' + (st === 'no' ? 'on' : '') + '">&#10007; No</button></div></div>' +
      (parts || (r.why ? '<div class="recwhy md">' + mdHtml(r.why) + '</div>' : '')) +
      principleHtml(r) +
      (state.autoYes[r.rid] && st !== 'open' ? '<div class="recauto">Yes because you raised a concern on its feature check. Change it here if that is not what you meant.</div>' : '') +
      ((r.visuals || []).length ? '<div class="recvis" data-recvis="' + esc(r.rid) + '"></div>' : '') +
      (mine.length ? '<div class="recchecks"><span class="cxlbl">Feature ' + (mine.length === 1 ? 'check' : 'checks') + '</span>' + checksHtml(mine) + '</div>' : '') +
      '<div class="recmeta">' + refs + '<span>' + what + '</span></div>' + more + '</div>';
  }
  function groupCardHtml(g, gi) {
    const mine = groupRecs(g);
    const chips = g.files.map((f) => '<a class="rfile ' + f.status + (f.cb.checked ? ' viewed' : '') + (f.auto ? ' auto' : '') + '" href="#f' + f.i +
      '" title="' + esc(f.name + (f.auto ? ' — auto-reviewed: ' + (f.auto.summary || '') : '')) + '">' + esc(f.name.split('/').pop()) +
      ' <span class="add">+' + f.add + '</span><span class="del">-' + f.del + '</span></a>').join('');
    return '<section class="rgroup" id="rg' + gi + '" data-g="' + gi + '"><div class="rghead">' +
      (g.title ? '<span class="gnum">' + (gi + 1) + '.</span>' : '') + '<h3>' + esc(g.title || 'All files') + '</h3>' +
      '<span class="rgstat"></span><a class="btn" href="#' + (g.title ? 'g' + gi : 'f' + g.files[0].i) + '">Read the code &rarr;</a></div>' +
      (g.why ? '<p class="gwhy">' + esc(g.why) + '</p>' : '') +
      (g.summary ? '<div class="rgsum md">' + mdHtml(g.summary) + '</div>' : '') +
      (g.points.length ? '<ul class="rgpoints">' + g.points.map((p) => '<li class="md">' + inlineMd(p) + '</li>').join('') + '</ul>' : '') +
      '<div data-rgvis="' + gi + '"></div>' +
      // Files stay folded: the gist and the recommendations are what this view is for.
      '<details class="rgfwrap"><summary>' + plural(g.files.length, 'file') + '</summary><div class="rgfiles">' + chips + '</div></details>' +
      (mine.length ? '<div class="rgrecs">' + mine.map(recHtml).join('') + '</div>' : '') + '</section>';
  }
  // A group is done here when every recommendation on it is decided; one with none has nothing to decide.
  function groupStat(el) {
    const g = sections[+el.dataset.g], mine = groupRecs(g), decided = mine.filter((r) => recStatus(r) !== 'open').length;
    const add = g.files.reduce((n, f) => n + f.add, 0), del = g.files.reduce((n, f) => n + f.del, 0);
    el.classList.toggle('done', mine.length > 0 && decided === mine.length);
    el.querySelector('.rgstat').innerHTML = '<span class="add">+' + add + '</span> <span class="del">-' + del + '</span> &middot; ' +
      plural(g.files.length, 'file') + (mine.length ? ' &middot; <b>' + decided + ' / ' + mine.length + '</b> decided' : '');
  }
  const recsCount = () => recs.length ? '<b>' + recsDecided() + ' / ' + recs.length + '</b> recommendations decided' : 'No recommendations';
  function renderRecs() {
    const general = recs.filter((r) => r.group == null);
    rv.innerHTML = '<div class="rhead"><div><div class="ovstep">Step 2 of 3 &middot; Recommendations</div><h2>What changed, group by group</h2>' +
      '<p class="svnote">Say yes or no to each recommendation; a yes puts its comments in your review. Switch to Code (<kbd>r</kbd>) for the diff behind any of it.</p></div>' +
      '<div class="rcount" id="rcount">' + recsCount() + '</div></div><div data-rgvis="top"></div>' +
      (general.length ? '<section class="rgroup rgen"><div class="rghead"><h3>Across the change</h3></div><div class="rgrecs">' +
        general.map(recHtml).join('') + '</div></section>' : '') +
      sections.map(groupCardHtml).join('');
    const slot = (key, list) => {
      const el = rv.querySelector('[data-rgvis="' + key + '"]');
      if (!el) return;
      if (!list.length) { el.remove(); return; }
      const box = document.createElement('div');
      box.className = 'rgvis';
      list.forEach((d) => box.appendChild(DIAG.render(d, mdHtml)));
      el.replaceWith(box);
    };
    rv.querySelectorAll('.rgroup[data-g]').forEach(groupStat);
    slot('top', diagramsIn('recs'));
    sections.forEach((g, gi) => slot(gi, g.title ? diagrams.filter((d) => d.group === g.title) : []));
    mountRecVisuals(rv);
    mountRecEditor();
  }
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
  // Redraw just this card, so a playing recording elsewhere in the view keeps going.
  function redrawRec(r) {
    const el = r && rv.querySelector('.rec[data-rid="' + r.rid + '"]');
    if (!el) return;
    const open = Array.from(el.querySelectorAll('details[open]'), (x) => x.className);
    el.outerHTML = recHtml(r);
    const now = rv.querySelector('.rec[data-rid="' + r.rid + '"]');
    open.forEach((cls) => { const x = now.querySelector('details.' + cls); if (x) x.open = true; });
    $('rcount').innerHTML = recsCount();
    const card = now.closest('.rgroup[data-g]');
    if (card) groupStat(card);
    mountRecVisuals(now);
    mountRecEditor();
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
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    const r = recs.find((x) => x.rid === b.closest('.rec').dataset.rid);
    if (!r) return;
    delete state.autoYes[r.rid];
    decide(r, b.dataset.rec);
    redrawRec(r);
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
    { ev: 'APPROVE', shipit: true, label: '<span class="squirrel" aria-hidden="true">&#x1F43F;&#xFE0F;</span> Ship it', cls: 'primary shipit',
      tip: 'Approve, with ' + SHIPIT + ' added to the summary' },
  ];
  sv.innerHTML =
    '<div class="svhead"><div><h2>Finish your review</h2><div class="svtarget" id="svtarget"></div></div></div>' +
    '<div class="svready" id="svready"></div>' +
    '<div class="svblock svcompose"><div id="svbody"></div><div class="svposts" id="svposts"></div>' +
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
  const bodyFor = (shipit) => [fullBody(), shipit ? SHIPIT : ''].filter(Boolean).join('\n\n');
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
        (open ? '<a href="#overview">' + plural(open, 'check') + ' still open</a>. ' : '') +
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
        (open ? '<a href="#code" data-mode="recs">' + plural(open, 'recommendation') + ' still open</a>. ' : '') +
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
    if (PR && PR.ci) items.push(ciCount('fail') ? { bad: 1, html: '<a href="#overview">CI ' + esc(ciLabel()) + '</a>' }
      : ciCount('pending') ? { warn: 1, html: '<a href="#overview">CI ' + esc(ciLabel()) + '</a>' } : { ok: 1, html: 'CI ' + esc(ciLabel()) });
    if (stale) items.push({ bad: 1, html: '<a href="#" data-open="svcomments">' + plural(stale, 'comment') + ' on changed code</a> (blocks submitting)' });
    if (openRecs) items.push({ warn: 1, html: '<a href="#code" data-mode="recs">' + plural(openRecs, 'recommendation') + ' undecided</a>' });
    if (openChecks) items.push({ warn: 1, html: '<a href="#overview">' + plural(openChecks, 'feature check') + ' unchecked</a>' });
    if (waiting) items.push({ warn: 1, html: '<a href="#" data-open="svcomments">' + plural(waiting, 'suggested comment') + ' not in your review</a>' });
    if (concerns().length) items.push({ warn: 1, html: plural(concerns().length, 'concern') + ' in the summary' });
    if (!items.some((i) => i.bad || i.warn)) items.push({ ok: 1, html: 'Everything is decided' });
    return items.map((i) => '<span class="svchip' + (i.bad ? ' bad' : i.warn ? ' warn' : ' ok') + '">' + (i.bad ? '&#10007; ' : i.warn ? '&#9675; ' : '&#10003; ') + i.html + '</span>').join('');
  }

  function refreshSubmit() {
    $('svready').innerHTML = readiness();
    const n = state.comments.length, nr = state.comments.filter((c) => c.subject === 'reply').length;
    $('svposts').innerHTML = n || fullBody() ? 'Posts ' + [fullBody() ? 'your summary' : '', n - nr ? plural(n - nr, 'line comment') : '', nr ? plural(nr, 'reply', 'replies') : '']
      .filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : 'Nothing written yet.';
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
        body: c.body,
        attachments: (c.attachments || []).map(strip),
        snippet: span ? f.rows.slice(span[0], span[1] + 1).map((r) => SIGN[r.t] + r.text) : [],
      };
    });
    const data = { version: 1, title: META.title, slug: META.slug, range: META.range || null, pr: PR, commit_id: META.commitId || null,
      event: PR ? ev : null, shipit: shipit || undefined, body: bodyFor(shipit), attachments: (state.bodyAttachments || []).map(strip), comments,
      feature_checks: checks.map((c) => ({ text: c.text, status: checkOf(c).s || 'open', note: checkOf(c).note || undefined })),
      recommendations: recs.map((r) => ({ id: r.rid, title: r.title, kind: r.kind || null, status: recStatus(r), comments: r.sids.length,
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
  let flashTimer = null, statsHtml = null;
  function flash(msg, err) {
    if (document.body.classList.contains('submitting')) { status(msg, err ? 'err' : ''); return; }
    const el = $('stats');
    if (statsHtml == null) statsHtml = el.innerHTML;
    clearTimeout(flashTimer);
    el.textContent = msg; el.style.color = err ? 'var(--del-b)' : 'var(--accent)';
    flashTimer = setTimeout(() => { el.innerHTML = statsHtml; statsHtml = null; el.style.color = ''; }, 3500);
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
  // With the server up, ask it what GitHub will do before the reviewer commits to it.
  async function precheck() {
    if (!SERVER || !PR || !state.comments.length) return;
    try {
      const r = await post('/api/check', reviewData());
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

  // --- views, toolbar -----------------------------------------------------
  // With no hash, the page reopens on the step you were last on: the overview first when there is one.
  const STEP_KEY = KEY + ':step';
  const ANCHOR = /^#[fg]\d+$/;
  // The code step opens on Recommendations unless the reviewer last chose Code for this PR. A file
  // or group anchor always means the diff. Each mode keeps its own scroll position.
  const MODE_KEY = KEY + ':mode';
  // A group link from the overview opens the Recommendations at that group's card.
  let pendingCard = null;
  const showCard = () => {
    const el = pendingCard && $(pendingCard);
    pendingCard = null;
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hdr.offsetHeight - 8);
  };
  let mode = store.get(MODE_KEY) === 'diff' ? 'diff' : 'recs';
  const ys = { recs: 0, diff: 0 };
  function applyMode() {
    document.body.classList.toggle('recs', mode === 'recs');
    document.querySelectorAll('#modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'recs') renderRecs();
    render();
  }
  function setMode(m) {
    const onCode = document.body.dataset.view === 'code';
    if (m === mode) return;
    if (onCode) ys[mode] = window.scrollY;
    mode = m;
    store.set(MODE_KEY, m);
    if (onCode && m === 'recs' && ANCHOR.test(location.hash)) history.replaceState(null, '', '#code');
    applyMode();
    if (onCode) window.scrollTo(0, ys[m]);
  }
  function setView() {
    const h = location.hash, was = document.body.dataset.view;
    const done = h === '#done' && renderDone();
    let step = done ? 'done' : h === '#submit' ? 'submit' : h === '#overview' ? 'overview' : h === '#code' || ANCHOR.test(h) ? 'code' : null;
    if (!step) step = (() => { try { return localStorage.getItem(STEP_KEY); } catch (e) { return null; } })() || (OV ? 'overview' : 'code');
    if (was === 'code' && step !== 'code') ys[mode] = window.scrollY;
    document.body.dataset.view = step;
    document.body.classList.toggle('overviewing', step === 'overview');
    document.body.classList.toggle('submitting', step === 'submit');
    document.body.classList.toggle('done', step === 'done');
    document.querySelectorAll('#steps [data-step]').forEach((b) => b.classList.toggle('on', b.dataset.step === step));
    if (step !== 'done') try { localStorage.setItem(STEP_KEY, step); } catch (e) { /* storage unavailable */ }
    if (step === 'submit') { renderSubmit(); precheck(); }
    if (step === 'overview') renderOverview();
    if (step !== 'code') { window.scrollTo(0, 0); return; }
    const el = ANCHOR.test(h) && $(h.slice(1));
    const toAnchor = () => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hdr.offsetHeight);
    if (el && mode !== 'diff') {
      // An anchor from the recommendations (or the overview) opens the diff there.
      if (was === 'code') ys.recs = window.scrollY;
      mode = 'diff';
      store.set(MODE_KEY, 'diff');
      applyMode();
      toAnchor();
      return;
    }
    applyMode();
    // The diff was hidden when the browser tried to follow the anchor, so follow it now.
    if (was && was !== 'code') { if (el) toAnchor(); else window.scrollTo(0, ys[mode]); }
    showCard();
  }
  addEventListener('hashchange', setView);
  const goStep = (step) => { if (location.hash === '#' + step) setView(); else location.hash = step; };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) { e.preventDefault(); goStep(b.dataset.step); }
  });
  $('gosubmit').onclick = () => goStep('submit');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    e.preventDefault();
    pendingCard = b.dataset.rg != null ? 'rg' + b.dataset.rg : null;
    if (document.body.dataset.view === 'code') { setMode(b.dataset.mode); showCard(); }
    else { mode = b.dataset.mode; store.set(MODE_KEY, mode); goStep('code'); }
  });

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
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const img = e.target.closest('.dmedia img'), ex = e.target.closest('.dexpand');
    if (img && !img.closest('#lightbox')) {
      lightbox.className = '';
      lightbox.replaceChildren(img.cloneNode());
    } else if (ex) {
      // A compare diagram's sides each carry their own; a whole diagram keeps it on its figure.
      const host = ex.closest('.dside') || ex.closest('figure.diagram'), fig = ex.closest('figure.diagram');
      if (!host || !host.diag) return;
      e.stopPropagation();
      const panel = document.createElement('div');
      panel.className = 'lbpanel';
      panel.innerHTML = '<button type="button" class="lbclose" title="Close (Esc)">&times;</button>';
      panel.appendChild(DIAG.render(host.diag, fig && fig.md, { big: true }));
      lightbox.className = 'lbdiag';
      lightbox.replaceChildren(panel);
      fitBig(panel);
    } else if (e.target.closest('#lightbox') && (!lightbox.classList.contains('lbdiag') || e.target === lightbox || e.target.closest('.lbclose'))) {
      lightbox.className = 'hidden';
    }
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
  const KEYS = [['j / k', 'Next / previous file'], ['v', 'Toggle Viewed on the current file'], ['x', 'Collapse or expand the current file'],
    ['n / p', 'Next / previous comment or thread'], ['/', 'Filter files'], ['s', 'Split or unified view'],
    ['w', 'Show or hide whitespace changes'], ['r', 'Recommendations or code'], ['1 / 2 / 3', 'Overview, code, submit'], ['?', 'This help'], ['Esc', 'Close this help']];
  const help = document.createElement('div');
  help.id = 'keyhelp'; help.className = 'hidden';
  help.innerHTML = '<div class="kbox"><h3>Keyboard shortcuts</h3><table>' +
    KEYS.map((k) => '<tr><td>' + k[0].split(' / ').map((x) => '<kbd>' + esc(x) + '</kbd>').join(' / ') + '</td><td>' + esc(k[1]) + '</td></tr>').join('') +
    '</table><p class="svnote">The current file is the one whose header is pinned under the toolbar.</p></div>';
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
    if (e.key === 'Escape') { toggleKeys(false); lightbox.className = 'hidden'; return; }
    const STEPS = { 1: 'overview', 2: 'code', 3: 'submit' };
    if (STEPS[e.key]) { goStep(STEPS[e.key]); e.preventDefault(); return; }
    if (document.body.dataset.view !== 'code') return;
    const k = e.key;
    if (k === 'r') { setMode(mode === 'recs' ? 'diff' : 'recs'); e.preventDefault(); return; }
    if (mode === 'recs') return;
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
