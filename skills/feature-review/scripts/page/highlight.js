/**
 * Syntax highlighter for the review page. Deliberately small and regex-based:
 * the page has to work offline from file://, so shipping a real highlighter in
 * every review page is not worth the weight.
 *
 * It tokenises one line at a time, but a caller can pass the same state object
 * for consecutive lines (`hl(text, lang, st)`), and constructs that run past the
 * end of a line carry over in it: block comments and template literals,
 * Ruby heredocs and =begin blocks, YAML block scalars, and Slim's
 * indentation-based blocks (comments, text, and embedded `javascript:` /
 * `css:` / `ruby:` filters, which are highlighted in their own language).
 * Without a state object every line starts fresh.
 */
const HL = (function () {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const kw = (words) => new RegExp('\\b(?:' + words.trim().split(/\s+/).join('|') + ')\\b');
  // Sub-patterns must not contain capturing groups — the combined regex maps
  // group index back to a class name positionally.
  const STR = /"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?/;
  const NUM = /\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/;

  const RULES = {
    js: [
      ['c', /^\s*\*.*/],
      ['c', /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/],
      ['s', /`(?:\\[\s\S]|[^`\\])*`?|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?/],
      ['l', /\b(?:true|false|null|undefined|NaN|Infinity)\b/],
      ['k', kw(`as async await break case catch class const continue debugger default
        delete do else export extends finally for from function get if implements import
        in instanceof interface let new of return satisfies set static super switch this
        throw try typeof var void while yield`)],
      ['n', NUM],
      ['f', /\b[A-Za-z_$][\w$]*(?=\s*\()/],
      ['t', /\b[A-Z][\w$]*\b/],
    ],
    rb: [
      ['c', /#.*/],
      ['s', /"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|%[wiWI][[({][^\])}]*[\])}]/],
      ['l', /\b(?:true|false|nil|self)\b/],
      ['k', kw(`alias and begin break case def defined do else elsif end ensure extend
        for if in include module next not or private protected public raise redo require
        require_relative rescue retry return super then unless until when while yield
        attr_accessor attr_reader attr_writer`)],
      ['v', /[@$]@?[A-Za-z_]\w*/],
      ['y', /(?<![:\w]):[A-Za-z_]\w*[?!]?/],
      ['n', NUM],
      ['t', /\b[A-Z]\w*\b/],
    ],
    css: [
      ['c', /^\s*\*.*/],
      ['c', /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/],
      ['s', STR],
      ['k', /@[a-z-]+/],
      ['v', /\$[-\w]+|--[-\w]+/],
      ['n', /#[\da-fA-F]{3,8}\b|\b\d*\.?\d+(?:px|r?em|%|vh|vw|ms|s|deg|fr|ch)?\b/],
      ['a', /[-\w]+(?=\s*:)/],
      ['t', /[.#&][-\w]+|::?[a-z-]+\b/],
    ],
    json: [
      ['a', /"(?:\\.|[^"\\])*"(?=\s*:)/],
      ['s', /"(?:\\.|[^"\\])*"?/],
      ['l', /\b(?:true|false|null)\b/],
      ['n', NUM],
    ],
    yaml: [
      ['c', /#.*/],
      ['a', /[\w.-]+(?=\s*:)/],
      ['s', STR],
      ['l', /\b(?:true|false|null|yes|no)\b/],
      ['n', NUM],
    ],
    // Slim's pieces; slim() below decides which applies to which part of a line.
    slimattr: [
      ['s', STR],
      ['v', /#\{[^}]*\}?|[@$]@?[A-Za-z_]\w*/],
      ['a', /[\w:@.-]+(?==)/],
      ['k', /==?(?=\s)/],
      ['l', /\b(?:true|false|nil|self)\b/],
      ['y', /(?<![:\w]):[A-Za-z_]\w*[?!]?/],
      ['n', NUM],
      ['f', /\b[A-Za-z_]\w*[?!]?(?=\()/],
    ],
    slimtext: [
      ['v', /#\{[^}]*\}?/],
    ],
    markup: [
      ['c', /<!--[\s\S]*?(?:-->|$)/],
      ['s', STR],
      ['k', /<\/?[\w:-]+|\/?>/],
      ['a', /\b[-\w:@.]+(?==)/],
      ['n', NUM],
    ],
  };

  const EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js',
    rb: 'rb', rake: 'rb', gemspec: 'rb', ru: 'rb', jbuilder: 'rb',
    css: 'css', scss: 'css', sass: 'css',
    json: 'json', yml: 'yaml', yaml: 'yaml',
    html: 'markup', erb: 'markup', slim: 'slim', haml: 'markup', xml: 'markup', svg: 'markup',
  };

  const langOf = (name) => {
    const base = name.split('/').pop();
    const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    if (EXT[ext]) return EXT[ext];
    if (/^(Gemfile|Rakefile|Guardfile|Capfile|Brewfile)$/.test(base)) return 'rb';
    return null;
  };

  const cache = {};
  const compiled = (lang) => {
    if (lang in cache) return cache[lang];
    const rules = RULES[lang];
    if (!rules) return (cache[lang] = null);
    return (cache[lang] = {
      re: new RegExp(rules.map((r) => '(' + r[1].source + ')').join('|'), 'g'),
      cls: rules.map((r) => r[0]),
    });
  };

  const span = (cls, s) => (s ? '<span class="x' + cls + '">' + esc(s) + '</span>' : '');
  const indent = (s) => s.match(/^\s*/)[0].length;

  // Delimited tokens that can run past the end of a line. `open` is asked about
  // the last token on a line; `end` finds where the token closes on a later
  // line, or -1 while it is still open.
  const scanTo = (close) => (t) => { const i = t.indexOf(close); return i < 0 ? -1 : i + close.length; };
  const tplEnd = (t) => {
    for (let i = 0; i < t.length; i++) { if (t[i] === '\\') i++; else if (t[i] === '`') return i + 1; }
    return -1;
  };
  const blockComment = { cls: 'c', open: (m) => m.startsWith('/*') && !(m.length >= 4 && m.endsWith('*/')), end: scanTo('*/') };
  const OPEN = {
    js: [blockComment, { cls: 's', open: (m) => m[0] === '`' && tplEnd(m.slice(1)) === -1, end: tplEnd }],
    css: [blockComment],
    markup: [{ cls: 'c', open: (m) => m.startsWith('<!--') && !(m.length >= 7 && m.endsWith('-->')), end: scanTo('-->') }],
  };

  const tok = (text, lang, st) => {
    const c = lang && compiled(lang);
    if (!c || !text) return esc(text);
    let out = '', last = 0, m, lastTok = null;
    if (st && st.m) {
      const end = st.m.end(text);
      if (end < 0) return span(st.m.cls, text);
      out = span(st.m.cls, text.slice(0, end));
      last = end;
      st.m = null;
    }
    // lastIndex rather than slicing, so a `^` rule can't match after a closed comment.
    c.re.lastIndex = last;
    while ((m = c.re.exec(text)) !== null) {
      if (m[0] === '') { c.re.lastIndex++; continue; }
      let gi = 1;
      while (gi < m.length && m[gi] === undefined) gi++;
      out += esc(text.slice(last, m.index)) + span(c.cls[gi - 1], m[0]);
      last = m.index + m[0].length;
      lastTok = { cls: c.cls[gi - 1], text: m[0], atEnd: last === text.length };
    }
    if (st && lastTok && lastTok.atEnd && OPEN[lang]) {
      st.m = OPEN[lang].find((o) => o.cls === lastTok.cls && o.open(lastTok.text)) || null;
    }
    return out + esc(text.slice(last));
  };

  // Ruby: =begin/=end and squiggly/dash heredocs are whole-line constructs.
  const ruby = (text, st) => {
    if (st.rb) {
      if (st.rb.test(text)) st.rb = null;
      return span(st.rbCls, text);
    }
    if (/^=begin\b/.test(text)) { st.rb = /^=end\b/; st.rbCls = 'c'; return span('c', text); }
    const out = tok(text, 'rb', st);
    const h = text.replace(/#.*$/, '').match(/<<[~-](['"`]?)([A-Za-z_]\w*)\1/);
    if (h) { st.rb = new RegExp('^\\s*' + h[2] + '\\s*$'); st.rbCls = 's'; }
    return out;
  };

  // YAML: a `key: |` or `key: >` block scalar is a string until the indent drops back.
  const yaml = (text, st) => {
    if (st.blk) {
      if (!text.trim() || indent(text) > st.blk.ind) return span('s', text);
      st.blk = null;
    }
    const out = tok(text, 'yaml', st);
    if (/(?::|^\s*-)\s*[|>][-+0-9]*\s*(?:#.*)?$/.test(text)) st.blk = { ind: indent(text) };
    return out;
  };

  // Slim is indentation-based: whether a line is a tag, text, Ruby or a comment
  // depends on its leading indicator, which a flat rule list can't see. So read
  // the indicator here and hand the rest of the line to the matching rules.
  // Comments, text blocks and filters own every deeper-indented line after them.
  const FILTERS = { javascript: 'js', css: 'css', scss: 'css', sass: 'css', ruby: 'rb' };
  const blockLine = (text, b) => (b.cls ? span(b.cls, text) : b.text ? tok(text, 'slimtext') : b.lang ? hl(text, b.lang, b.st) : esc(text));
  const rubyOut = (text, st) => { st.cont = /[,\\]\s*$/.test(text); return tok(text, 'rb'); };
  const slim = (text, st) => {
    if (st.cont) return rubyOut(text, st);
    const ind = indent(text), body = text.slice(ind), pad = esc(text.slice(0, ind));
    if (st.blk) {
      if (!body || ind > st.blk.ind) return blockLine(text, st.blk);
      st.blk = null;
    }
    let m;
    if (!body) return esc(text);
    if (body[0] === '/') { st.blk = { ind, cls: 'c' }; return pad + span('c', body); }
    if (body[0] === '<') return pad + tok(body, 'markup');
    if ((m = body.match(/^[|']/))) { st.blk = { ind, text: true }; return pad + span('k', m[0]) + tok(body.slice(1), 'slimtext'); }
    if ((m = body.match(/^(?:-|==?[<>']*)/))) return pad + span('k', m[0]) + rubyOut(body.slice(m[0].length), st);
    if ((m = body.match(/^doctype\b/))) return pad + span('k', m[0]) + esc(body.slice(m[0].length));
    if ((m = body.match(/^([a-z]+):\s*$/))) {
      st.blk = FILTERS[m[1]] ? { ind, lang: FILTERS[m[1]], st: {} } : { ind, plain: true };
      return pad + span('k', body);
    }
    m = body.match(/^([A-Za-z][\w-]*(?::[\w-]+)*)?((?:[.#][\w-]+)*)/);
    if (!m[0]) return pad + tok(body, 'slimtext');
    const out = pad + span('k', m[1]) + span('t', m[2]), rest = body.slice(m[0].length);
    // Inline nesting (`li: a href=...`) is just another tag line after the colon.
    if ((m = rest.match(/^:(?=\s)/))) return out + esc(m[0]) + slim(rest.slice(1), st);
    if ((m = rest.match(/^[<>']*==?/))) return out + span('k', m[0]) + rubyOut(rest.slice(m[0].length), st);
    return out + tok(rest, 'slimattr');
  };

  function hl(text, lang, st) {
    st = st || {};
    if (lang === 'slim') return slim(text, st);
    if (lang === 'rb') return ruby(text, st);
    if (lang === 'yaml') return yaml(text, st);
    return tok(text, lang, st);
  }

  return { hl, langOf };
})();
