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
 *   model      records with their fields, and lines from reference fields to what they point at
 *   journey    sketched screens in order, each arrow saying what the person does next
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
  // `link` ("diagram-id", or "diagram-id#part-id") makes a part open another diagram when clicked;
  // `id` lets another diagram's link land on this part.
  const partAttrs = (o, name) => {
    const ss = steps(o.step);
    return ' data-el="' + esc(name || '') + '"' + (ss.length ? ' data-step="' + ss.join(' ') + '"' : '') +
      (o.status && o.status !== 'same' ? ' data-status="' + esc(o.status) + '"' : '') +
      (o.id != null ? ' data-part="' + esc(o.id) + '"' : '') + (o.link ? ' data-link="' + esc(o.link) + '"' : '');
  };
  // A small arrow in a linked box's corner says it opens another picture.
  const linkMark = (o, x, y) => (o.link ? '<text class="dlinkmark" x="' + x + '" y="' + y + '" text-anchor="end">↗</text>' : '');
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
    // Neighbours in one row (nothing between them, once placed) are joined straight across.
    const beside = (e) => { const a = byId.get(e.from), b = byId.get(e.to), row = rows[a.ri]; return a.ri === b.ri && a !== b && Math.abs(row.indexOf(a) - row.indexOf(b)) === 1; };
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
    // Then place each box under the boxes it connects to, so a chain runs straight down instead of
    // jogging sideways across every gap. Rows start centred; each pass pulls a row toward its
    // neighbours' centres, then pushes boxes apart where they'd overlap, keeping their order.
    rows.forEach((row) => row.forEach((n) => { n.x -= row.width / 2; }));
    const cx = (n) => n.x + n.w / 2;
    const align = (ri, ref) => {
      const row = rows[ri];
      const want = row.map((n) => {
        // Neighbours on the side being aligned to count most; those further off still pull, less.
        let sum = 0, wt = 0;
        edges.forEach((e) => {
          const m = e.side ? null : e.from === n.id ? byId.get(e.to) : e.to === n.id ? byId.get(e.from) : null;
          if (!m || m.ri === n.ri || (m.ri - n.ri) * (ref - n.ri) < 0) return;
          const k = 1 / Math.abs(m.ri - n.ri);
          sum += cx(m) * k; wt += k;
        });
        return wt ? sum / wt - n.w / 2 : null;
      });
      const x0 = row.map((n) => n.x);
      row.forEach((n, i) => { if (want[i] != null) n.x = want[i]; });
      for (let i = 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + row[i - 1].w + GAP);
      // The push only goes right; shift the row back so on balance its boxes sit where they wanted to.
      const off = row.reduce((sum, n, i) => sum + ((want[i] != null ? want[i] : x0[i]) - n.x), 0) / row.length;
      row.forEach((n) => { n.x += off; });
    };
    for (let pass = 0; pass < 4; pass++) {
      for (let ri = 1; ri < rows.length; ri++) align(ri, ri - 1);
      for (let ri = rows.length - 2; ri >= 0; ri--) align(ri, ri + 1);
    }
    const minX = Math.min(...nodes.map((n) => n.x)), maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const inner = Math.max(maxX - minX, 200), pad = (inner - (maxX - minX)) / 2;
    const W = LBL + inner + 24 + sideW('right');
    rows.forEach((row) => { row.forEach((n) => { n.x += LBL + pad - minX; n.h = NH(n); }); row.h = Math.max(...row.map(NH)); });

    // Ports: edges sharing a side of a box spread across its middle, ordered by where the other end sits.
    const sideOf = (e, n) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a.ri === b.ri) return 'top';
      return (n === a) === (a.ri < b.ri) ? 'bottom' : 'top';
    };
    const ports = new Map(), portX = new Map();
    edges.forEach((e) => {
      if (e.from === e.to || e.side || beside(e)) return;
      [[byId.get(e.from), byId.get(e.to)], [byId.get(e.to), byId.get(e.from)]].forEach(([n, other]) => {
        const k = n.id + ':' + sideOf(e, n);
        if (!ports.has(k)) ports.set(k, []);
        ports.get(k).push({ e, n, ox: other.x + other.w / 2 });
      });
    });
    ports.forEach((list) => {
      list.sort((p, q) => p.ox - q.ox);
      list.forEach((p, i) => {
        // Lines meeting a box share one point on its side, so they join into a trunk with one
        // arrowhead instead of a fan of them.
        const span = 0;
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
      if (beside(e)) {
        const R = b.x > a.x, y = (n) => ({ mid: n });
        return { e, pts: [[R ? a.x + a.w : a.x, y(a)], [R ? b.x : b.x + b.w, y(a)]], lbl: { x: R ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2, side: [a, a] } };
      }
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
        linkMark(n, n.x + n.w - 6, n.y + 13) + '</g>';
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

  // --- model: records, their fields, and what points at what ----------------
  // A data model as a reviewer reads a migration: each record a card of fields, new and removed
  // fields marked, and a line from each reference field to the record it points at. Records sit in
  // columns by what they depend on, so the records others point at stand on the left.
  function model(d) {
    const id = 'dg' + (++seq);
    const ents = (d.entities || d.records || []).map((e) => Object.assign({}, e, { status: st(e.status), fields: (e.fields || []).map((f) => (typeof f === 'string' ? { name: f } : Object.assign({}, f))) }));
    const byId = new Map(ents.map((e) => [e.id, e]));
    const links = [];
    ents.forEach((e) => e.fields.forEach((f, fi) => { if (f.to && byId.has(f.to)) links.push({ from: e.id, fi, to: f.to, status: st(f.status), label: f.label, step: f.step }); }));
    (d.links || []).map(edgeOf).forEach((l) => { if (byId.has(l.from) && byId.has(l.to)) links.push(Object.assign({}, l, { status: st(l.status) })); });
    // Column: one right of the furthest record it points at.
    const col = new Map(), visiting = new Set();
    const colOf = (e) => {
      if (col.has(e.id)) return col.get(e.id);
      if (visiting.has(e.id)) return 0;
      visiting.add(e.id);
      const c = Math.max(0, ...links.filter((l) => l.from === e.id && l.to !== e.id).map((l) => colOf(byId.get(l.to)) + 1));
      visiting.delete(e.id); col.set(e.id, c);
      return c;
    };
    ents.forEach(colOf);
    const HEAD = 32, ROW = 23;
    ents.forEach((e) => {
      e.w = Math.max(160, tw(e.label || e.id, 13) + 44, ...e.fields.map((f) => tw(f.name, 12) + tw(f.type || '', 11) + tw(f.was ? 'was ' + f.was : '', 10.5) + 52));
      e.h = HEAD + e.fields.length * ROW + 8;
    });
    const cols = [];
    ents.forEach((e) => { (cols[col.get(e.id)] = cols[col.get(e.id)] || []).push(e); });
    // Each line gets a lane of its own in the gap it turns in, so lines never share a vertical run.
    links.forEach((l) => {
      const a = byId.get(l.from), b = byId.get(l.to);
      l.left = col.get(b.id) < col.get(a.id);
      l.gap = l.left ? col.get(a.id) - 1 : col.get(b.id);
    });
    const lanes = [];
    links.forEach((l) => { l.lane = (lanes[l.gap] = (lanes[l.gap] || 0) + 1) - 1; });
    const gapW = (g) => 56 + (lanes[g] || 0) * 14;
    let x = 8;
    const colX = [];
    cols.forEach((c, i) => { colX[i] = x; x += Math.max(...(c || [{ w: 0 }]).map((e) => e.w)) + gapW(i); });
    let H = 0;
    cols.forEach((c, i) => { let y = 8; (c || []).forEach((e) => { e.x = colX[i]; e.y = y; y += e.h + 26; }); H = Math.max(H, y); });
    const W = Math.max(...ents.map((e) => e.x + e.w), 0) + 8 + (lanes[cols.length - 1] || 0) * 12 + (links.some((l) => !l.left) ? 24 : 0);
    const used = new Set();
    let svg = '', over = '';
    links.forEach((l) => {
      const a = byId.get(l.from), b = byId.get(l.to), s = l.status;
      used.add(s);
      const y0 = l.fi != null ? a.y + HEAD + l.fi * ROW + ROW / 2 : a.y + HEAD / 2, y1 = b.y + HEAD / 2;
      const right = (ci) => colX[ci] + Math.max(...cols[ci].map((e) => e.w));
      const tx = l.left ? right(l.gap) + 22 + l.lane * 14 : right(l.gap) + 14 + l.lane * 14;
      const pts = l.left ? [[a.x, y0], [tx, y0], [tx, y1], [b.x + b.w, y1]] : [[a.x + a.w, y0], [tx, y0], [tx, y1], [b.x + b.w + 1, y1]];
      const p = rounded(pts, 8), name = (a.label || a.id) + ' → ' + (b.label || b.id) + (l.label ? ': ' + l.label : '');
      const at = steps(l.step).length ? l : { step: steps(a.step).concat(steps(b.step)).slice(-1) };
      svg += '<path class="de ' + s + '" d="' + p + '" marker-end="url(#' + id + '-' + s + ')"' + partAttrs(Object.assign({}, l, { step: at.step }), name) + ' data-from="' + esc(l.from) + '" data-to="' + esc(l.to) + '"/>' +
        '<circle class="dfk ' + s + '" cx="' + pts[0][0] + '" cy="' + y0 + '" r="2.5"' + partAttrs({ step: at.step }, name) + '/>' +
        '<path class="dhit" d="' + p + '"' + partAttrs(Object.assign({}, l, { step: at.step }), name) + ' data-from="' + esc(l.from) + '" data-to="' + esc(l.to) + '"/>';
    });
    ents.forEach((e) => {
      used.add(e.status);
      let g = '<rect x="' + e.x + '" y="' + e.y + '" width="' + e.w + '" height="' + e.h + '" rx="7"/>' +
        '<line class="dsep" x1="' + e.x + '" x2="' + (e.x + e.w) + '" y1="' + (e.y + HEAD) + '" y2="' + (e.y + HEAD) + '"/>' +
        (e.status !== 'same' ? '<circle class="ddot" cx="' + (e.x + 14) + '" cy="' + (e.y + HEAD / 2) + '" r="3.5"/>' : '') +
        '<text class="dent" x="' + (e.x + (e.status !== 'same' ? 26 : 12)) + '" y="' + (e.y + HEAD / 2 + 4.5) + '">' + esc(e.label || e.id) + '</text>';
      e.fields.forEach((f, i) => {
        const fs = st(f.status), y = e.y + HEAD + i * ROW + 4;
        if (f.status) used.add(fs);
        g += '<g class="dfield ' + fs + '"' + partAttrs(f, (e.label || e.id) + '.' + f.name) + '>' +
          (fs !== 'same' ? '<rect class="dfbg" x="' + (e.x + 1) + '" y="' + y + '" width="' + (e.w - 2) + '" height="' + (ROW - 2) + '"/>' : '') +
          '<text x="' + (e.x + 12) + '" y="' + (y + 15) + '">' + (f.key === 'pk' ? '<tspan class="dkey">⚿ </tspan>' : '') + esc(f.name) + '</text>' +
          '<text class="dtype" x="' + (e.x + e.w - 12) + '" y="' + (y + 15) + '" text-anchor="end">' +
          (f.was ? '<tspan class="dwas">' + esc(f.was) + '</tspan> → ' : '') + esc(f.type || (f.to ? '→ ' + ((byId.get(f.to) || {}).label || f.to) : '')) + '</text></g>';
      });
      svg += '<g class="dn drec ' + e.status + '"' + partAttrs(e, e.label || e.id) + ' data-id="' + esc(e.id) + '"' + (e.note ? ' data-note="' + esc(e.note) + '"' : '') + '>' + g + linkMark(e, e.x + e.w - 8, e.y + 20) + '</g>';
      if (e.pin != null) over += '<g' + partAttrs(e, e.label || e.id) + '>' + pinSvg(e.x + 2, e.y + 2, e.pin) + '</g>';
    });
    return '<svg class="dsvg dmodel" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%" role="img">' + arrowDefs(id) + svg + over + '</svg>' + legend(used);
  }

  // --- journey: the screens a person moves through ----------------------------
  // A storyboard: small sketched screens left to right, each arrow saying what the person does to get
  // to the next. Each screen is sketch markup (the same classes as `html`), drawn in its own shadow root.
  function journey(d) {
    const wrap = document.createElement('div');
    wrap.className = 'djourney';
    (d.screens || []).forEach((s, i, all) => {
      const card = document.createElement('div');
      card.className = 'djscreen ' + st(s.status);
      const at = partAttrs(s, s.title || 'Screen ' + (i + 1));
      at.replace(/ data-([\w-]+)="([^"]*)"/g, (m, k, v) => { card.setAttribute('data-' + k, v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); return m; });
      card.style.setProperty('--sw', (s.width || d.width || 230) + 'px');
      card.innerHTML = '<div class="djtitle">' + (s.pin != null ? '<span class="djpin">' + esc(s.pin) + '</span>' : '') + esc(s.title || '') + (s.link ? ' <span class="djlink">↗</span>' : '') + '</div>';
      card.appendChild(raw(s.html || ''));
      if (s.note) card.insertAdjacentHTML('beforeend', '<div class="djnote">' + esc(s.note) + '</div>');
      wrap.appendChild(card);
      if (i < all.length - 1) {
        const next = all[i + 1], step = steps(next.step).length ? next : s;
        const arrow = document.createElement('div');
        arrow.className = 'djarrow';
        const ss = steps(step.step);
        if (ss.length) arrow.dataset.step = ss.join(' ');
        arrow.innerHTML = '<span class="djact">' + esc(s.then || '') + '</span><i></i>';
        wrap.appendChild(arrow);
      }
    });
    // A screen whose sketch marks an element with data-next="screen-id" can be clicked through: the
    // strip gives way to one screen at a time, larger, and the marked element opens the next.
    if ((d.screens || []).some((s) => /data-next=/.test(s.html || ''))) {
      wrap.classList.add('clickable');
      wrap.insertAdjacentHTML('beforeend', '<p class="djhint">Click the outlined parts of a screen to go through it.</p>');
    }
    return wrap;
  }
  // Show screen n (1-based) of a click-through journey on its own, or the whole strip at 0. Its
  // screens are its steps, so the breadcrumbs under it name them and follow along.
  function play(wrap, n) {
    const cards = Array.from(wrap.querySelectorAll(':scope > .djscreen')), card = cards[n - 1];
    if (!card) { wrap.classList.remove('playing'); wrap.style.minHeight = ''; cards.forEach((c) => c.classList.remove('at')); return; }
    // Hold the strip's height, so the page below doesn't jump as screens change.
    if (!wrap.classList.contains('playing')) wrap.style.minHeight = wrap.offsetHeight + 'px';
    wrap.classList.add('playing');
    cards.forEach((c) => c.classList.toggle('at', c === card));
  }
  const isClickThrough = (d) => !!d && d.kind === 'journey' && (d.screens || []).some((s) => /data-next=/.test((s && s.html) || ''));

  // --- raw markup ---------------------------------------------------------
  // Shown in a shadow root: page styles can't reach in and its styles can't
  // leak out. The page's colour variables still inherit, and these primitives
  // cover the usual boxes-and-arrows sketches.
  const RAW_CSS = ':host{display:block;color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.col{display:flex;flex-direction:column;gap:8px}' +
    '.grid{display:grid;gap:10px;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr))}' +
    '.box{border:1px solid var(--border);border-radius:8px;padding:6px 10px;background:var(--panel)}' +
    '.box.new,.new{border-color:var(--add-b)}.box.changed,.changed{border-color:#d29922}' +
    // Status recolours a border only where there is one: border-style alone would give a borderless
    // element (a timeline point, a list row) a thick default border.
    '.removed{opacity:.85}:is(.box,.ui-btn,.ui-card,.ui-input,.ui-select,.ui-chip,.screen,.record,.ui-banner,.ui-empty,.ui-upload).removed{border-color:var(--del-b);border-style:dashed}.box.removed{color:var(--del-b)}' +
    '.arrow::before{content:"\\2192";color:var(--muted);font-size:18px}.down::before{content:"\\2193";color:var(--muted);font-size:18px}' +
    // A flex column stretches its children, which would put an arrow's glyph at the left edge.
    '.down{text-align:center}.col>.down,.col>.arrow{align-self:center}' +
    // In a column (a screen's body, a card, a field) small parts keep their own width instead of stretching.
    ':is(.col,.body,.ui-card,.ui-drawer,.modal,.ui-field,.djnote)>:is(.tag,.ui-btn,.ui-chip,.ui-badge,.ui-tooltip,.ui-toast,.ui-link,.ui-kbd,.state,.note,.ui-avatar,.ui-spinner,.pin){align-self:flex-start}' +
    '.muted{color:var(--muted)}.small{font-size:12px}.title{font-weight:600;margin-bottom:4px}' +
    '.tag{font-size:10px;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--border);border-radius:20px;padding:0 6px;color:var(--muted)}' +
    '.add{color:var(--add-b)}.del{color:var(--del-b)}.accent{color:var(--accent)}' +
    'code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}' +
    'table{border-collapse:collapse;font-size:12px}th,td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}th{background:var(--panel)}' +
    'svg{max-width:100%;height:auto;overflow:visible}svg text{fill:var(--text);font:12px -apple-system,BlinkMacSystemFont,sans-serif}' +
    'svg .muted{fill:var(--muted)}svg .s-new{stroke:var(--add-b)}svg .s-old{stroke:var(--del-b);stroke-dasharray:5 4}' +
    'svg .s-changed{stroke:#d29922}svg .s-muted{stroke:var(--muted)}svg .s-accent{stroke:var(--accent)}' +
    'svg .f-new{fill:var(--add-bg)}svg .f-old{fill:var(--del-bg)}svg .f-panel{fill:var(--panel)}svg .f-accent{fill:var(--accent)}' +
    // Drawing by hand in an svg: arrows, measurements, points, fills and line styles.
    // A bare line or polyline is visible without any class; :where keeps this below every class.
    ':where(svg) :where(line,polyline){stroke:var(--muted);fill:none}' +
    ':host>svg{display:block;margin-inline:auto}' +
    'svg .s-thick{stroke-width:2.5}svg .s-dash{stroke-dasharray:6 4}svg .s-dot{stroke-dasharray:1 4;stroke-linecap:round}svg .ghost{opacity:.4}' +
    'svg :is(.to,.both,.move,.dim){fill:none}svg .to{marker-end:url(#k)}svg .both{marker-start:url(#k);marker-end:url(#k)}' +
    'svg .move{stroke:var(--accent);stroke-dasharray:5 4;marker-end:url(#k-accent)}' +
    'svg .dim{stroke:var(--muted);stroke-width:.8;marker-start:url(#t);marker-end:url(#t)}' +
        'svg .to.s-new{marker-end:url(#k-new)}svg .both.s-new{marker-start:url(#k-new);marker-end:url(#k-new)}svg .dim.s-new{marker-start:url(#t-new);marker-end:url(#t-new)}' +
    'svg .to.s-old{marker-end:url(#k-old)}svg .both.s-old{marker-start:url(#k-old);marker-end:url(#k-old)}svg .dim.s-old{marker-start:url(#t-old);marker-end:url(#t-old)}' +
    'svg .to.s-changed{marker-end:url(#k-changed)}svg .both.s-changed{marker-start:url(#k-changed);marker-end:url(#k-changed)}svg .dim.s-changed{marker-start:url(#t-changed);marker-end:url(#t-changed)}' +
    'svg .to.s-accent{marker-end:url(#k-accent)}svg .both.s-accent{marker-start:url(#k-accent);marker-end:url(#k-accent)}svg .dim.s-accent{marker-start:url(#t-accent);marker-end:url(#t-accent)}' +
    'svg .pt{fill:var(--text);stroke:var(--bg);stroke-width:1.5}svg .pt.new{fill:var(--add-b)}svg .pt.old{fill:var(--del-b)}svg .pt.accent{fill:var(--accent)}' +
    'svg .handle{fill:var(--bg);stroke:var(--accent);stroke-width:1.5}svg .origin{stroke:var(--text);stroke-width:1}' +
    'svg .f-hatch{fill:url(#hatch)}svg .f-grid{fill:url(#grid)}' +
    'svg .lbl{paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round;font-size:11px}svg .lbl.new{fill:var(--add-b)}svg .lbl.old{fill:var(--del-b)}svg .lbl.accent{fill:var(--accent)}svg .mono{font-family:ui-monospace,Menlo,monospace}' +
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
    '.timeline>.removed{text-decoration:line-through;color:var(--muted)}.timeline>.new::before{background:var(--add-b)}.timeline>.removed::before{background:var(--del-b)}.timeline>.ghost::before{background:var(--muted)}' +
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
    'tr.new,tr.removed,tr.changed{border:0;opacity:1}tr.new td{background:var(--add-bg)}tr.removed td{background:var(--del-bg);text-decoration:line-through;color:var(--muted)}tr.changed>:first-child,td.changed{box-shadow:inset 3px 0 #d29922}' +
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
    // Forms, feedback and navigation: enough to sketch a settings page, a wizard or an inbox.
    '.ui-field{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)}.ui-field>.ui-input,.ui-field>.ui-select,.ui-field>.ui-textarea{color:var(--text)}' +
    '.ui-field.error>.ui-input,.ui-field.error>.ui-select,.ui-field.error>.ui-textarea{border-color:var(--del-b)}.ui-error{color:var(--del-b);font-size:11px}.ui-hint{color:var(--muted);font-size:11px}' +
    '.ui-textarea{display:block;min-height:46px;border:1px solid var(--border);border-radius:5px;padding:3px 8px;font-size:12px;color:var(--muted);background:var(--bg)}' +
    '.ui-search{display:inline-flex;align-items:center;gap:6px;min-width:140px;border:1px solid var(--border);border-radius:14px;padding:2px 10px;font-size:12px;color:var(--muted);background:var(--bg)}.ui-search::before{content:"\\2315";font-size:13px}' +
    '.ui-date{display:inline-flex;justify-content:space-between;gap:10px;min-width:110px;border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:12px;background:var(--bg)}.ui-date::after{content:"";align-self:center;width:9px;height:8px;border:1px solid var(--muted);border-top-width:3px;border-radius:2px}' +
    '.ui-upload{border:1px dashed var(--border);border-radius:8px;padding:12px;text-align:center;font-size:12px;color:var(--muted)}.ui-upload::before{content:"\\2191  "}' +
    '.ui-slider{position:relative;height:4px;min-width:120px;border-radius:2px;margin:6px 0;background:linear-gradient(90deg,var(--accent) var(--v,50%),var(--border) 0)}.ui-slider::after{content:"";position:absolute;left:var(--v,50%);top:50%;width:11px;height:11px;border-radius:50%;background:var(--bg);border:2px solid var(--accent);transform:translate(-50%,-50%)}' +
    '.ui-progress{height:6px;min-width:120px;border-radius:3px;background:linear-gradient(90deg,var(--accent) var(--v,50%),var(--border) 0)}' +
    '.ui-spinner{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);vertical-align:middle}' +
    '.ui-skeleton{height:var(--h,10px);width:var(--w,100%);border-radius:5px;background:linear-gradient(90deg,color-mix(in srgb,var(--border) 70%,var(--bg)),var(--border),color-mix(in srgb,var(--border) 70%,var(--bg)))}' +
    '.ui-tooltip{position:relative;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--text);color:var(--bg);font-size:11px}.ui-tooltip::after{content:"";position:absolute;left:12px;bottom:-4px;width:8px;height:8px;background:inherit;transform:rotate(45deg)}' +
    '.ui-crumbs{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--muted)}.ui-crumbs>:not(:last-child)::after{content:"/";margin-left:6px}.ui-crumbs>:last-child{color:var(--text)}' +
    '.ui-pager{display:flex;gap:4px;font-size:12px}.ui-pager>*{min-width:22px;text-align:center;padding:1px 6px;border:1px solid var(--border);border-radius:4px}.ui-pager>.on{background:var(--accent);border-color:var(--accent);color:var(--bg)}' +
    '.ui-stepper{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);counter-reset:s}.ui-stepper>*{display:inline-flex;align-items:center;gap:5px;counter-increment:s}' +
    '.ui-stepper>::before{content:counter(s);display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;border:1px solid var(--border);font-size:10px}' +
    '.ui-stepper>:not(:last-child)::after{content:"";width:18px;height:1px;background:var(--border);margin-left:3px}.ui-stepper>.on{color:var(--text)}.ui-stepper>.on::before{border-color:var(--accent);color:var(--accent)}.ui-stepper>.done::before{content:"\\2713";background:var(--accent);border-color:var(--accent);color:var(--bg)}' +
    '.ui-link{color:var(--accent);text-decoration:underline;text-underline-offset:2px;font-size:12px}.ui-kbd{display:inline-block;border:1px solid var(--border);border-bottom-width:2px;border-radius:4px;padding:0 5px;font:11px ui-monospace,Menlo,monospace}' +
    '.ui-list{display:flex;flex-direction:column;font-size:12px}.ui-list>*{display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid var(--border)}.ui-list>:last-child{border-bottom:0}' +
    '.ui-list>.new{background:var(--add-bg)}.ui-list>.removed{opacity:1;background:var(--del-bg);text-decoration:line-through;color:var(--muted)}.ui-list>.changed{box-shadow:inset 3px 0 #d29922}.ui-list>.on{background:var(--panel)}' +
    '.ui-header{display:flex;align-items:center;gap:10px;padding:4px 0 8px;border-bottom:1px solid var(--border);font-size:12px}.ui-header>.title{margin:0;flex:1}' +
    '.ui-app{display:grid;grid-template-columns:auto 1fr;gap:12px;min-height:var(--h,0)}.ui-app>.ui-nav{border-right:1px solid var(--border);padding-right:8px}' +
    '.ui-drawer{border-left:1px solid var(--border);padding-left:10px;display:flex;flex-direction:column;gap:6px;box-shadow:-8px 0 14px -10px rgba(0,0,0,.35)}' +
    '.ui-bars{display:flex;align-items:flex-end;gap:4px;height:var(--h,60px)}.ui-bars>i{flex:1;min-width:6px;height:var(--v,50%);background:var(--border);border-radius:3px 3px 0 0}.ui-bars>i.on{background:color-mix(in srgb,var(--accent) 75%,var(--bg))}.ui-bars>i.new{background:color-mix(in srgb,var(--add-b) 75%,var(--bg))}.ui-bars>i.removed{background:color-mix(in srgb,var(--del-b) 60%,var(--bg))}' +
    '.email{border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:12px;overflow:hidden}.email>.head{padding:6px 12px;border-bottom:1px solid var(--border);background:var(--panel);display:grid;grid-template-columns:auto 1fr;gap:1px 10px}' +
    '.email>.head>:nth-child(odd){color:var(--muted)}.email>.body{padding:10px 12px;display:flex;flex-direction:column;gap:8px}' +
    '[data-next]{cursor:pointer;outline:1px dashed color-mix(in srgb,var(--accent) 70%,transparent);outline-offset:2px;border-radius:4px}[data-next]:hover{outline:2px solid var(--accent)}' +
    '[data-link]{cursor:pointer}[data-link]:hover{outline:1px dashed var(--accent);outline-offset:2px}' +
    '.dlanded{animation:dlanded 1.8s ease-out}@keyframes dlanded{0%,40%{outline:2px solid var(--accent);outline-offset:3px}100%{outline:2px solid transparent;outline-offset:6px}}' +
    // Parts a diagram tags with data-step build up with the steps, the same as nodes and arrows.
    '[data-reveal]{transition:opacity .45s ease}[data-reveal=is-future]{opacity:0!important}[data-reveal=is-past]{opacity:.32!important}' +
    '';
  // Arrowheads, dimension ticks and fills for drawing by hand in an svg. They go into each svg as
  // it is shown, so the drawing's classes (.to, .dim, .f-hatch) can point at them by id; one set per
  // colour, because a marker can't take its line's colour everywhere yet.
  const INK = [['', 'var(--muted)'], ['new', 'var(--add-b)'], ['old', 'var(--del-b)'], ['changed', '#d29922'], ['accent', 'var(--accent)']];
  const SVG_DEFS = '<defs>' + INK.map(([k, c]) => {
    const id = k ? '-' + k : '';
    return '<marker id="k' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1.5L10,5L0,8.5z" style="fill:' + c + '"/></marker>' +
      '<marker id="t' + id + '" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M5,0V10" style="stroke:' + c + ';stroke-width:1.5"/></marker>';
  }).join('') +
    '<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0,0V6" style="stroke:var(--del-b);stroke-width:1.2;opacity:.55"/></pattern>' +
    '<pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10,0H0V10" style="fill:none;stroke:var(--border);stroke-width:.5;opacity:.6"/></pattern></defs>';
  function raw(markup) {
    const host = document.createElement('div');
    host.className = 'draw';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' + RAW_CSS + '</style>' + String(markup || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    root.querySelectorAll('svg').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', SVG_DEFS);
      // Drawn at its own size (the viewBox's width) rather than stretched to the column, so its text
      // stays the size it was written at; it still shrinks to fit a narrow window.
      const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (!el.hasAttribute('width') && vb[2] > 0 && !el.closest('svg svg')) el.setAttribute('width', vb[2]);
    });
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
    else if (d.kind === 'model') box.innerHTML = model(d);
    else if (d.kind === 'journey') box.appendChild(journey(d));
    else if (d.kind === 'compare') {
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
    if (['structure', 'flow', 'states', 'sequence', 'model'].includes(d.kind)) box.insertAdjacentHTML('beforeend', '<div class="dhover" aria-live="polite"></div>');
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
    if (d.id) fig.dataset.did = d.id;
    if (d.kind !== 'image' && d.kind !== 'compare' && !(opts && opts.big))
      fig.insertAdjacentHTML('beforeend', '<button type="button" class="dexpand" title="Expand" aria-label="Expand diagram">&#10530;</button>');
    if (d.title) fig.insertAdjacentHTML('beforeend', '<figcaption class="dtitle">' + esc(d.title) + '</figcaption>');
    fig.appendChild(body(d));
    // A diagram that builds gets its steps as breadcrumbs under it, and moves through them in place.
    if (!(opts && opts.plain) && isStaged(d) && stageCount(d)) {
      fig.classList.add('builds');
      fig.insertAdjacentHTML('beforeend', stepperHtml(stagesOf(d), isClickThrough(d) ? 'All screens' : null));
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
    // A click-through journey moves between its screens rather than revealing parts.
    const jw = fig.querySelector('.djourney.clickable');
    if (jw) { play(jw, n); return; }
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
    if (isClickThrough(d)) return d.screens.length;
    let m = 0;
    JSON.stringify(d || {}, (k, v) => {
      if (k === 'step') steps(v).forEach((x) => { if (x > m) m = x; });
      if (k === 'html' && typeof v === 'string') (v.match(/data-step=["'][\d ]+["']/g) || []).forEach((a) => a.slice(11, -1).split(' ').forEach((x) => { if (+x > m) m = +x; }));
      return v;
    });
    (((d && (d.html || d.svg)) || '').match(/data-step=["'][\d ]+["']/g) || []).forEach((a) => a.slice(11, -1).split(' ').forEach((x) => { if (+x > m) m = +x; }));
    return m;
  }
  const stagesOf = (d) => Array.from({ length: stageCount(d) }, (_, i) => (isClickThrough(d) ? d.screens[i].title : d.stages && d.stages[i]) || 'Step ' + (i + 1));
  // Breadcrumbs through the steps: the whole picture, then each step by name. The current one is
  // underlined; the ones before it read as done.
  function stepperHtml(stages, whole) {
    return '<nav class="dsteps" aria-label="Steps"><button type="button" data-go="0">' + esc(whole || 'Whole picture') + '</button>' +
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
    wrap.innerHTML = '<div class="dwalkh">' + (d.title ? '<div class="dwalkt">' + esc(d.title) + '</div>' : '') + stepperHtml(stages, isClickThrough(d) ? 'All screens' : null) + '</div>';
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
    // Whether it moved: at either end it doesn't, so the page can move on to the next picture.
    wrap.step = (dir) => { const was = at; wrap.go(at + dir); return at !== was; };
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
      const path = e.composedPath ? e.composedPath() : [];
      const hot = path.find((n) => n.dataset && n.dataset.next != null);
      const jw = path.find((n) => n.classList && n.classList.contains('djourney'));
      if (hot && jw) {
        e.preventDefault();
        const n = Array.from(jw.querySelectorAll(':scope > .djscreen')).findIndex((c) => c.dataset.part === hot.dataset.next) + 1;
        const host = jw.closest('.dwalk') || jw.closest('figure.diagram');
        if (host && host.go) host.go(n); else play(jw, n);
        return;
      }
      const b = e.target.closest && e.target.closest('.dsteps [data-go]');
      if (!b) return;
      const host = b.closest('.dwalk') || b.closest('figure.diagram');
      if (host && host.go) host.go(+b.dataset.go);
    });
  }
  const isStaged = (d) => { if (isClickThrough(d)) return true; const j = JSON.stringify(d || {}); return j.includes('"step"') || /data-step=/.test(j); };

  const KINDS = ['structure', 'flow', 'states', 'sequence', 'compare', 'table', 'timeline', 'model', 'journey', 'html', 'svg', 'image', 'video'];
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
    } else if (d.kind === 'model') {
      const ids = new Set();
      (d.entities || d.records || []).forEach((e) => { if (!e.id) out.push(at + ': a record has no id'); else if (ids.has(e.id)) out.push(at + ': duplicate record ' + e.id); ids.add(e.id); });
      if (!ids.size) out.push(at + ': no records');
      (d.entities || d.records || []).forEach((e) => (e.fields || []).forEach((f) => { if (f && f.to && !ids.has(f.to)) out.push(at + ': ' + e.id + '.' + f.name + ' points at unknown record ' + f.to); }));
      (d.links || []).map(edgeOf).forEach((l) => { if (!ids.has(l.from) || !ids.has(l.to)) out.push(at + ': link ' + l.from + ' → ' + l.to + ' names an unknown record'); });
    } else if (d.kind === 'journey') {
      if (!(d.screens || []).length) out.push(at + ': journey has no screens');
      (d.screens || []).forEach((s, i) => { if (!s || !s.html) out.push(at + ': screen ' + (i + 1) + ' has no html'); });
      const sids = new Set((d.screens || []).map((s) => s && s.id).filter(Boolean));
      (d.screens || []).forEach((s, i) => String((s && s.html) || '').replace(/data-next=["']([^"']*)["']/g, (m, x) => {
        if (!sids.has(x)) out.push(at + ': screen ' + (i + 1) + ' has data-next="' + x + '", but no screen has that id');
      }));
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
    if (ctx && ctx.ids) {
      const links = [];
      JSON.stringify(d, (k, v) => { if (k === 'link' && typeof v === 'string') links.push(v); if (k === 'html' || k === 'svg') String(v || '').replace(/data-link=["']([^"']+)["']/g, (m, l) => links.push(l)); return v; });
      links.forEach((l) => {
        const [did, part] = l.split('#');
        if (!ctx.ids.has(did)) out.push(at + ': links to "' + l + '", but no diagram has the id "' + did + '"');
        else if (part && !ctx.ids.get(did).has(part)) out.push(at + ': links to "' + l + '", but that diagram has no part with the id "' + part + '"');
      });
    }
    if (ctx) {
      const obj = (l) => (l || []).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      const parts = [].concat(obj(d.nodes || d.states), obj(d.edges || d.transitions), obj(d.actors), obj(d.messages || d.steps), obj(d.rows), obj(d.events), obj(d.entities || d.records), ...obj(d.entities || d.records).map((e) => obj(e.fields)), obj(d.links), obj(d.screens), d.marks || []);
      parts.forEach((o) => {
        const name = o.label || o.id || (o.from ? o.from + ' → ' + o.to : 'a part');
        // A diagram with its own `stages` builds through those; any other names the connection steps.
        const max = d.stages ? d.stages.length : ctx.steps;
        steps(o.step).forEach((n) => { if (max != null && n > max) out.push(at + ': ' + name + ' names step ' + n + ', but there are ' + max); });
      });
    }
    return out;
  }

  // Warnings, not failures: a diagram that is drawable but likely hard to read. A web of lines is
  // the usual one; the cure is to make it build (each path a step) or to split it, not to drop parts.
  function advice(d, where) {
    const at = where || (d && d.title) || 'diagram';
    if (!d || !['structure', 'flow', 'states'].includes(d.kind) || DIAG_STAGED(d)) return [];
    const nodes = (d.nodes || d.states || []).map((n) => (typeof n === 'string' ? { id: n } : n));
    const edges = (d.edges || d.transitions || []).map(edgeOf);
    const out = [];
    if (edges.length > 8 && edges.length > nodes.length)
      out.push(at + ': ' + edges.length + ' lines for ' + nodes.length + ' boxes is a web; give each path through it a "step" so it builds, or split it');
    if (d.kind === 'structure' && d.layers) {
      const li = new Map(nodes.map((n) => [n.id, d.layers.indexOf(n.layer)]));
      const skips = edges.filter((e) => Math.abs((li.get(e.from) || 0) - (li.get(e.to) || 0)) > 1).length;
      if (skips > 1) out.push(at + ': ' + skips + ' lines skip a layer; a line that crosses a layer usually means a box belongs in another layer, or the diagram should build');
    }
    return out;
  }
  const DIAG_STAGED = (d) => isStaged(d);

  // A diagram's id and the ids of its parts (data and sketch markup alike), for checking links.
  function partIds(d) {
    const ids = new Set();
    JSON.stringify(d || {}, (k, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && v.id != null && v !== d) ids.add(String(v.id));
      if (k === 'html' || k === 'svg') String(v || '').replace(/data-(?:id|part)=["']([^"']+)["']/g, (m, x) => ids.add(x));
      return v;
    });
    return ids;
  }
  const api = { render, body, problems, advice, partIds, play, focus, walk, trace, isStaged, stagesOf, KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
