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
 *   image, video  a screenshot, GIF or screen recording; the build inlines the
 *              file named by `src` as a data URL in `data`, so the page stays offline
 *
 *   flow       steps and decisions, ranked top to bottom from the edges
 *   states     a state machine: states and the transitions between them
 *   table      rows and columns with changed cells marked (a permissions matrix, a price list)
 *   timeline   events in order along a line
 *
 * Node, edge and message `status` is new | changed | removed | same. Any part can also carry
 * `step` and `pin`, and image, video, html and svg diagrams take `marks` (see below).
 */
const DIAG = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Rough text width at the sizes used below. Layout never measures the DOM, so
  // it's the same in every browser; labels get generous padding.
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
    '<marker id="' + id + '-' + s + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
    '<path d="M0,1.5L10,5L0,8.5z" class="dm ' + s + '"/></marker>').join('') + '</defs>';
  let seq = 0;
  const edgeOf = (e) => (Array.isArray(e) ? { from: e[0], to: e[1], label: e[2], status: e[3] } : e);
  const label = (x, y, text, cls) => {
    if (!text) return '';
    const w = tw(text, 11) + 10;
    return '<g class="dlbl ' + (cls || '') + '"><rect x="' + (x - w / 2) + '" y="' + (y - 9) + '" width="' + w + '" height="16" rx="3"/>' +
      '<text x="' + x + '" y="' + (y + 3) + '" text-anchor="middle">' + esc(text) + '</text></g>';
  };

  // --- shared parts: reveal by step, pins ----------------------------------
  // Any node, edge, actor, message, row, event or mark can carry `step` (a connection step number, or
  // a list), `pin` (a number drawn on it) and `status`. A diagram with steps builds up as the reader
  // moves through them.
  const steps = (v) => [].concat(v == null ? [] : v).map(Number).filter((n) => n > 0);
  const partAttrs = (o, name) => {
    const ss = steps(o.step);
    return ' data-el="' + esc(name || '') + '"' + (ss.length ? ' data-step="' + ss.join(' ') + '"' : '') +
      (o.status && o.status !== 'same' ? ' data-status="' + esc(o.status) + '"' : '');
  };
  const pinSvg = (x, y, n) => n == null ? '' : '<g class="dpin"><circle cx="' + x + '" cy="' + y + '" r="9"/><text x="' + x + '" y="' + (y + 3.5) +
    '" text-anchor="middle">' + esc(n) + '</text></g>';
  // A polyline with its corners rounded, so routed lines read as one stroke rather than a staircase.
  function rounded(pts, r) {
    const p = pts.filter((q, i) => !i || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
    let d = 'M' + p[0][0] + ',' + p[0][1];
    for (let i = 1; i < p.length - 1; i++) {
      const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1];
      const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1), rr = Math.min(r, d1 / 2, d2 / 2);
      d += ' L' + (x1 + (x0 - x1) / d1 * rr) + ',' + (y1 + (y0 - y1) / d1 * rr) + ' Q' + x1 + ',' + y1 + ' ' + (x1 + (x2 - x1) / d2 * rr) + ',' + (y1 + (y2 - y1) / d2 * rr);
    }
    const z = p[p.length - 1];
    return d + ' L' + z[0] + ',' + z[1];
  }

  // --- structure: nodes in layers, top to bottom --------------------------
  // Lines are routed, not curved: down out of a box, across in the gap between layers on a track of
  // their own, and down into the next. An edge that skips a layer drops through a clear lane between
  // that layer's boxes, so no line ever runs behind a box.
  function structure(d) {
    const id = 'dg' + (++seq);
    const nodes = (d.nodes || []).map((n) => Object.assign({}, n, { status: st(n.status) }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = (d.edges || []).map(edgeOf).filter((e) => byId.has(e.from) && byId.has(e.to));
    const layers = (d.layers || []).slice();
    nodes.forEach((n) => { if (!layers.includes(n.layer || '')) layers.push(n.layer || ''); });
    const rows = layers.map((l) => nodes.filter((n) => (n.layer || '') === l)).filter((r) => r.length);
    const rowLayer = rows.map((r) => r[0].layer || '');
    rows.forEach((r, ri) => r.forEach((n) => { n.ri = ri; }));
    const NH = (n) => (n.shape === 'decision' ? 62 : n.sub ? 52 : 38);
    const marked = (n) => n.status !== 'same' && n.shape !== 'decision';
    nodes.forEach((n) => {
      n.w = Math.min(280, Math.max(n.shape === 'start' || n.shape === 'end' ? 72 : 96, Math.max(tw(n.label || n.id, 13), tw(n.sub, 11)) + (marked(n) ? 42 : 30)));
      if (n.shape === 'decision') n.w = Math.min(320, n.w * 1.45);
    });
    // Order each row by where its neighbours sit, sweeping down, up and down again: enough to untangle
    // most review-sized diagrams without a layout engine.
    const banded = d.bands !== false && layers.some(Boolean);
    // In a flow or a state machine, a line back up (a retry, "send back") runs up the right of the
    // picture and a line that skips a rank runs down the left, each in a lane of its own, so the main
    // path stays a clean column.
    edges.forEach((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      e.side = !d.ranked || a === b ? null : a.ri > b.ri ? 'right' : b.ri - a.ri > 1 ? 'left' : null;
    });
    const sideW = (k) => {
      const list = edges.filter((e) => e.side === k);
      return list.length ? 30 + list.length * 14 + Math.max(0, ...list.map((e) => (e.label ? tw(e.label, 11) + 16 : 0))) : 0;
    };
    const GAP = 28, LBL = banded ? 120 : 16 + sideW('left');
    const place = (row) => { let x = 0; row.forEach((n) => { n.x = x; x += n.w + GAP; }); row.width = x - GAP; };
    rows.forEach(place);
    const sweep = (ri, ref) => {
      const row = rows[ri];
      const bary = (n) => {
        const xs = edges.flatMap((e) => (e.from === n.id ? [byId.get(e.to)] : e.to === n.id ? [byId.get(e.from)] : []))
          .filter((m) => ref.includes(m.ri)).map((m) => m.x + m.w / 2 + (rows[m.ri].width ? -rows[m.ri].width / 2 : 0));
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      };
      const keyed = row.map((n, i) => ({ n, i, b: bary(n) }));
      keyed.sort((a, b) => (a.b == null || b.b == null ? a.i - b.i : a.b - b.b || a.i - b.i));
      row.splice(0, row.length, ...keyed.map((k) => k.n));
      place(row);
    };
    for (let ri = 1; ri < rows.length; ri++) sweep(ri, [ri - 1]);
    for (let ri = rows.length - 2; ri >= 0; ri--) sweep(ri, [ri + 1]);
    for (let ri = 1; ri < rows.length; ri++) sweep(ri, [ri - 1, ri - 2]);
    const inner = Math.max(...rows.map((r) => r.width), 200);
    const W = LBL + inner + 24 + sideW('right');
    rows.forEach((row) => { const off = LBL + (inner - row.width) / 2; row.forEach((n) => { n.x += off; n.h = NH(n); }); row.h = Math.max(...row.map(NH)); });

    // Ports: edges sharing a side of a box spread across its middle, ordered by where the other end sits.
    const sideOf = (e, n) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a.ri === b.ri) return 'top';
      return (n === a) === (a.ri < b.ri) ? 'bottom' : 'top';
    };
    const ports = new Map(), portX = new Map();
    edges.forEach((e) => {
      if (e.from === e.to || e.side) return;
      [[byId.get(e.from), byId.get(e.to)], [byId.get(e.to), byId.get(e.from)]].forEach(([n, other]) => {
        const k = n.id + ':' + sideOf(e, n);
        if (!ports.has(k)) ports.set(k, []);
        ports.get(k).push({ e, n, ox: other.x + other.w / 2 });
      });
    });
    ports.forEach((list) => {
      list.sort((p, q) => p.ox - q.ox);
      list.forEach((p, i) => {
        const span = p.n.shape === 'decision' ? 0 : Math.min(p.n.w - 28, (list.length - 1) * 18);
        portX.set(p.e, Object.assign(portX.get(p.e) || {}, {
          [p.n === byId.get(p.e.from) ? 'a' : 'b']: p.n.x + p.n.w / 2 + (list.length > 1 ? -span / 2 + span * i / (list.length - 1) : 0),
        }));
      });
    });
    // A lane through a row: the x nearest `want` that clears every box in it.
    const lanes = [];
    const laneThrough = (ris, want) => {
      let free = [[-Infinity, Infinity]];
      ris.forEach((ri) => rows[ri].forEach((n) => {
        const l = n.x - 12, r = n.x + n.w + 12;
        free = free.flatMap(([a, b]) => (r <= a || l >= b ? [[a, b]] : [[a, l], [r, b]].filter(([p, q]) => q - p > 0)));
      }));
      let best = want, cost = Infinity;
      free.forEach(([a, b]) => {
        let x = Math.min(Math.max(want, a + 6), b - 6);
        while (lanes.some((u) => Math.abs(u - x) < 7) && x + 8 < b) x += 8;
        if (Math.abs(x - want) < cost) { cost = Math.abs(x - want); best = x; }
      });
      lanes.push(best);
      return best;
    };
    // Each edge is a list of points with symbolic y's ({gap, track} for runs across a gap), resolved once
    // the tracks in every gap are known. Gap g sits below row g; gap -1 sits above the first row.
    const runs = new Map(); // gap -> [{lo, hi, ref}]
    const addRun = (gap, x1, x2) => {
      const ref = { gap, t: 0 };
      if (Math.abs(x1 - x2) > 0.5) { if (!runs.has(gap)) runs.set(gap, []); runs.get(gap).push({ lo: Math.min(x1, x2), hi: Math.max(x1, x2), ref }); }
      return ref;
    };
    const colL = Math.min(...nodes.map((n) => n.x)), colR = Math.max(...nodes.map((n) => n.x + n.w)), sideN = { left: 0, right: 0 };
    const routes = edges.map((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a === b) return { e, self: true };
      if (e.side) {
        const k = sideN[e.side]++, R = e.side === 'right';
        const x = R ? colR + 22 + k * 14 : colL - 22 - k * 14, ax = R ? a.x + a.w : a.x, bx = R ? b.x + b.w : b.x;
        const lw = e.label ? tw(e.label, 11) + 12 : 0;
        return { e, pts: [[ax, { mid: a }], [x, { mid: a }], [x, { mid: b }], [bx, { mid: b }]], lbl: { x: R ? x + 6 + lw / 2 : x - 6 - lw / 2, side: [a, b] } };
      }
      const pa = portX.get(e).a, pb = portX.get(e).b;
      if (a.ri === b.ri) {
        const g = addRun(a.ri - 1, pa, pb);
        return { e, pts: [[pa, { top: a }], [pa, g], [pb, g], [pb, { top: b }]], lbl: { x: (pa + pb) / 2, g } };
      }
      const down = a.ri < b.ri, u = down ? a : b, l = down ? b : a, ux = down ? pa : pb, lx = down ? pb : pa;
      let pts, lbl;
      if (l.ri - u.ri === 1) {
        const g = addRun(u.ri, ux, lx);
        pts = [[ux, { bottom: u }], [ux, g], [lx, g], [lx, { top: l }]];
        lbl = { x: (ux + lx) / 2, g };
      } else {
        const mid = [];
        for (let r = u.ri + 1; r < l.ri; r++) mid.push(r);
        const lane = laneThrough(mid, (ux + lx) / 2);
        const g1 = addRun(u.ri, ux, lane), g2 = addRun(l.ri - 1, lane, lx);
        pts = [[ux, { bottom: u }], [ux, g1], [lane, g1], [lane, g2], [lx, g2], [lx, { top: l }]];
        lbl = Math.abs(ux - lane) >= Math.abs(lane - lx) ? { x: (ux + lane) / 2, g: g1 } : { x: (lane + lx) / 2, g: g2 };
      }
      return { e, pts: down ? pts : pts.reverse(), lbl };
    });
    // Tracks: runs that overlap in a gap get their own heights, the widest nearest the middle.
    const tracks = new Map();
    runs.forEach((list, gap) => {
      const used = [];
      list.sort((p, q) => (q.hi - q.lo) - (p.hi - p.lo)).forEach((r) => {
        let t = 0;
        // Runs that only meet end to end (a decision's yes going left, no going right) share a track.
        const clash = (o) => (r.lo === o.hi || r.hi === o.lo ? false : r.lo < o.hi + 12 && r.hi > o.lo - 12);
        while ((used[t] || []).some(clash)) t++;
        (used[t] = used[t] || []).push(r);
        r.ref.t = t;
      });
      tracks.set(gap, used.length);
    });
    const TR = 12, gapH = (g) => Math.max(g === -1 ? 0 : 58, 30 + (tracks.get(g) || 0) * TR);
    let y = tracks.has(-1) ? gapH(-1) : 16;
    rows.forEach((row, ri) => {
      row.y = y;
      row.forEach((n) => { n.y = y + (row.h - n.h) / 2; });
      y += row.h + (ri < rows.length - 1 ? gapH(ri) : 16);
    });
    const H = y;
    const gapTop = (g) => (g === -1 ? 0 : rows[g].y + rows[g].h);
    const trackY = (ref) => {
      const n = tracks.get(ref.gap) || 1, top = gapTop(ref.gap), h = gapH(ref.gap);
      return top + h / 2 + (ref.t - (n - 1) / 2) * TR;
    };
    const yOf = (v) => (typeof v === 'number' ? v : v.mid ? v.mid.y + v.mid.h / 2 : v.top ? v.top.y : v.bottom ? v.bottom.y + v.bottom.h : trackY(v));

    const used = new Set();
    let svg = '', labels = '', over = '';
    rows.forEach((row, ri) => {
      if (banded && rowLayer[ri]) {
        svg += '<rect class="dband" x="4" y="' + (row.y - 10) + '" width="' + (W - 8) + '" height="' + (row.h + 20) + '" rx="6"/>' +
          '<text class="dlayer" x="16" y="' + (row.y + row.h / 2 + 4) + '">' + esc(rowLayer[ri]) + '</text>';
      }
    });
    const lbls = [];
    const firstStep = (n) => Math.min(...(steps(n.step).length ? steps(n.step) : [0]));
    routes.forEach((r) => {
      const e = r.e, a = byId.get(e.from), b = byId.get(e.to), s = st(e.status);
      used.add(s);
      let p, lx, ly;
      if (r.self) {
        const x = a.x + a.w, y0 = a.y + a.h / 2;
        p = rounded([[x, y0 - 8], [x + 22, y0 - 8], [x + 22, y0 + 8], [x + 2, y0 + 8]], 6);
        lx = x + 28 + tw(e.label, 11) / 2; ly = y0;
      } else {
        p = rounded(r.pts.map(([x, v]) => [x, yOf(v)]), 16);
        lx = r.lbl.x; ly = r.lbl.side ? (r.lbl.side[0].y + r.lbl.side[0].h / 2 + r.lbl.side[1].y + r.lbl.side[1].h / 2) / 2 : trackY(r.lbl.g);
      }
      // An edge with no step of its own appears with the later of its two ends.
      const own = steps(e.step), at = own.length ? own : [Math.max(firstStep(a), firstStep(b))].filter(Boolean);
      svg += '<path class="de ' + s + '" d="' + p + '" marker-end="url(#' + id + '-' + s + ')"' +
        partAttrs(Object.assign({}, e, { step: at }), (a.label || e.from) + ' → ' + (b.label || e.to) + (e.label ? ': ' + e.label : '')) +
        ' data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '"/>';
      // A wide, invisible twin takes the pointer, so a 1px line is easy to hover and click.
      svg += '<path class="dhit" d="' + p + '"' + partAttrs(Object.assign({}, e, { step: at }), (a.label || e.from) + ' → ' + (b.label || e.to) + (e.label ? ': ' + e.label : '')) +
        ' data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '"/>';
      if (e.label) lbls.push({ x: lx, y: ly, w: tw(e.label, 11) + 12, text: e.label, s, at, pin: e.pin, side: !!e.side, from: e.from, to: e.to });
      else if (e.pin != null) over += '<g' + partAttrs({ step: at }, (a.label || e.from) + ' → ' + (b.label || e.to)) + '>' + pinSvg(lx, ly, e.pin) + '</g>';
    });
    // Labels sit on their line's run across the gap, nudged along it until clear of boxes and each other.
    const boxes = nodes.map((n) => ({ l: n.x - 4, r: n.x + n.w + 4, t: n.y - 4, b: n.y + n.h + 4 }));
    const hit = (q, list) => list.some((o) => q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t);
    const placedL = [];
    lbls.forEach((L) => {
      const at = (dx, dy) => { const x = Math.min(Math.max(L.x + dx, (banded ? LBL : 0) + L.w / 2 + 4), W - L.w / 2 - 4); return { x, l: x - L.w / 2, r: x + L.w / 2, t: L.y + dy - 8, b: L.y + dy + 8 }; };
      const tries = L.side ? [[0, 0], [0, -18], [0, 18], [0, -36], [0, 36]] : [[0, 0], [-40, 0], [40, 0], [-80, 0], [80, 0], [0, -14], [0, 14], [-120, 0], [120, 0]];
      const ok = tries.find(([dx, dy]) => !hit(at(dx, dy), boxes) && !hit(at(dx, dy), placedL)) || [0, 0];
      const q = at(ok[0], ok[1]);
      placedL.push(q);
      labels += '<g' + partAttrs({ step: L.at }, L.text) + ' data-from="' + esc(L.from) + '" data-to="' + esc(L.to) + '">' + label(q.x, q.t + 8, L.text, L.s) +
        (L.pin != null ? pinSvg(q.l - 4, q.t + 8, L.pin) : '') + '</g>';
    });
    nodes.forEach((n) => {
      used.add(n.status);
      const cx = n.x + n.w / 2 + (marked(n) ? 6 : 0);
      const shape = n.shape === 'decision'
        ? '<polygon points="' + [[cx - 6 * marked(n), n.y], [n.x + n.w, n.y + n.h / 2], [n.x + n.w / 2, n.y + n.h], [n.x, n.y + n.h / 2]].map((q) => q.join(',')).join(' ') + '"/>'
        : '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="' + (['start', 'end', 'state'].includes(n.shape) ? n.h / 2 : 6) + '"/>';
      svg += '<g class="dn ' + n.status + (n.shape ? ' ' + esc(n.shape) : '') + '"' + partAttrs(n, n.label || n.id) + ' data-id="' + esc(n.id) + '"' +
        (n.note ? ' data-note="' + esc(n.note) + '"' : '') + '>' + shape +
        // The status shows as a dot inside the box rather than a tag above it, where arrows arrive.
        (marked(n) ? '<circle class="ddot" cx="' + (n.x + (['start', 'end', 'state'].includes(n.shape) ? 18 : 14)) + '" cy="' + (n.y + (n.sub ? 18 : n.h / 2)) + '" r="3.5"/>' : '') +
        '<text x="' + cx + '" y="' + (n.y + (n.sub ? 22 : n.h / 2 + 4.5)) + '" text-anchor="middle">' + esc(n.label || n.id) + '</text>' +
        (n.sub ? '<text class="dsub" x="' + cx + '" y="' + (n.y + 40) + '" text-anchor="middle">' + esc(n.sub) + '</text>' : '') +
        '</g>';
      if (n.pin != null) over += '<g' + partAttrs(n, n.label || n.id) + '>' + pinSvg(n.shape === 'decision' ? n.x + n.w / 2 : n.x + 2, n.y + 2, n.pin) + '</g>';
    });
    return '<svg class="dsvg' + (banded ? ' banded' : '') + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%" role="img">' +
      arrowDefs(id) + svg + labels + over + '</svg>' + legend(used);
  }

  // --- flow and states: ranked from the edges ------------------------------
  // The author names nodes and edges; the rank of each node is its longest path from a start, ignoring
  // the edges that loop back, so a flow reads top to bottom and a retry or a "back to draft" arrow
  // climbs instead of tangling the order.
  function ranked(d, shape) {
    const nodes = (d.nodes || d.states || []).map((n) => (typeof n === 'string' ? { id: n, label: n } : n));
    const edges = (d.edges || d.transitions || []).map(edgeOf);
    const ids = new Set(nodes.map((n) => n.id));
    const out = new Map(nodes.map((n) => [n.id, []]));
    edges.forEach((e) => { if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) out.get(e.from).push(e.to); });
    const seen = new Map(), back = new Set(), order = [];
    const visit = (u) => {
      seen.set(u, 1);
      out.get(u).forEach((v) => { if (seen.get(v) === 1) back.add(u + '>' + v); else if (!seen.get(v)) visit(v); });
      seen.set(u, 2); order.push(u);
    };
    nodes.filter((n) => n.shape === 'start' || n.initial).concat(nodes).forEach((n) => { if (!seen.get(n.id)) visit(n.id); });
    const rank = new Map(nodes.map((n) => [n.id, 0]));
    order.reverse().forEach((u) => out.get(u).forEach((v) => { if (!back.has(u + '>' + v)) rank.set(v, Math.max(rank.get(v), rank.get(u) + 1)); }));
    const layers = [...new Set(rank.values())].sort((a, b) => a - b).map((r) => 'r' + r);
    return structure(Object.assign({}, d, { bands: false, ranked: true, layers, edges,
      nodes: nodes.map((n) => Object.assign({ shape: n.initial ? 'start' : n.final ? 'end' : shape }, n, { layer: 'r' + rank.get(n.id) })) }));
  }

  // --- table: rows and columns, changed cells marked ----------------------
  // A cell is a value, or { "v": value, "was": old value, "status" }. The first column heads its row.
  function table(d) {
    const used = new Set();
    const cell = (c, i) => {
      const o = c && typeof c === 'object' ? c : { v: c }, s = st(o.status), tag = i ? 'td' : 'th scope="row"';
      used.add(s);
      return '<' + tag + (s !== 'same' ? ' class="' + s + '"' : '') + '>' + (o.was != null ? '<s>' + esc(o.was) + '</s> ' : '') + esc(o.v != null ? o.v : '') + '</' + tag.split(' ')[0] + '>';
    };
    const rows = (d.rows || []).map((r) => (Array.isArray(r) ? { cells: r } : r));
    rows.forEach((r) => used.add(st(r.status)));
    return '<table class="dtable">' + ((d.columns || []).length ? '<thead><tr>' + d.columns.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead>' : '') +
      '<tbody>' + rows.map((r) => '<tr class="' + st(r.status) + '"' + partAttrs(r, String((r.cells || [])[0] || '')) + '>' + (r.cells || []).map(cell).join('') + '</tr>').join('') +
      '</tbody></table>' + legend(used);
  }

  // --- timeline: events in order along a line -----------------------------
  function timeline(d) {
    const used = new Set();
    const events = (d.events || []).map((e) => (typeof e === 'string' ? { label: e } : e));
    return '<ol class="dtime">' + events.map((e) => {
      const s = st(e.status);
      used.add(s);
      return '<li class="' + s + '"' + partAttrs(e, e.label) + '><span class="dtat">' + esc(e.at || '') + '</span><span class="dtl">' +
        (e.pin != null ? '<span class="dtpin">' + esc(e.pin) + '</span>' : '') + esc(e.label) + '</span>' +
        (e.note ? '<span class="dtn">' + esc(e.note) + '</span>' : '') + '</li>';
    }).join('') + '</ol>' + legend(used);
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
    // A message to itself is labelled to the right of its loop, so leave room past the last actor.
    const selfEnd = Math.max(0, ...steps.filter((m) => !m.divider && m.from === m.to && ix.has(m.from))
      .map((m) => xOf(ix.get(m.from)) + 40 + tw(m.label, 11) + PAD));
    const W = Math.max(PAD * 2 + COL * Math.max(actors.length, 1), selfEnd);
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
      const g = '<g class="dmsgg"' + partAttrs(m, m.label) + ' data-from="' + esc(m.from) + '" data-to="' + esc(m.to) + '">';
      if (a === b) {
        const x = xOf(a);
        body += g + '<path class="' + cls + '" d="' + rounded([[x, y], [x + 34, y], [x + 34, y + 18], [x + 2, y + 18]], 6) + '" marker-end="url(#' + id + '-' + s + ')"/>' +
          '<text class="dmsg" x="' + (x + 40) + '" y="' + (y + 12) + '">' + esc(m.label) + '</text>' + pinSvg(x - 14, y + 9, m.pin) + '</g>';
        y += 40;
      } else {
        const x1 = xOf(a), x2 = xOf(b);
        body += g + '<rect class="dhit" x="' + Math.min(x1, x2) + '" y="' + (y - 6) + '" width="' + Math.abs(x2 - x1) + '" height="24"/>' +
          '<line class="' + cls + '" x1="' + x1 + '" x2="' + (x2 + (x2 > x1 ? -2 : 2)) + '" y1="' + (y + 12) + '" y2="' + (y + 12) +
          '" marker-end="url(#' + id + '-' + s + ')"/><text class="dmsg" x="' + (x1 + x2) / 2 + '" y="' + (y + 6) + '" text-anchor="middle">' +
          esc(m.label) + '</text>' + pinSvg(Math.min(x1, x2) - 14, y + 12, m.pin) + '</g>';
        y += 34;
      }
    });
    const H = y + 20;
    let head = '';
    actors.forEach((a, i) => {
      used.add(a.status);
      const x = xOf(i), w = Math.min(COL - 16, tw(a.label || a.id, 13) + 24);
      head += '<line class="dlife" x1="' + x + '" x2="' + x + '" y1="44" y2="' + (H - 8) + '"/>' +
        '<g class="dn ' + a.status + '"' + partAttrs(a, a.label || a.id) + ' data-id="' + esc(a.id) + '"><title>' + esc(a.note || a.label || a.id) + '</title><rect x="' + (x - w / 2) + '" y="8" width="' + w +
        '" height="34" rx="6"/><text x="' + x + '" y="30" text-anchor="middle">' + esc(a.label || a.id) + '</text></g>' + pinSvg(x - w / 2 + 2, 10, a.pin);
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
    '.box.removed,.removed{border-color:var(--del-b);border-style:dashed;opacity:.85}.box.removed{color:var(--del-b)}' +
    '.arrow::before{content:"\\2192";color:var(--muted);font-size:18px}.down::before{content:"\\2193";color:var(--muted);font-size:18px}' +
    // A flex column stretches its children, which would put an arrow's glyph at the left edge.
    '.down{text-align:center}.col>.down,.col>.arrow{align-self:center}' +
    '.muted{color:var(--muted)}.small{font-size:12px}.title{font-weight:600;margin-bottom:4px}' +
    '.tag{font-size:10px;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--border);border-radius:20px;padding:0 6px;color:var(--muted)}' +
    '.add{color:var(--add-b)}.del{color:var(--del-b)}.accent{color:var(--accent)}' +
    'code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}' +
    'table{border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}th{background:var(--panel)}' +
    'svg{max-width:100%;height:auto;overflow:visible}svg text{fill:var(--text);font:12px -apple-system,BlinkMacSystemFont,sans-serif}' +
    'svg .muted{fill:var(--muted)}svg .s-new{stroke:var(--add-b)}svg .s-old{stroke:var(--del-b);stroke-dasharray:5 4}' +
    'svg .s-changed{stroke:#d29922}svg .s-muted{stroke:var(--muted)}svg .s-accent{stroke:var(--accent)}' +
    'svg .f-new{fill:var(--add-bg)}svg .f-old{fill:var(--del-bg)}svg .f-panel{fill:var(--panel)}svg .f-accent{fill:var(--accent)}' +
    // Sketching: rough UI, notes and marks for drawing the picture a review is missing (a screen that
    // can't be captured, a record before and after, a timeline). Deliberately plain, so it reads as a sketch.
    '.screen{border:1px solid var(--border);border-radius:8px;background:var(--bg);overflow:hidden}' +
    '.screen>.bar{display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);background:var(--panel);font-size:11px;color:var(--muted)}' +
    '.screen>.bar::before{content:"";width:28px;height:7px;flex:none;background:radial-gradient(circle,var(--border) 3px,transparent 3.5px) 0 0/10px 7px repeat-x}' +
    '.screen>.body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}' +
    '.ui-btn{display:inline-block;border:1px solid var(--border);border-radius:6px;padding:2px 10px;font-size:12px;background:var(--panel)}' +
    '.ui-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--bg)}' +
    '.ui-input{display:inline-block;min-width:90px;border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:12px;color:var(--muted);background:var(--bg)}' +
    '.ui-line{height:7px;border-radius:4px;background:var(--border);width:var(--w,60%)}' +
    '.ui-img{border:1px dashed var(--border);border-radius:6px;min-height:40px;display:grid;place-items:center;color:var(--muted);font-size:11px}' +
    '.hl{outline:2px dashed var(--accent);outline-offset:3px;border-radius:4px}.hl.new{outline-color:var(--add-b)}.hl.removed{outline-color:var(--del-b)}' +
    '.ghost{opacity:.45}.box.ghost,.ui-btn.ghost,.ui-img.ghost,.screen.ghost{border-style:dashed}' +
    '.note{display:inline-block;max-width:28ch;padding:5px 9px;border-radius:6px;font-size:12px;background:color-mix(in srgb,#d29922 16%,var(--bg));border:1px solid color-mix(in srgb,#d29922 45%,var(--border))}' +
    '.pin{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--accent);color:var(--bg);font-size:11px;font-weight:600;vertical-align:middle}' +
    '.timeline{display:flex;align-items:flex-start}.timeline>*{flex:1;position:relative;padding:16px 8px 0;font-size:12px}' +
    '.timeline>*::before{content:"";position:absolute;top:4px;left:8px;width:9px;height:9px;border-radius:50%;background:var(--accent)}' +
    '.timeline>*::after{content:"";position:absolute;top:8px;left:20px;right:-4px;height:1px;background:var(--border)}.timeline>:last-child::after{display:none}' +
    '.timeline>.new::before{background:var(--add-b)}.timeline>.removed::before{background:var(--del-b)}.timeline>.ghost::before{background:var(--muted)}' +
    '.meter{display:grid;max-width:480px;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;font-size:12px}' +
    '.meter>i{display:block;height:10px;border-radius:3px;background:var(--accent);width:var(--v,50%)}.meter>i.new{background:var(--add-b)}.meter>i.removed{background:var(--del-b)}' +
    '.cross{color:var(--del-b)}' +
    // More of the app, sketched: frames, controls, overlays and a pointer, for drawing a screen the
    // review couldn't capture with the parts that matter outlined.
    '.screen.browser>.bar::after{content:attr(data-url);flex:1;margin-left:6px;padding:1px 8px;border-radius:10px;background:var(--bg);border:1px solid var(--border);font:11px ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.phone{width:var(--w,190px);border:1px solid var(--border);border-radius:22px;padding:14px 8px;background:var(--panel)}.phone>.body{border:1px solid var(--border);border-radius:12px;background:var(--bg);padding:10px;display:flex;flex-direction:column;gap:8px;min-height:var(--h,0)}' +
    '.ui-select{display:inline-flex;justify-content:space-between;gap:12px;min-width:110px;border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:12px;background:var(--bg)}.ui-select::after{content:"\\25BE";color:var(--muted)}' +
    '.ui-check,.ui-radio{display:inline-flex;align-items:center;gap:6px;font-size:12px}.ui-check::before,.ui-radio::before{content:"";width:11px;height:11px;border:1px solid var(--muted);border-radius:2px;background:var(--bg)}' +
    '.ui-radio::before{border-radius:50%}.ui-check.on::before,.ui-radio.on::before{background:var(--accent);border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--bg)}' +
    '.ui-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px}.ui-toggle::before{content:"";width:24px;height:13px;border-radius:7px;background:radial-gradient(circle at 6px 50%,var(--bg) 4px,var(--border) 4.5px)}' +
    '.ui-toggle.on::before{background:radial-gradient(circle at 18px 50%,var(--bg) 4px,var(--accent) 4.5px)}' +
    '.ui-tabs{display:flex;gap:14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)}.ui-tabs>*{padding:3px 0}.ui-tabs>.on{color:var(--text);box-shadow:inset 0 -2px var(--accent)}' +
    '.ui-nav{display:flex;flex-direction:column;gap:2px;font-size:12px;min-width:110px}.ui-nav>*{padding:3px 8px;border-radius:4px;color:var(--muted)}.ui-nav>.on{background:var(--panel);color:var(--text)}' +
    '.ui-menu{display:inline-flex;flex-direction:column;border:1px solid var(--border);border-radius:6px;background:var(--bg);padding:4px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.18)}.ui-menu>*{padding:3px 10px;border-radius:3px}.ui-menu>.on{background:var(--panel)}' +
    '.ui-toast{width:max-content;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border);border-left-width:3px;border-radius:6px;padding:5px 10px;font-size:12px;background:var(--bg)}.ui-toast.new{border-left-color:var(--add-b)}.ui-toast.removed{border-left-color:var(--del-b)}' +
    '.ui-banner{border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;background:var(--panel)}' +
    '.ui-chip{display:inline-block;border:1px solid var(--border);border-radius:11px;padding:0 8px;font-size:11px;background:var(--panel)}' +
    '.ui-avatar{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--border);font-size:10px;font-weight:600}' +
    '.ui-badge{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--accent);color:var(--bg);font-size:10px;font-weight:600}' +
    '.ui-card{border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--bg);display:flex;flex-direction:column;gap:6px}' +
    '.ui-empty{border:1px dashed var(--border);border-radius:8px;padding:14px;text-align:center;color:var(--muted);font-size:12px}' +
    '.ui-table{border-collapse:collapse;width:100%;font-size:12px}.ui-table th,.ui-table td{border:0;border-bottom:1px solid var(--border);padding:4px 8px}.ui-table th{background:none;color:var(--muted);font-weight:500}' +
    'tr.new,tr.removed,tr.changed{border:0;opacity:1}tr.new td{background:var(--add-bg)}tr.removed td{background:var(--del-bg);text-decoration:line-through;color:var(--muted)}tr.changed td,td.changed{box-shadow:inset 2px 0 #d29922}' +
    '.scrim{position:relative;padding:18px;background:color-mix(in srgb,var(--text) 14%,var(--bg));border-radius:6px;display:grid;place-items:center}' +
    '.modal{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;min-width:180px;display:flex;flex-direction:column;gap:8px}.modal>.title{margin:0}' +
    '.cursor{display:inline-block;width:12px;height:16px;vertical-align:middle;background:var(--text);clip-path:polygon(0 0,0 100%,30% 72%,52% 100%,64% 94%,44% 66%,85% 66%)}' +
    '.click{position:relative}.click::after{content:"";position:absolute;right:-8px;bottom:-12px;width:12px;height:16px;background:var(--text);clip-path:polygon(0 0,0 100%,30% 72%,52% 100%,64% 94%,44% 66%,85% 66%);filter:drop-shadow(0 0 1px var(--bg))}' +
    // The data and the code behind the screen: a record, a payload, a chain of steps.
    // A record as a person would read it: a card of labelled values, the changed ones marked.
    '.record{border:1px solid var(--border);border-radius:8px;font-size:12.5px;background:var(--bg);min-width:180px;padding:4px 0}' +
    '.record>.title{margin:0;padding:6px 12px 8px;font-weight:600;font-size:13px}' +
    '.record>div:not(.title){display:flex;justify-content:space-between;gap:16px;padding:5px 12px;border:0;border-top:1px solid var(--border);border-radius:0}' +
    '.record>div>:first-child{color:var(--muted)}' +
    '.record>.new{background:var(--add-bg)}.record>.removed{background:var(--del-bg);opacity:1}.record>.removed>:last-child{text-decoration:line-through;color:var(--muted)}' +
    '.record>.changed{box-shadow:inset 3px 0 #d29922}' +
    '.flow{display:flex;align-items:center;flex-wrap:wrap;gap:8px 28px}.flow>*{position:relative}.flow>:not(:last-child)::after{content:"\\2192";position:absolute;right:-21px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:16px}' +
    '.flow.v{flex-direction:column;align-items:center;gap:22px}.flow.v>:not(:last-child)::after{content:"\\2193";right:auto;left:50%;top:auto;bottom:-21px;transform:translateX(-50%)}' +
    '.state{display:inline-block;border:1px solid var(--border);border-radius:14px;padding:2px 12px;font-size:12px;background:var(--panel)}.state.new{border-color:var(--add-b)}.state.removed{border-color:var(--del-b);border-style:dashed}.state.changed{border-color:#d29922}' +
    '.split{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding-top:20px}.split>*{position:relative}' +
    '.split>*::before{position:absolute;left:0;top:-20px;font-size:11px;color:var(--muted)}.split>:first-child::before{content:"Before"}.split>:last-child::before{content:"After"}' +
    // Parts a diagram tags with data-step build up with the steps, the same as nodes and arrows.
    '[data-reveal]{transition:opacity .45s ease}[data-reveal=is-future]{opacity:0!important}[data-reveal=is-past]{opacity:.32!important}' +
    '';
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

  // Marks: rings and pins over a screenshot, a recording or a sketch, placed in percent of its box,
  // so "this button" points at the button instead of a red rectangle drawn into the image.
  function marksHtml(list) {
    return (list || []).map((m) => {
      const area = m.at || (m.w != null && m.h != null), s = STATUS.includes(m.status) ? m.status : 'look';
      return '<div class="dmark ' + s + (area ? '' : ' point') + '"' + partAttrs(m, m.label || (m.pin != null ? 'Mark ' + m.pin : 'Mark')) +
        (m.at ? ' data-at="' + esc(m.at) + '" style="visibility:hidden">'
          : ' style="left:' + (+m.x || 0) + '%;top:' + (+m.y || 0) + '%' + (area ? ';width:' + (+m.w) + '%;height:' + (+m.h) + '%' : '') + '">') +
        (m.pin != null ? '<span class="dmpin">' + esc(m.pin) + '</span>' : '') + (m.label ? '<span class="dmlbl">' + esc(m.label) + '</span>' : '') + '</div>';
    }).join('');
  }
  const staged = (inner, d) => (d.marks && d.marks.length ? '<div class="dstage">' + inner + marksHtml(d.marks) + '</div>' +
    legend(new Set(d.marks.map((m) => m.status).filter((x) => STATUS.includes(x)))) : inner);

  // A mark on a sketch can name its target, `"at": ".ui-select"`, instead of coordinates: it is placed
  // around that element once the sketch is laid out, and again whenever it resizes.
  function placeMarks(stage) {
    const host = stage.querySelector('.draw'), root = host && host.shadowRoot;
    if (!root) return;
    const sr = stage.getBoundingClientRect();
    stage.querySelectorAll('.dmark[data-at]').forEach((m) => {
      let el = null;
      try { el = root.querySelector(m.dataset.at); } catch (e) { /* a bad selector leaves the mark hidden */ }
      if (!el || !sr.width) return;
      const r = el.getBoundingClientRect(), z = parseFloat(getComputedStyle(host).zoom) || 1, k = 1 / (z || 1);
      Object.assign(m.style, { left: ((r.left - sr.left) * k - 4) + 'px', top: ((r.top - sr.top) * k - 4) + 'px',
        width: (r.width * k + 8) + 'px', height: (r.height * k + 8) + 'px', visibility: '' });
    });
  }
  function watchMarks(box) {
    const stage = box.querySelector('.dstage');
    if (!stage || !stage.querySelector('.dmark[data-at]') || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(() => placeMarks(stage)).observe(stage);
  }

  function body(d) {
    const box = document.createElement('div');
    box.className = 'dbody';
    if (d.kind === 'structure') box.innerHTML = structure(d);
    else if (d.kind === 'sequence') box.innerHTML = sequence(d);
    else if (d.kind === 'flow') box.innerHTML = ranked(d, 'step');
    else if (d.kind === 'states') box.innerHTML = ranked(d, 'state');
    else if (d.kind === 'table') box.innerHTML = table(d);
    else if (d.kind === 'timeline') box.innerHTML = timeline(d);
    else if (d.kind === 'compare' && d.before && d.after && d.side !== true && !['image', 'video'].includes(d.before.kind)) {
      // Two drawings, one at a time at full size, with a switch: flipping shows what moved, where
      // side by side halves each picture and leaves the reader to match them up by eye.
      box.className = 'dbody dflip';
      const names = [(d.before.title || 'Before'), (d.after.title || 'After')];
      box.innerHTML = '<div class="dflipsw" role="tablist">' + names.map((t, i) => '<button type="button" role="tab" data-flip="' + i + '"' +
        (i ? ' class="on" aria-selected="true"' : '') + '>' + esc(t) + '</button>').join('') + '</div>';
      ['before', 'after'].forEach((k, i) => {
        const side = document.createElement('div');
        side.className = 'dflipside' + (i ? ' on' : '');
        side.appendChild(body(Object.assign({}, d[k], { title: null })));
        box.appendChild(side);
      });
    } else if (d.kind === 'compare') {
      box.className = 'dbody dcompare';
      [['before', 'Before'], ['after', 'After']].forEach(([k, t]) => {
        const side = document.createElement('div');
        side.className = 'dside ' + k;
        const label = (d[k] && d[k].title) || t;
        side.innerHTML = '<div class="dsidet">' + esc(label) + '</div>';
        // Each side expands on its own: one picture, larger, rather than the pair squeezed into the window.
        if (d[k] && d[k].kind !== 'image') {
          side.insertAdjacentHTML('afterbegin', '<button type="button" class="dexpand" title="Expand" aria-label="Expand ' + esc(label) + '">&#10530;</button>');
          side.diag = Object.assign({}, d[k], { title: (d.title ? d.title + ': ' : '') + (d[k].title ? d[k].title : t) });
        }
        if (d[k]) side.appendChild(body(d[k]));
        box.appendChild(side);
      });
    } else if (d.kind === 'html' || d.kind === 'svg') {
      if (d.marks && d.marks.length) { box.innerHTML = staged('<i class="draw-slot"></i>', d); box.querySelector('.draw-slot').replaceWith(raw(d.html || d.svg)); watchMarks(box); }
      else box.appendChild(raw(d.html || d.svg));
    }
    else if (d.kind === 'image' || d.kind === 'video') {
      box.className = 'dbody dmedia';
      // Only data URLs from the build: anything else would fetch from a host the page didn't choose.
      if (!/^data:(?:image|video)\//.test(d.data || '')) box.innerHTML = '<p class="svnote">Missing ' + d.kind + ': ' + esc(d.src || '') + '</p>';
      else if (d.kind === 'image') box.innerHTML = staged('<img src="' + esc(d.data) + '" alt="' + esc(d.alt || d.title || '') + '" title="Click to enlarge">', d);
      else box.innerHTML = staged('<video src="' + esc(d.data) + '" controls muted loop playsinline preload="metadata"></video>', d);
    }
    else box.innerHTML = '<p class="svnote">Unknown diagram kind: ' + esc(d.kind) + '</p>';
    if (['structure', 'flow', 'states', 'sequence'].includes(d.kind)) box.insertAdjacentHTML('beforeend', '<div class="dhover" aria-live="polite"></div>');
    return box;
  }

  // A titled figure with its caption rendered as Markdown.
  // A drawn diagram has an expand button in its corner rather than opening on any click, so its text
  // stays selectable. A screenshot opens on click, as before. The page keeps `d` on the figure to
  // draw it again, larger (a raw diagram's shadow root doesn't survive cloneNode).
  function render(d, md, opts) {
    const fig = document.createElement('figure');
    fig.className = d.kind === 'image' || d.kind === 'video' ? 'diagram media' : 'diagram';
    fig.diag = d; fig.md = md;
    if (d.kind !== 'image' && d.kind !== 'compare' && !(opts && opts.big))
      fig.insertAdjacentHTML('beforeend', '<button type="button" class="dexpand" title="Expand" aria-label="Expand diagram">&#10530;</button>');
    if (d.title) fig.insertAdjacentHTML('beforeend', '<figcaption class="dtitle">' + esc(d.title) + '</figcaption>');
    fig.appendChild(body(d));
    // A diagram that builds gets its steps as breadcrumbs under it, and moves through them in place.
    if (!(opts && opts.plain) && isStaged(d) && stageCount(d)) {
      fig.classList.add('builds');
      fig.insertAdjacentHTML('beforeend', stepperHtml(stagesOf(d)));
      fig.go = (k) => { focus(fig, k); markStepper(fig.querySelector(':scope > .dsteps'), k); };
      markStepper(fig.querySelector(':scope > .dsteps'), 0);
    }
    if (d.caption) fig.insertAdjacentHTML('beforeend', '<div class="dcap md">' + (md ? md(d.caption) : esc(d.caption)) + '</div>');
    return fig;
  }

  // Reveal by step. At step n, parts tagged with n are in focus, earlier ones stay faintly as context,
  // later ones are hidden; 0 shows the whole picture. With `pending`, step n's own parts wait hidden
  // too, so a later call can draw them in when the reader arrives.
  function roots(fig) {
    return [fig].concat(Array.from(fig.querySelectorAll('.draw')).map((h) => h.shadowRoot).filter(Boolean));
  }
  function focus(fig, n, pending) {
    if (!fig) return;
    fig.classList.toggle('staged', n > 0);
    fig.dataset.at = n || 0;
    roots(fig).forEach((r) => r.querySelectorAll('[data-step]').forEach((el) => {
      const ss = el.dataset.step.split(' ').map(Number), first = Math.min(...ss);
      const next = !n ? '' : ss.includes(n) ? (pending ? 'is-future' : 'is-focus') : first > n ? 'is-future' : 'is-past';
      const was = el.dataset.reveal || '';
      if (was === next) return;
      if (next) el.dataset.reveal = next; else delete el.dataset.reveal;
      if (next === 'is-focus' && (was === 'is-future' || !was)) drawIn(el);
    }));
  }
  // A diagram that builds: its steps, named by `stages` (or, for the connection map, the steps' titles).
  function stageCount(d) {
    let m = 0;
    JSON.stringify(d || {}, (k, v) => { if (k === 'step') steps(v).forEach((x) => { if (x > m) m = x; }); return v; });
    (((d && (d.html || d.svg)) || '').match(/data-step=["'][\d ]+["']/g) || []).forEach((a) => a.slice(11, -1).split(' ').forEach((x) => { if (+x > m) m = +x; }));
    return m;
  }
  const stagesOf = (d) => Array.from({ length: stageCount(d) }, (_, i) => (d.stages && d.stages[i]) || 'Step ' + (i + 1));
  // Breadcrumbs through the steps: the whole picture, then each step by name. The current one is
  // underlined; the ones before it read as done.
  function stepperHtml(stages) {
    return '<nav class="dsteps" aria-label="Steps"><button type="button" data-go="0">Whole picture</button>' +
      stages.map((t, i) => '<button type="button" data-go="' + (i + 1) + '"><span class="dsn">' + (i + 1) + '</span>' + esc(t) + '</button>').join('') + '</nav>';
  }
  function markStepper(nav, n) {
    if (!nav) return;
    nav.querySelectorAll('[data-go]').forEach((b) => {
      const g = +b.dataset.go;
      b.classList.toggle('on', g === n);
      b.classList.toggle('done', n > 0 && g > 0 && g < n);
      if (g === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }
  // The walkthrough: a building diagram with its breadcrumbs above and previous / next below, for the
  // full-screen view. Arrow keys (the page sends them), the buttons, the crumbs and the scroll wheel
  // move through it.
  function walk(d, md, n) {
    const wrap = document.createElement('div');
    wrap.className = 'dwalk';
    const stages = stagesOf(d);
    wrap.innerHTML = '<div class="dwalkh">' + (d.title ? '<div class="dwalkt">' + esc(d.title) + '</div>' : '') + stepperHtml(stages) + '</div>';
    const fig = render(Object.assign({}, d, { title: null, caption: null }), md, { big: true, plain: true });
    wrap.appendChild(fig);
    wrap.insertAdjacentHTML('beforeend', '<div class="dwalkf"><button type="button" class="quiet" data-walk="-1">Previous <kbd>←</kbd></button>' +
      '<span class="dwalkc"></span><button type="button" class="primary" data-walk="1">Next <kbd>→</kbd></button></div>');
    let at = -1;
    wrap.go = (k) => {
      k = Math.max(0, Math.min(stages.length, k));
      if (k === at) return;
      at = k;
      focus(fig, k);
      markStepper(wrap.querySelector('.dsteps'), k);
      wrap.querySelector('.dwalkc').textContent = k ? 'Step ' + k + ' of ' + stages.length : 'The whole picture';
      wrap.querySelector('[data-walk="-1"]').disabled = k === 0;
      wrap.querySelector('[data-walk="1"]').disabled = k === stages.length;
    };
    wrap.step = (dir) => wrap.go(at + dir);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-walk]'); if (b) wrap.step(+b.dataset.walk); });
    let last = 0;
    wrap.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) < 12 || e.timeStamp - last < 450) return;
      last = e.timeStamp; e.preventDefault();
      wrap.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    wrap.go(n || 0);
    return wrap;
  }

  function drawIn(el) {
    if (!el.animate || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    if (el.matches('path.de') && !el.matches('.removed,.reply') && el.getTotalLength) {
      const L = el.getTotalLength();
      el.animate([{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration: 650, easing: 'cubic-bezier(.3,.7,.2,1)', delay: 120 });
    } else if (!el.matches('.dhit')) el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'ease-out' });
  }
  // Hovering traces: a box lights its lines and neighbours, a line lights its two ends, and the rest
  // steps back. Lit lines flow in their direction, and a line under the picture says what is lit.
  function trace(svg, target) {
    if (!svg) return;
    const box = svg.parentNode, cap = box && box.querySelector(':scope > .dhover');
    svg.classList.toggle('tracing', !!target);
    svg.querySelectorAll('.lit').forEach((x) => x.classList.remove('lit'));
    if (cap) cap.classList.toggle('on', !!target);
    if (!target) return;
    const near = new Set(), name = (id) => { const n = svg.querySelector('[data-id="' + CSS.escape(id) + '"]'); return n ? n.dataset.el : id; };
    let text;
    if (target.id) {
      near.add(target.id);
      const ins = [], outs = [];
      svg.querySelectorAll('[data-from]').forEach((x) => {
        if (x.dataset.from !== target.id && x.dataset.to !== target.id) return;
        x.classList.add('lit'); near.add(x.dataset.from); near.add(x.dataset.to);
        if (x.matches('.de, .dmsgg')) (x.dataset.from === target.id ? outs : ins).push(name(x.dataset.from === target.id ? x.dataset.to : x.dataset.from));
      });
      const n = svg.querySelector('[data-id="' + CSS.escape(target.id) + '"]'), st = n && n.dataset.status;
      text = '<b>' + esc(name(target.id)) + '</b>' + (st ? ' <span class="stag ' + esc(st) + '">' + esc(LEGEND[st] || st) + '</span>' : '') +
        (n && n.dataset.note ? ' · ' + esc(n.dataset.note) : '') +
        (ins.length ? ' · from ' + esc([...new Set(ins)].join(', ')) : '') + (outs.length ? ' · to ' + esc([...new Set(outs)].join(', ')) : '');
    } else {
      svg.querySelectorAll('[data-from]').forEach((x) => { if (x.dataset.from === target.from && x.dataset.to === target.to) x.classList.add('lit'); });
      near.add(target.from); near.add(target.to);
      text = '<b>' + esc(name(target.from)) + '</b> → <b>' + esc(name(target.to)) + '</b>' + (target.label ? ' · ' + esc(target.label) : '');
    }
    svg.querySelectorAll('[data-id]').forEach((x) => { if (near.has(x.dataset.id)) x.classList.add('lit'); });
    if (cap) cap.innerHTML = text;
  }
  // Whether a diagram has anything to build up step by step.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-flip], .dsteps [data-go]');
      if (!b) return;
      if (b.dataset.flip != null) {
        const box = b.closest('.dflip'), i = +b.dataset.flip;
        box.querySelectorAll('[data-flip]').forEach((x) => { x.classList.toggle('on', +x.dataset.flip === i); x.setAttribute('aria-selected', String(+x.dataset.flip === i)); });
        box.querySelectorAll(':scope > .dflipside').forEach((x, j) => x.classList.toggle('on', j === i));
        return;
      }
      const host = b.closest('.dwalk') || b.closest('figure.diagram');
      if (host && host.go) host.go(+b.dataset.go);
    });
  }
  const isStaged = (d) => JSON.stringify(d || {}).includes('"step"') || /data-step=/.test((d && (d.html || d.svg)) || '');

  const KINDS = ['structure', 'flow', 'states', 'sequence', 'compare', 'table', 'timeline', 'html', 'svg', 'image', 'video'];
  // Problems the build reports before writing the page; [] when the diagram is drawable.
  // With ctx ({ steps }), also checks that each step names a real connection step.
  function problems(d, where, ctx) {
    const out = [], at = where || (d && d.title) || 'diagram';
    if (!d || !KINDS.includes(d.kind)) return [at + ': kind must be one of ' + KINDS.join(', ')];
    if (['structure', 'flow', 'states'].includes(d.kind)) {
      const ids = new Set();
      (d.nodes || d.states || []).map((n) => (typeof n === 'string' ? { id: n } : n)).forEach((n) => { if (!n.id) out.push(at + ': a node has no id'); else if (ids.has(n.id)) out.push(at + ': duplicate node ' + n.id); ids.add(n.id); });
      if (!ids.size) out.push(at + ': no nodes');
      (d.edges || d.transitions || []).map(edgeOf).forEach((e) => {
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
      ['before', 'after'].forEach((k) => { if (d[k]) out.push(...problems(d[k], at + ' (' + k + ')', ctx)); });
    } else if (d.kind === 'table') {
      if (!(d.rows || []).length) out.push(at + ': table has no rows');
    } else if (d.kind === 'timeline') {
      if (!(d.events || []).length) out.push(at + ': timeline has no events');
    } else if (d.kind === 'image' || d.kind === 'video') {
      if (!(d.data || d.src)) out.push(at + ': ' + d.kind + ' needs a src file');
    } else if (!(d.html || d.svg)) out.push(at + ': ' + d.kind + ' diagram has no markup');
    (d.marks || []).forEach((m, i) => {
      if (m && m.at && !['html', 'svg'].includes(d.kind)) out.push(at + ': mark ' + (i + 1) + ' uses "at", which only works on html and svg sketches');
      else if (m && m.at) return;
      else if (!m || !['x', 'y'].every((k) => +m[k] >= 0 && +m[k] <= 100)) out.push(at + ': mark ' + (i + 1) + ' needs x and y in percent (0 to 100), or "at" with a selector on a sketch');
      else if ((m.w != null) !== (m.h != null)) out.push(at + ': mark ' + (i + 1) + ' needs both w and h, or neither for a point');
    });
    if (d.stages && (!Array.isArray(d.stages) || d.stages.length < stageCount(d))) out.push(at + ': stages should name each of its ' + stageCount(d) + ' step(s)');
    if (ctx) {
      const obj = (l) => (l || []).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      const parts = [].concat(obj(d.nodes || d.states), obj(d.edges || d.transitions), obj(d.actors), obj(d.messages || d.steps), obj(d.rows), obj(d.events), d.marks || []);
      parts.forEach((o) => {
        const name = o.label || o.id || (o.from ? o.from + ' → ' + o.to : 'a part');
        // A diagram with its own `stages` builds through those; any other names the connection steps.
        const max = d.stages ? d.stages.length : ctx.steps;
        steps(o.step).forEach((n) => { if (max != null && n > max) out.push(at + ': ' + name + ' names step ' + n + ', but there are ' + max); });
      });
    }
    return out;
  }

  const api = { render, body, problems, focus, walk, trace, isStaged, stagesOf, KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
