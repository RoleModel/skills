() => {
  const viewportWidth = window.innerWidth;
  const pageWidth = document.documentElement.scrollWidth;
  const mobile = viewportWidth < 500;
  const issues = [];

  const rendered = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const clippingAncestor = (el) => {
    const rect = el.getBoundingClientRect();
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = node.getBoundingClientRect();
      const width = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
      const height = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
      if (width <= 1 || height <= 1) return node;
    }
    return null;
  };
  const isShown = (el) => rendered(el) && !clippingAncestor(el);
  const words = (text) => (text || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const label = (el) => words(
    el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) ||
    el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText || el.value || el.className
  );
  const describe = (el) => {
    const type = el.tagName === 'INPUT' ? `[${el.type}]` : '';
    return `${el.tagName.toLowerCase()}${type} "${label(el)}"`;
  };
  const top = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
  const add = (kind, el, detail) => issues.push({ kind, target: describe(el), y: top(el), detail });

  const modal = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].find(isShown);
  const scope = modal || document.body;
  const pinned = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (['fixed', 'sticky'].includes(getComputedStyle(node).position)) return true;
    }
    return false;
  };
  const controls = [...scope.querySelectorAll(
    'input:not([type=hidden]), select, textarea, button, a[href], label, [role=button], [role=checkbox]'
  )].filter((el) => isShown(el) && !pinned(el));

  if (pageWidth > viewportWidth + 1) {
    const wide = [...document.body.querySelectorAll('*')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > viewportWidth + 1;
    });
    const wideSet = new Set(wide);
    wide.filter((el) => ![...el.children].some((child) => wideSet.has(child))).slice(0, 4)
      .forEach((el) => add('overflows the screen', el, `right edge at ${Math.round(el.getBoundingClientRect().right)}px of ${viewportWidth}px`));
  }

  const rects = controls.map((el) => el.getBoundingClientRect());
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.contains(b) || b.contains(a) || a.control === b || b.control === a) continue;
      const ra = rects[i], rb = rects[j];
      const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (width <= 2 || height <= 2) continue;
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (width * height > 0.15 * smaller) {
        issues.push({ kind: 'controls overlap', target: `${describe(a)} and ${describe(b)}`, y: Math.round(Math.min(ra.top, rb.top) + window.scrollY), detail: `${Math.round(width)}x${Math.round(height)}px overlap` });
      }
    }
  }

  [...scope.querySelectorAll('label, input:not([type=hidden]), select, textarea, button')].forEach((el) => {
    if (!rendered(el)) return;
    const clip = clippingAncestor(el);
    if (!clip) return;
    const box = clip.getBoundingClientRect();
    if (box.width > 40 && box.height > 40) add('clipped out of view', el, `inside a visible ${clip.tagName.toLowerCase()} that hides it`);
  });

  controls.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const textual = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select, textarea');
    if (textual && rect.width < 64) add('control too narrow', el, `${Math.round(rect.width)}px wide`);
    if (textual && el.tagName === 'INPUT' && el.value && el.scrollWidth > el.clientWidth + 2) {
      add('input text cut off', el, `${el.scrollWidth}px of text in ${el.clientWidth}px`);
    }
    if (mobile && el.matches('button, a[href], [role=button], input[type=checkbox], input[type=radio]') && (rect.width < 24 || rect.height < 24)) {
      add('tap target too small', el, `${Math.round(rect.width)}x${Math.round(rect.height)}px`);
    }
  });

  [...scope.querySelectorAll('*')].forEach((el) => {
    if (el.children.length > 0 || !el.innerText || !el.innerText.trim()) return;
    const style = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis') return;
    if (el.scrollWidth > el.clientWidth + 2 && isShown(el)) add('text cut off', el, `${el.scrollWidth}px of text in ${el.clientWidth}px`);
  });

  const grouped = new Map();
  issues.forEach((issue) => {
    const key = `${issue.kind}|${issue.target}`;
    if (grouped.has(key)) grouped.get(key).count += 1;
    else grouped.set(key, { ...issue, count: 1 });
  });
  return [...grouped.values()];
}
