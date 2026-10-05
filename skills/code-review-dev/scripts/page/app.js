/**
 * The review page. build-review.cjs inlines this after diff-parse, highlight and
 * markdown, alongside JSON islands: #diff-src (the raw diff), #ws-src (the
 * whitespace-insensitive diff for the files where it differs), #threads-src
 * (the PR's existing review threads), #guide-src (reading guide, auto-reviewed
 * files, suggested comments) and #meta-src (title, slug, PR, commit, file
 * blobs, last review). #server-src is null from file:// and carries a token
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
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  let viewed = load(KEY, {});
  const saveViewed = () => localStorage.setItem(KEY, JSON.stringify(viewed));
  const state = Object.assign({ comments: [], dismissed: [], body: '', bodyAttachments: [], event: META.event || 'COMMENT', submitted: null },
    load(KEY + ':review', {}));
  const save = () => {
    try { localStorage.setItem(KEY + ':review', JSON.stringify(state)); }
    catch (e) { flash('Could not save comments locally (storage full?). Large attachments are the usual cause.', true); }
  };

  let hideWs = !!WS && localStorage.getItem('diffhidews') === '1';
  let split = localStorage.getItem('diffsplit') === '1';

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
    if (gf.length) groups.push({ title: g.title || 'Group', why: g.why || '', auto: !!g.auto, files: gf });
  });
  const rest = files.filter((f) => !claimed.has(f.name));
  if (groups.length && rest.length) groups.push({ title: 'Unsorted', why: 'Not covered by the reading guide', files: rest });
  const sections = groups.length ? groups : [{ title: null, why: '', files }];
  const fileOrder = sections.flatMap((g) => g.files);

  const suggestions = (GUIDE.suggestions || []).map((s) =>
    Object.assign({ subject: s.line == null ? 'file' : 'line', side: 'RIGHT' }, s, { sid: 's' + hash(JSON.stringify(s)) }));
  const pendingSuggestions = () => suggestions.filter((s) =>
    !state.dismissed.includes(s.sid) && !state.comments.some((c) => c.sid === s.sid));

  // --- render the diff ----------------------------------------------------
  let tAdd = 0, tDel = 0, idx = 0;
  sections.forEach((g, gi) => {
    if (g.title) {
      const mh = document.createElement('div');
      mh.className = 'ghead'; mh.id = 'g' + gi;
      mh.innerHTML = '<h2><span class="gnum">' + (gi + 1) + '.</span>' + esc(g.title) +
        '<span class="gct"></span></h2>' + (g.why ? '<p class="gwhy">' + esc(g.why) + '</p>' : '');
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
    sections.forEach((g) => {
      if (!g.title) return;
      const gDone = g.files.filter(covered).length;
      const all = gDone === g.files.length;
      g.ctEls.forEach((el) => el.textContent = (all ? '✓ ' : '') + gDone + ' / ' + g.files.length);
      g.mainEl.classList.toggle('done', all);
      g.navEl.classList.toggle('done', all);
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
    if (editing && (editing.body.trim() || editing.attachments.length) && !(draft.id && draft.id === editing.id)) {
      // Never throw away typed text; send the reviewer back to it instead.
      goToFile(byName.get(editing.path));
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
    if (prev && prev.path !== draft.path) renderFile(byName.get(prev.path));
    goToFile(f);
    renderFile(f);
    editing.el.querySelector('textarea').focus();
  }

  function saveDraft() {
    const d = editing;
    if (!d.body.trim() && !d.attachments.length) return;
    const c = { id: d.id || uid('c'), sid: d.sid, thread_id: d.thread_id, path: d.path, subject: d.subject, side: d.side, line: d.line,
      start_side: d.start_side, start_line: d.start_line, body: d.body, attachments: d.attachments };
    const at = state.comments.findIndex((x) => x.id === c.id);
    if (at === -1) state.comments.push(c); else state.comments[at] = c;
    editing = null;
    save();
    renderFile(byName.get(c.path));
    render();
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
    if (editing && editing.path === f.name) {
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
      state.comments.push({ id: uid('c'), sid: s.sid, path: s.path, subject: s.subject, side: s.side, line: s.line,
        start_side: s.start_side ?? null, start_line: s.start_line ?? null, body: s.body, attachments: [] });
    } else if (act === 'edit-s' && s) {
      openEditor({ sid: s.sid, path: s.path, subject: s.subject, side: s.side, line: s.line,
        start_side: s.start_side ?? null, start_line: s.start_line ?? null, body: s.body, attachments: [] });
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
    wrap.className = 'editor';
    wrap.innerHTML =
      '<div class="etabs"><button type="button" data-tab="write" class="on">Write</button>' +
      '<button type="button" data-tab="preview">Preview</button>' +
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
      e.stopPropagation();
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.rm) {
        draft.attachments = draft.attachments.filter((a) => a.id !== t.dataset.rm);
        ta.value = ta.value.replace(new RegExp('!?\\[[^\\]]*\\]\\(attachment:' + t.dataset.rm + '\\)\\n?', 'g'), '');
        changed(); renderAtts();
      } else if (t.dataset.tab) {
        const prev = t.dataset.tab === 'preview';
        wrap.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === t));
        ta.classList.toggle('hidden', prev); pv.classList.toggle('hidden', !prev);
        if (prev) pv.innerHTML = MD.render(ta.value, { attachments: attMap(draft.attachments), original: originalOf(draft) }) ||
          '<p class="svnote">Nothing to preview</p>';
      } else if (t.dataset.tool) tools[t.dataset.tool]();
      else if (t.dataset.ed === 'save') opts.onSave();
      else if (t.dataset.ed === 'cancel') opts.onCancel();
    });
    renderAtts();
    return wrap;
  }

  // --- the submit view ----------------------------------------------------
  const sv = $('submitview');
  sv.innerHTML =
    '<h2>Finish your review</h2><div class="svtarget" id="svtarget"></div>' +
    '<div class="svblock"><h3>Summary</h3><div id="svbody"></div>' +
    (PR ? '<div class="svevent" id="svevent" style="margin-top:10px">' +
      [['COMMENT', 'Comment', 'General feedback without explicit approval'], ['APPROVE', 'Approve', 'Approve merging these changes'],
        ['REQUEST_CHANGES', 'Request changes', 'Feedback that must be addressed before merging']]
        .map((o) => '<label><input type="radio" name="ev" value="' + o[0] + '"> <span><b>' + o[1] + '</b><br><small>' +
          o[2] + '</small></span></label>').join('') + '</div>' : '') + '</div>' +
    '<div class="svblock"><h3 id="svcount"></h3><div id="svlist"></div></div>' +
    '<div class="svblock" id="svautoblock"><h3>Auto-reviewed files</h3><ul class="svauto" id="svauto"></ul></div>' +
    '<div class="svblock"><div class="svactions">' +
    '<button type="button" id="svmd">Copy as Markdown</button><button type="button" id="svjson">Copy JSON</button>' +
    '<button type="button" id="svdl">Download JSON</button>' +
    (SERVER ? '<button type="button" id="svsave">Save for agent</button>' : '') + '<span class="sp"></span>' +
    (PR ? '<button type="button" class="primary" id="svsubmit">Submit review</button>' : '') +
    '</div><div class="svnote" id="svhelp"></div><div class="svstatus" id="svstatus"></div></div>';

  let bodyDraft;
  const mountBody = () => {
    bodyDraft = { get body() { return state.body; }, set body(v) { state.body = v; }, attachments: state.bodyAttachments };
    $('svbody').innerHTML = '';
    $('svbody').appendChild(makeEditor(bodyDraft, {
      inline: true, placeholder: 'Overall feedback (optional). Markdown supported.',
      onInput: () => { state.bodyAttachments = bodyDraft.attachments; save(); },
    }));
  };
  mountBody();
  if (PR) {
    sv.querySelectorAll('input[name=ev]').forEach((r) => {
      r.checked = r.value === state.event;
      r.addEventListener('change', () => { state.event = r.value; save(); });
    });
  }

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
    $('svcount').textContent = plural(all.length - nr, 'comment') + (nr ? ' · ' + plural(nr, 'reply', 'replies') : '') +
      (pend.length ? ' · ' + plural(pend.length, 'suggestion') + ' waiting for you to accept or dismiss' : '');
    let html = '', last = null;
    all.concat(pend).forEach((c) => {
      if (c.path !== last) { html += '<div class="svfile">' + esc(c.path) + '</div>'; last = c.path; }
      const card = cardHtml(c, !!(c.sid && !c.id));
      const r = replyingTo(c);
      const quote = r ? '<div class="rquote"><b>' + esc(r.author) + '</b> ' + esc(r.excerpt) + '</div>' : '';
      html += card.replace('<div class="md">', snippetHtml(c) + quote + '<div class="md">');
    });
    $('svlist').innerHTML = html || '<p class="svnote">No comments yet. Click a line number in the diff to comment on it, drag across line numbers to comment on a range, or use a file\'s Comment button.</p>';
    const autos = files.filter((f) => f.auto);
    $('svautoblock').classList.toggle('hidden', !autos.length);
    $('svauto').innerHTML = autos.map((f) => '<li><code>' + esc(f.name) + '</code> ' + esc(f.auto.summary || '') +
      (f.cb.checked ? ' <span class="svnote">(you also viewed it)</span>' : '') + '</li>').join('');
    $('svhelp').innerHTML = !PR ? '' : SERVER
      ? 'Submitting posts every comment and reply above as one review. Comments on lines GitHub cannot anchor to are added to the summary instead.'
      : 'Submitting needs the local server: rebuild with <code>--serve</code>, or Copy JSON and have the agent run <code>pbpaste | node ~/.claude/skills/code-review-dev/scripts/submit-review.cjs -</code>.';
    const sub = $('svsubmit');
    if (sub) sub.disabled = !SERVER || (!all.length && !state.body.trim() && state.event !== 'APPROVE');
    if (state.submitted) status('Last submitted ' + new Date(state.submitted.at).toLocaleString() + ': ' + state.submitted.url, 'ok');
  }

  function reviewData() {
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
      event: PR ? state.event : null, body: state.body, attachments: (state.bodyAttachments || []).map(strip), comments,
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
  function flash(msg, err) {
    if (document.body.classList.contains('submitting')) { status(msg, err ? 'err' : ''); return; }
    const el = $('stats'), was = el.innerHTML;
    el.textContent = msg; el.style.color = err ? 'var(--del-b)' : 'var(--accent)';
    setTimeout(() => { el.innerHTML = was; el.style.color = ''; }, 3500);
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
  $('svdl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(reviewData(), null, 2)], { type: 'application/json' }));
    a.download = (META.slug || 'review') + '.review.json';
    a.click();
    status('Downloaded ' + a.download + '.', 'ok');
  };
  if ($('svsave')) $('svsave').onclick = async () => {
    try {
      const r = await post('/api/save', reviewData());
      status('Saved for the agent:\n' + r.markdown + '\n' + r.json, 'ok');
    } catch (e) { status(e.message, 'err'); }
  };
  if ($('svsubmit')) $('svsubmit').onclick = async () => {
    const btn = $('svsubmit');
    btn.disabled = true;
    status('Submitting…');
    try {
      const data = reviewData();
      const r = await post('/api/submit', data);
      const nr = data.comments.filter((c) => c.subject === 'reply').length;
      state.submitted = { url: r.url, at: Date.now(), event: data.event, comments: data.comments.length - nr, replies: nr, notes: r.notes || [] };
      state.comments = []; state.body = ''; state.bodyAttachments = [];
      save();
      mountBody();
      files.forEach(renderFile);
      render();
      // Leave the review behind: the server has exited, so there is nothing more to do on it.
      history.replaceState(null, '', location.pathname + location.search + '#done');
      setView();
    } catch (e) { status(e.message, 'err'); btn.disabled = false; }
  };
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
    $('doneview').innerHTML = '<div class="donebox"><div class="donecheck">&#10003;</div><h2>Review submitted</h2>' +
      '<p>' + esc(VERDICT[s.event] || 'Reviewed') + (PR ? ' on <a href="' + esc(PR.url) + '" target="_blank" rel="noopener">' +
        esc(PR.owner + '/' + PR.repo + '#' + PR.number) + '</a>' : '') + (what ? ' with ' + what : '') + ', ' + esc(new Date(s.at).toLocaleString()) + '.</p>' +
      (s.notes && s.notes.length ? '<ul class="donenotes">' + s.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      '<div class="svactions">' + (s.url ? '<a class="btn primary" href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the review on GitHub</a>' : '') +
      '<button type="button" id="doneback">Back to the diff</button></div>' +
      '<p class="svnote">You can close this tab.</p></div>';
    $('doneback').onclick = () => { history.pushState(null, '', location.pathname + location.search); setView(); };
    return true;
  }

  // --- views, toolbar -----------------------------------------------------
  function setView() {
    const done = location.hash === '#done' && renderDone();
    const sub = !done && location.hash === '#submit';
    document.body.classList.toggle('submitting', sub);
    document.body.classList.toggle('done', !!done);
    if (sub) { renderSubmit(); precheck(); }
    if (sub || done) window.scrollTo(0, 0);
  }
  addEventListener('hashchange', setView);
  $('gosubmit').onclick = () => { location.hash = 'submit'; };
  $('goback').onclick = () => { history.pushState(null, '', location.pathname + location.search); setView(); };

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
    hlBtn.textContent = 'Syntax: ' + (on ? 'on' : 'off');
    localStorage.setItem('diffsyntax', on ? '1' : '0');
  };
  setHl(localStorage.getItem('diffsyntax') !== '0');
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
  const setWs = (on) => { if (wsBtn.disabled) return; hideWs = on; localStorage.setItem('diffhidews', on ? '1' : '0'); showWsLabel(); rebuildAll(); };
  const setSplit = (on) => { split = on; localStorage.setItem('diffsplit', on ? '1' : '0'); splitBtn.textContent = 'View: ' + (on ? 'split' : 'unified'); rebuildAll(); };
  showWsLabel();
  splitBtn.textContent = 'View: ' + (split ? 'split' : 'unified');
  wsBtn.onclick = () => setWs(!hideWs);
  splitBtn.onclick = () => setSplit(!split);

  // --- keyboard -------------------------------------------------------------
  const KEYS = [['j / k', 'Next / previous file'], ['v', 'Toggle Viewed on the current file'], ['x', 'Collapse or expand the current file'],
    ['n / p', 'Next / previous comment or thread'], ['/', 'Filter files'], ['s', 'Split or unified view'],
    ['w', 'Show or hide whitespace changes'], ['?', 'This help'], ['Esc', 'Close this help']];
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
    if (e.key === 'Escape') { toggleKeys(false); return; }
    if (document.body.classList.contains('submitting') || document.body.classList.contains('done')) return;
    const k = e.key;
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
  setHH(); addEventListener('resize', setHH);
})();
