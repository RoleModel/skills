/**
 * Small GitHub-flavoured Markdown renderer for comment previews. The page is
 * offline, so this covers what review comments actually use: paragraphs with
 * GitHub's newline-as-break, headings, emphasis, strikethrough, code spans and
 * fences, links, images (inline for attachments, links otherwise), autolinks, quotes, nested and task lists, tables, rules,
 * and ```suggestion blocks rendered as a before/after diff.
 *
 * opts.attachments maps an attachment id to a data URL, so `attachment:<id>`
 * links resolve to the pasted file. opts.original is the list of lines a
 * suggestion would replace.
 */
const MD = (function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safeUrl = (u) => (/^(?:https?:|mailto:|#|\/|\.|attachment:)/i.test(u) || !/^[a-z][\w+.-]*:/i.test(u) ? u : '#');

  function inline(src, o) {
    const stash = [];
    const keep = (html) => '\u0001' + (stash.push(html) - 1) + '\u0001';
    const url = (u) => {
      const m = u.match(/^attachment:([\w-]+)$/);
      if (m) return (o.attachments && o.attachments[m[1]]) || '#';
      return safeUrl(u);
    };
    let s = String(src);
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => keep('<code>' + esc(code) + '</code>'));
    // Only pasted attachments render inline. Any other image would be fetched as soon as
    // the page renders, telling its host who is reviewing; show it as a link instead.
    s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, alt, u) => keep(/^attachment:/.test(u)
      ? '<img alt="' + esc(alt) + '" src="' + esc(url(u)) + '">'
      : '<a href="' + esc(url(u)) + '" target="_blank" rel="noopener">Image: ' + esc(alt || u) + '</a>'));
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, text, u) =>
      keep('<a href="' + esc(url(u)) + '" target="_blank" rel="noopener">' + esc(text) + '</a>'));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (_, pre, u) =>
      pre + keep('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a>'));
    s = esc(s);
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g, (_, a, b) => '<strong>' + (a || b) + '</strong>');
    s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/\n/g, '<br>');
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
  }

  function suggestion(code, o) {
    const rows = (o.original || []).map((l) => '<tr class="d"><td class="c">-' + esc(l) + '</td></tr>')
      .concat((code === '' ? [] : code.split('\n')).map((l) => '<tr class="a"><td class="c">+' + esc(l) + '</td></tr>'));
    return '<div class="sugg"><div class="sugghd">Suggested change</div><table>' + rows.join('') + '</table></div>';
  }

  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/;
  const isTableSep = (l) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const startsBlock = (l, next) => FENCE.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST.test(l) ||
    /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(l) || (l.includes('|') && next !== undefined && isTableSep(next));

  function render(src, o) {
    o = o || {};
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(FENCE);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(fence[1][0].repeat(fence[1].length)) &&
          /^\s*[`~]+\s*$/.test(lines[i]))) body.push(lines[i++]);
        i++;
        const code = body.join('\n');
        if (fence[2] === 'suggestion') html += suggestion(code, o);
        else {
          const lang = fence[2] && typeof HL !== 'undefined' ? HL.langOf('x.' + fence[2]) : null;
          const st = {};
          html += '<pre><code>' + body.map((l) => (lang ? HL.hl(l, lang, st) : esc(l))).join('\n') + '</code></pre>';
        }
        continue;
      }
      if (!line.trim()) { i++; continue; }
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { html += '<h' + h[1].length + '>' + inline(h[2], o) + '</h' + h[1].length + '>'; i++; continue; }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ''));
        html += '<blockquote>' + render(body.join('\n'), o) + '</blockquote>';
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        let rows = '';
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows += '<tr>' + cells(lines[i++]).map((c) => '<td>' + inline(c, o) + '</td>').join('') + '</tr>';
        }
        html += '<table class="mdt"><thead><tr>' + head.map((c) => '<th>' + inline(c, o) + '</th>').join('') +
          '</tr></thead><tbody>' + rows + '</tbody></table>';
        continue;
      }
      const li = line.match(LIST);
      if (li) {
        const base = li[1].length, ordered = /\d/.test(li[2]);
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(LIST);
          if (m && m[1].length === base) { items.push([m[3]]); i++; continue; }
          if (lines[i].trim() && (/^\s/.test(lines[i]) || (m && m[1].length > base))) {
            items[items.length - 1].push(lines[i].slice(Math.min(base + 2, lines[i].search(/\S/))));
            i++;
            continue;
          }
          break;
        }
        html += (ordered ? '<ol>' : '<ul>') + items.map((it) => {
          const task = it[0].match(/^\[([ xX])\]\s+(.*)$/);
          const first = task ? task[2] : it[0];
          const box = task ? '<input type="checkbox" disabled' + (task[1] === ' ' ? '' : ' checked') + '> ' : '';
          const rest = it.slice(1);
          const nested = rest.length ? render(rest.join('\n'), o) : '';
          return '<li' + (task ? ' class="task"' : '') + '>' + box + inline(first, o) + nested + '</li>';
        }).join('') + (ordered ? '</ol>' : '</ul>');
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++]);
      html += '<p>' + inline(para.join('\n'), o) + '</p>';
    }
    return html;
  }

  return { render, esc };
})();
