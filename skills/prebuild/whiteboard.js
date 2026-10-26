// Turns a slide's rendered diagram into an Excalidraw scene, and reads scenes pasted back from Excalidraw.
const WHITEBOARD = (function () {
  const COLOURS = {
    same: { stroke: '#1e1e1e', fill: 'transparent', style: 'solid' },
    new: { stroke: '#2f9e44', fill: '#b2f2bb', style: 'solid' },
    changed: { stroke: '#f08c00', fill: '#ffec99', style: 'solid' },
    removed: { stroke: '#e03131', fill: '#ffc9c9', style: 'dashed' },
  };
  let counter = 0;
  const id = () => 'pb' + Date.now().toString(36) + (counter++).toString(36);
  const seed = () => Math.floor(Math.random() * 2 ** 31);

  const base = (type, x, y, width, height, extra = {}) => ({
    id: id(), type, x, y, width, height, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: seed(), version: 1, versionNonce: seed(),
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false,
    ...extra,
  });

  const text = (value, x, y, extra = {}) => {
    const fontSize = extra.fontSize || 16;
    const lines = String(value).split('\n');
    const width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6;
    const height = lines.length * fontSize * 1.25;
    return base('text', x, y, width, height, {
      text: value, originalText: value, fontSize, fontFamily: 1,
      textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true,
      ...extra,
    });
  };

  const box = (x, y, width, height, label, status) => {
    const c = COLOURS[status] || COLOURS.same;
    const rect = base('rectangle', x, y, width, height, {
      strokeColor: c.stroke, backgroundColor: c.fill, strokeStyle: c.style, roundness: { type: 3 },
    });
    if (!label) return [rect];
    const t = text(label, x, y, {
      containerId: rect.id, textAlign: 'center', verticalAlign: 'middle', strokeColor: c.stroke,
    });
    t.x = x + (width - t.width) / 2;
    t.y = y + (height - t.height) / 2;
    rect.boundElements = [{ type: 'text', id: t.id }];
    return [rect, t];
  };

  const arrow = (sx, sy, ex, ey, status) => {
    const c = COLOURS[status] || COLOURS.same;
    return [base('arrow', sx, sy, Math.abs(ex - sx), Math.abs(ey - sy), {
      strokeColor: c.stroke, strokeStyle: c.style, roundness: { type: 2 },
      points: [[0, 0], [ex - sx, ey - sy]], lastCommittedPoint: null,
      startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow',
    })];
  };

  // The first and last points of an SVG path: diagrams.js edges are single cubic curves.
  const ends = (d) => {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    return nums.length >= 4 ? [nums[0], nums[1], nums[nums.length - 2], nums[nums.length - 1]] : null;
  };

  const statusOf = (el) => ['new', 'changed', 'removed'].find((s) => el.classList.contains(s)) || 'same';

  function fromDiagramSvg(svg, dx, dy) {
    const out = [];
    const nodes = [];
    svg.querySelectorAll('.dlayer').forEach((t) => {
      out.push(text(t.textContent.toUpperCase(), +t.getAttribute('x') + dx, +t.getAttribute('y') - 12 + dy, { fontSize: 12, strokeColor: '#868e96' }));
    });
    svg.querySelectorAll('g.dn').forEach((g) => {
      const r = g.querySelector('rect');
      if (!r) return;
      const label = [...g.querySelectorAll('text')].filter((t) => !t.classList.contains('dtag')).map((t) => t.textContent).join('\n');
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => +r.getAttribute(k));
      const made = box(x + dx, y + dy, w, h, label, statusOf(g));
      nodes.push(made[0]);
      out.push(...made);
    });
    svg.querySelectorAll('path.de, line.de').forEach((p) => {
      const pts = p.tagName === 'line'
        ? ['x1', 'y1', 'x2', 'y2'].map((k) => +p.getAttribute(k))
        : ends(p.getAttribute('d') || '');
      if (!pts) return;
      const hit = (px, py) => nodes.find((n) => px >= n.x - 10 && px <= n.x + n.width + 10 && py >= n.y - 10 && py <= n.y + n.height + 10);
      const from = hit(pts[0] + dx, pts[1] + dy), to = hit(pts[2] + dx, pts[3] + dy);
      let [sx, sy, ex, ey] = [pts[0] + dx, pts[1] + dy, pts[2] + dx, pts[3] + dy];
      // diagrams.js arcs same-row edges over the boxes; on a whiteboard, join them side to side instead.
      if (from && to && from !== to && Math.abs(from.y - to.y) < 4) {
        const rightward = from.x < to.x;
        sx = rightward ? from.x + from.width : from.x; sy = from.y + from.height / 2;
        ex = rightward ? to.x : to.x + to.width; ey = to.y + to.height / 2;
      }
      const made = arrow(sx, sy, ex, ey, statusOf(p));
      const [a] = made;
      if (from) { a.startBinding = { elementId: from.id, focus: 0, gap: 4 }; (from.boundElements ||= []).push({ type: 'arrow', id: a.id }); }
      if (to) { a.endBinding = { elementId: to.id, focus: 0, gap: 4 }; (to.boundElements ||= []).push({ type: 'arrow', id: a.id }); }
      out.push(...made);
    });
    svg.querySelectorAll('.dlbl text, .dmsg').forEach((t) => {
      const x = +t.getAttribute('x'), y = +t.getAttribute('y');
      const anchored = t.getAttribute('text-anchor') === 'middle';
      const el = text(t.textContent, x + dx, y - 12 + dy, { fontSize: 14, strokeColor: '#495057' });
      if (anchored) el.x -= el.width / 2;
      out.push(el);
    });
    return out;
  }

  // Hand-written svg diagrams: boxes, lines and text come across; anything else is left out.
  function fromRawSvg(svg, dx, dy) {
    const out = [];
    const cls = (el) => el.getAttribute('class') || '';
    const toneOf = (el) => (/s-new|f-new/.test(cls(el)) ? 'new' : /s-old|f-old/.test(cls(el)) ? 'removed' : /s-changed/.test(cls(el)) ? 'changed' : 'same');
    svg.querySelectorAll('rect').forEach((r) => {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => +r.getAttribute(k) || 0);
      out.push(...box(x + dx, y + dy, w, h, null, toneOf(r)));
    });
    svg.querySelectorAll('line').forEach((l) => {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => +l.getAttribute(k) || 0);
      out.push(...arrow(x1 + dx, y1 + dy, x2 + dx, y2 + dy, toneOf(l)));
    });
    svg.querySelectorAll('text').forEach((t) => {
      const x = +t.getAttribute('x') || 0, y = +t.getAttribute('y') || 0;
      const el = text(t.textContent, x + dx, y - 12 + dy, { fontSize: 14, strokeColor: /muted/.test(cls(t)) ? '#868e96' : '#1e1e1e' });
      if (t.getAttribute('text-anchor') === 'middle') el.x -= el.width / 2;
      if (t.getAttribute('text-anchor') === 'end') el.x -= el.width;
      out.push(el);
    });
    return out;
  }

  // Builds the starting board for a slide from what the presenter has already drawn.
  function seedFromSlide(slide, diagramBlock) {
    const out = [text(slide.question, 0, -70, { fontSize: 20 })];
    if (!diagramBlock) return out;
    let dx = 0;
    const svgs = [...diagramBlock.querySelectorAll('svg.dsvg')];
    svgs.forEach((svg) => {
      out.push(...fromDiagramSvg(svg, dx, 0));
      dx += (svg.viewBox.baseVal?.width || 400) + 80;
    });
    diagramBlock.querySelectorAll('.draw').forEach((host) => {
      const svg = host.shadowRoot?.querySelector('svg');
      if (svg) out.push(...fromRawSvg(svg, dx, 0));
    });
    return out;
  }

  const clipboardText = (elements) => JSON.stringify({ type: 'excalidraw/clipboard', elements, files: {} });

  const file = (elements) => JSON.stringify({
    type: 'excalidraw', version: 2, source: 'prebuild', elements,
    appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
  }, null, 2);

  // Accepts what Excalidraw puts on the clipboard (select all, copy) or a saved .excalidraw file.
  function parse(textValue) {
    let data;
    try { data = JSON.parse(textValue); } catch { return null; }
    if (!data || !Array.isArray(data.elements)) return null;
    if (data.type !== 'excalidraw/clipboard' && data.type !== 'excalidraw') return null;
    return data.elements.filter((e) => e && !e.isDeleted);
  }

  const summary = (elements) => ({
    shapes: elements.filter((e) => e.type !== 'text').length,
    labels: elements.filter((e) => e.type === 'text' && e.text.trim()).map((e) => e.text.trim().replace(/\s+/g, ' ')),
  });

  return { seedFromSlide, clipboardText, file, parse, summary };
})();
