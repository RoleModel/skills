/**
 * page.cjs: assemble the review page from the skill's current page/ assets and a built page's data.
 *
 * The build writes a self-contained page. serve-review.cjs calls fromBuilt() on every load, so the
 * shell, styles and scripts always come from the skill on disk: pull an updated skill, refresh the
 * page, and it runs the new code against the same review data (drafts live in localStorage).
 */
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'page');
const asset = (f) => fs.readFileSync(path.join(PAGE, f), 'utf8');
const SERVER_PLACEHOLDER = '<script id="server-src" type="application/json">null</script>';

function render({ titleHtml, islands }) {
  const js = [fs.readFileSync(path.join(__dirname, 'diff-parse.cjs'), 'utf8'), asset('highlight.js'), asset('markdown.js'),
    asset('diagrams.js'), asset('app.js')].join('\n;\n').replace(/<\/script/gi, '<\\/script');
  const parts = { title: titleHtml, style: asset('style.css'), islands: islands + '\n' + SERVER_PLACEHOLDER, script: js };
  // A function replacement, so "$" in the scripts or data is never read as a pattern.
  return asset('shell.html').replace(/\{\{(title|style|islands|script)\}\}/g, (m, k) => parts[k]);
}

// The data islands of a built page, minus the server placeholder, and its (already escaped) title.
function fromBuilt(html) {
  const islands = (html.match(/<script id="[\w-]+" type="application\/json">[\s\S]*?<\/script>/g) || [])
    .filter((s) => !s.startsWith('<script id="server-src"')).join('\n');
  const t = html.match(/<title>([\s\S]*?)<\/title>/);
  return render({ titleHtml: t ? t[1] : 'Review', islands });
}

module.exports = { render, fromBuilt, SERVER_PLACEHOLDER };
