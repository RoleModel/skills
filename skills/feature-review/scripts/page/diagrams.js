/**
 * Diagrams for the overview step and the reading guide's groups. The page is
 * offline, so there is no Mermaid: the agent describes a diagram as data and
 * this lays it out as SVG with fixed arithmetic (no measuring), or hands over
 * raw HTML/SVG that is shown in a shadow root so its styles can't leak.
 *
 *   structure  layers of nodes with edges (the code-shape format)
 *   sequence   actors with lifelines and the messages between them, in order
 *   compare    { before, after }: two diagrams side by side
 *   html, svg  hand-written markup, static only (scripts never run)
 *
 * Node, edge and message `status` is new | changed | removed | same.
 */
const DIAG = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Rough text width at the sizes used below. Layout never measures the DOM, so
  // it's the same in every browser and in jsdom; labels get generous padding.
  const tw = (s, px) => String(s || '').length * (px || 12.5) * 0.6;
  const STATUS = ['new', 'changed', 'removed', 'same'];
  const st = (s) => (STATUS.includes(s) ? s : 'same');
  const LEGEND = { new: 'new', changed: 'changed', removed: 'removed', same: 'unchanged' };
  const legend = (used) => {
    const list = STATUS.filter((s) => used.has(s));
    if (list.length < 2 && !used.has('removed') && !used.has('new')) return '';
    return '<div class="dlegend">' + list.map((s) => '<span class="dk ' + s + '"><i></i>' + LEGEND[s] + '</span>').join('') + '</div>';
  };
  const arrowDefs = (id) => '<defs>' + STATUS.map((s) =>
    '<marker id="' + id + '-' + s + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0L10,5L0,10z" class="dm ' + s + '"/></marker>').join('') + '</defs>';
  let seq = 0;
  const edgeOf = (e) => (Array.isArray(e) ? { from: e[0], to: e[1], label: e[2], status: e[3] } : e);
  const label = (x, y, text, cls) => {
    if (!text) return '';
    const w = tw(text, 11) + 10;
    return '<g class="dlbl ' + (cls || '') + '"><rect x="' + (x - w / 2) + '" y="' + (y - 9) + '" width="' + w + '" height="16" rx="3"/>' +
      '<text x="' + x + '" y="' + (y + 3) + '" text-anchor="middle">' + esc(text) + '</text></g>';
  };

  // --- structure: nodes in layers, top to bottom --------------------------
  function structure(d) {
    const id = 'dg' + (++seq);
    const nodes = (d.nodes || []).map((n) => Object.assign({}, n, { status: st(n.status) }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = (d.edges || []).map(edgeOf).filter((e) => byId.has(e.from) && byId.has(e.to));
    const layers = (d.layers || []).slice();
    nodes.forEach((n) => { if (!layers.includes(n.layer || '')) layers.push(n.layer || ''); });
    const rows = layers.map((l) => nodes.filter((n) => (n.layer || '') === l)).filter((r) => r.length);
    const rowLayer = rows.map((r) => r[0].layer || '');
    const NH = (n) => (n.sub ? 50 : 36);
    nodes.forEach((n) => { n.w = Math.min(260, Math.max(96, Math.max(tw(n.label || n.id, 13), tw(n.sub, 11)) + 28)); });
    // One barycenter pass: order each row by where its neighbours above sit, which
    // untangles most small diagrams without a real layout engine.
    const GAP = 28, LBL = layers.some(Boolean) ? 120 : 16;
    const place = (row) => { let x = 0; row.forEach((n) => { n.x = x; x += n.w + GAP; }); return x - GAP; };
    rows.forEach((row, ri) => {
      if (ri) {
        const above = new Set(rows.slice(0, ri).flat());
        const bary = (n) => {
          const xs = edges.flatMap((e) => (e.from === n.id && above.has(byId.get(e.to)) ? [byId.get(e.to)]
            : e.to === n.id && above.has(byId.get(e.from)) ? [byId.get(e.from)] : [])).map((m) => m.x + m.w / 2);
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        };
        const keyed = row.map((n, i) => ({ n, i, b: bary(n) }));
        keyed.sort((a, b) => (a.b == null || b.b == null ? a.i - b.i : a.b - b.b || a.i - b.i));
        row.splice(0, row.length, ...keyed.map((k) => k.n));
      }
      row.width = place(row);
    });
    const inner = Math.max(...rows.map((r) => r.width), 200);
    const W = LBL + inner + 24;
    // An edge within the top row arcs above it, so leave room for the arc.
    const topArc = edges.some((e) => e.from !== e.to && rows[0].includes(byId.get(e.from)) && rows[0].includes(byId.get(e.to)));
    let y = topArc ? 56 : 16;
    rows.forEach((row) => {
      const h = Math.max(...row.map(NH));
      const off = LBL + (inner - row.width) / 2;
      row.forEach((n) => { n.x += off; n.h = NH(n); n.y = y + (h - n.h) / 2; n.row = row; });
      row.y = y; row.h = h;
      y += h + 70;
    });
    const H = y - 70 + 16;
    const used = new Set();
    let svg = '';
    rows.forEach((row, ri) => {
      if (rowLayer[ri]) {
        svg += '<rect class="dband" x="4" y="' + (row.y - 8) + '" width="' + (W - 8) + '" height="' + (row.h + 16) + '" rx="6"/>' +
          '<text class="dlayer" x="14" y="' + (row.y + row.h / 2 + 4) + '">' + esc(rowLayer[ri]) + '</text>';
      }
    });
    edges.forEach((e) => {
      const a = byId.get(e.from), b = byId.get(e.to), s = st(e.status);
      used.add(s);
      let p, lx, ly;
      if (a === b) {
        const x = a.x + a.w, y0 = a.y + a.h / 2;
        p = 'M' + x + ',' + (y0 - 8) + ' C' + (x + 40) + ',' + (y0 - 30) + ' ' + (x + 40) + ',' + (y0 + 30) + ' ' + x + ',' + (y0 + 8);
        lx = x + 44; ly = y0;
      } else if (a.row === b.row) {
        // Same row: arc over the top so it doesn't run through the nodes in between.
        const ax = a.x + a.w / 2, bx = b.x + b.w / 2, top = Math.min(a.y, b.y), lift = 26 + Math.abs(bx - ax) * 0.08;
        p = 'M' + ax + ',' + top + ' C' + ax + ',' + (top - lift) + ' ' + bx + ',' + (top - lift) + ' ' + bx + ',' + top;
        lx = (ax + bx) / 2; ly = top - lift * 0.75;
      } else {
        const down = a.y < b.y;
        const ax = a.x + a.w / 2, ay = down ? a.y + a.h : a.y, bx = b.x + b.w / 2, by = down ? b.y : b.y + b.h;
        const m = (ay + by) / 2;
        p = 'M' + ax + ',' + ay + ' C' + ax + ',' + m + ' ' + bx + ',' + m + ' ' + bx + ',' + by;
        lx = (ax + bx) / 2; ly = m;
      }
      svg += '<path class="de ' + s + '" d="' + p + '" marker-end="url(#' + id + '-' + s + ')"><title>' +
        esc((byId.get(e.from).label || e.from) + ' → ' + (byId.get(e.to).label || e.to) + (e.label ? ': ' + e.label : '')) + '</title></path>' +
        label(lx, ly, e.label, s);
    });
    nodes.forEach((n) => {
      used.add(n.status);
      const cx = n.x + n.w / 2;
      svg += '<g class="dn ' + n.status + '"><title>' + esc(n.note || n.label || n.id) + '</title>' +
        '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="7"/>' +
        '<text x="' + cx + '" y="' + (n.y + (n.sub ? 20 : 22)) + '" text-anchor="middle">' + esc(n.label || n.id) + '</text>' +
        (n.sub ? '<text class="dsub" x="' + cx + '" y="' + (n.y + 38) + '" text-anchor="middle">' + esc(n.sub) + '</text>' : '') +
        (n.status === 'new' || n.status === 'removed' || n.status === 'changed'
          ? '<text class="dtag" x="' + (n.x + n.w - 4) + '" y="' + (n.y - 4) + '" text-anchor="end">' + n.status.toUpperCase() + '</text>' : '') +
        '</g>';
    });
    return '<svg class="dsvg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%" role="img">' + arrowDefs(id) + svg + '</svg>' + legend(used);
  }

  // --- sequence: who calls whom, in order ---------------------------------
  function sequence(d) {
    const id = 'dg' + (++seq);
    const actors = (d.actors || []).map((a) => (typeof a === 'string' ? { id: a, label: a } : a))
      .map((a) => Object.assign({}, a, { status: st(a.status) }));
    const ix = new Map(actors.map((a, i) => [a.id, i]));
    const steps = (d.messages || d.steps || []).map((m) => (Array.isArray(m) ? { from: m[0], to: m[1], label: m[2], status: m[3] } : m));
    const longest = Math.max(...steps.map((m) => (m.divider ? 0 : tw(m.label, 11))), ...actors.map((a) => tw(a.label, 13)), 80);
    const COL = Math.min(320, Math.max(150, longest + 40)), PAD = 20;
    const xOf = (i) => PAD + COL / 2 + i * COL;
    const W = PAD * 2 + COL * Math.max(actors.length, 1);
    const used = new Set();
    let y = 58, body = '';
    steps.forEach((m) => {
      if (m.divider) {
        body += '<line class="ddiv" x1="' + PAD + '" x2="' + (W - PAD) + '" y1="' + (y + 4) + '" y2="' + (y + 4) + '"/>' + label(W / 2, y + 4, m.divider, 'div');
        y += 34; return;
      }
      const a = ix.get(m.from), b = ix.get(m.to);
      if (a == null || b == null) return;
      const s = st(m.status), cls = 'de ' + s + (m.reply ? ' reply' : '');
      used.add(s);
      if (a === b) {
        const x = xOf(a);
        body += '<path class="' + cls + '" d="M' + x + ',' + y + ' h34 v18 h-34" marker-end="url(#' + id + '-' + s + ')"/>' +
          '<text class="dmsg" x="' + (x + 40) + '" y="' + (y + 12) + '">' + esc(m.label) + '</text>';
        y += 40;
      } else {
        const x1 = xOf(a), x2 = xOf(b);
        body += '<line class="' + cls + '" x1="' + x1 + '" x2="' + (x2 + (x2 > x1 ? -2 : 2)) + '" y1="' + (y + 12) + '" y2="' + (y + 12) +
          '" marker-end="url(#' + id + '-' + s + ')"/><text class="dmsg" x="' + (x1 + x2) / 2 + '" y="' + (y + 6) + '" text-anchor="middle">' +
          esc(m.label) + '</text>';
        y += 34;
      }
    });
    const H = y + 20;
    let head = '';
    actors.forEach((a, i) => {
      used.add(a.status);
      const x = xOf(i), w = Math.min(COL - 16, tw(a.label || a.id, 13) + 24);
      head += '<line class="dlife" x1="' + x + '" x2="' + x + '" y1="44" y2="' + (H - 8) + '"/>' +
        '<g class="dn ' + a.status + '"><title>' + esc(a.note || a.label || a.id) + '</title><rect x="' + (x - w / 2) + '" y="8" width="' + w +
        '" height="34" rx="7"/><text x="' + x + '" y="30" text-anchor="middle">' + esc(a.label || a.id) + '</text></g>';
    });
    return '<svg class="dsvg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%" role="img">' + arrowDefs(id) + head + body + '</svg>' + legend(used);
  }

  // --- raw markup ---------------------------------------------------------
  // Shown in a shadow root: page styles can't reach in and its styles can't
  // leak out. The page's colour variables still inherit, and these primitives
  // cover the usual boxes-and-arrows sketches.
  const RAW_CSS = ':host{display:block;color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.col{display:flex;flex-direction:column;gap:8px}' +
    '.grid{display:grid;gap:10px;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr))}' +
    '.box{border:1px solid var(--border);border-radius:8px;padding:6px 10px;background:var(--panel)}' +
    '.box.new,.new{border-color:var(--add-b)}.box.changed,.changed{border-color:#d29922}' +
    '.box.removed,.removed{border-color:var(--del-b);border-style:dashed;opacity:.85}.box.removed{text-decoration:line-through}' +
    '.arrow::before{content:"\\2192";color:var(--muted);font-size:18px}.down::before{content:"\\2193";color:var(--muted);font-size:18px}' +
    '.muted{color:var(--muted)}.small{font-size:12px}.title{font-weight:600;margin-bottom:4px}' +
    '.tag{font-size:10px;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--border);border-radius:20px;padding:0 6px;color:var(--muted)}' +
    '.add{color:var(--add-b)}.del{color:var(--del-b)}.accent{color:var(--accent)}' +
    'code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}' +
    'table{border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}th{background:var(--panel)}' +
    'svg{max-width:100%;height:auto;overflow:visible}svg text{fill:var(--text);font:12px -apple-system,BlinkMacSystemFont,sans-serif}' +
    'svg .muted{fill:var(--muted)}svg .s-new{stroke:var(--add-b)}svg .s-old{stroke:var(--del-b);stroke-dasharray:5 4}' +
    'svg .s-changed{stroke:#d29922}svg .s-muted{stroke:var(--muted)}svg .s-accent{stroke:var(--accent)}' +
    'svg .f-new{fill:var(--add-bg)}svg .f-old{fill:var(--del-bg)}svg .f-panel{fill:var(--panel)}svg .f-accent{fill:var(--accent)}';
  function raw(markup) {
    const host = document.createElement('div');
    host.className = 'draw';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' + RAW_CSS + '</style>' + String(markup || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    // Inline handlers would run; diagrams are pictures, so drop them.
    root.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    });
    return host;
  }

  function body(d) {
    const box = document.createElement('div');
    box.className = 'dbody';
    if (d.kind === 'structure') box.innerHTML = structure(d);
    else if (d.kind === 'sequence') box.innerHTML = sequence(d);
    else if (d.kind === 'compare') {
      box.className = 'dbody dcompare';
      [['before', 'Before'], ['after', 'After']].forEach(([k, t]) => {
        const side = document.createElement('div');
        side.className = 'dside ' + k;
        side.innerHTML = '<div class="dsidet">' + esc((d[k] && d[k].title) || t) + '</div>';
        if (d[k]) side.appendChild(body(d[k]));
        box.appendChild(side);
      });
    } else if (d.kind === 'html' || d.kind === 'svg') box.appendChild(raw(d.html || d.svg));
    else box.innerHTML = '<p class="svnote">Unknown diagram kind: ' + esc(d.kind) + '</p>';
    return box;
  }

  // A titled figure with its caption rendered as Markdown.
  function render(d, md) {
    const fig = document.createElement('figure');
    fig.className = 'diagram';
    if (d.title) fig.insertAdjacentHTML('beforeend', '<figcaption class="dtitle">' + esc(d.title) + '</figcaption>');
    fig.appendChild(body(d));
    if (d.caption) fig.insertAdjacentHTML('beforeend', '<div class="dcap md">' + (md ? md(d.caption) : esc(d.caption)) + '</div>');
    return fig;
  }

  const KINDS = ['structure', 'sequence', 'compare', 'html', 'svg'];
  // Problems the build reports before writing the page; [] when the diagram is drawable.
  function problems(d, where) {
    const out = [], at = where || (d && d.title) || 'diagram';
    if (!d || !KINDS.includes(d.kind)) return [at + ': kind must be one of ' + KINDS.join(', ')];
    if (d.kind === 'structure') {
      const ids = new Set();
      (d.nodes || []).forEach((n) => { if (!n.id) out.push(at + ': a node has no id'); else if (ids.has(n.id)) out.push(at + ': duplicate node ' + n.id); ids.add(n.id); });
      if (!ids.size) out.push(at + ': no nodes');
      (d.edges || []).map(edgeOf).forEach((e) => {
        if (!ids.has(e.from)) out.push(at + ': edge from unknown node ' + e.from);
        if (!ids.has(e.to)) out.push(at + ': edge to unknown node ' + e.to);
      });
    } else if (d.kind === 'sequence') {
      const ids = new Set((d.actors || []).map((a) => (typeof a === 'string' ? a : a.id)));
      if (!ids.size) out.push(at + ': no actors');
      (d.messages || d.steps || []).forEach((m) => {
        const x = Array.isArray(m) ? { from: m[0], to: m[1] } : m;
        if (x.divider) return;
        if (!ids.has(x.from)) out.push(at + ': message from unknown actor ' + x.from);
        if (!ids.has(x.to)) out.push(at + ': message to unknown actor ' + x.to);
      });
    } else if (d.kind === 'compare') {
      if (!d.before || !d.after) out.push(at + ': compare needs both before and after');
      ['before', 'after'].forEach((k) => { if (d[k]) out.push(...problems(d[k], at + ' (' + k + ')')); });
    } else if (!(d.html || d.svg)) out.push(at + ': ' + d.kind + ' diagram has no markup');
    return out;
  }

  const api = { render, body, problems, KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
