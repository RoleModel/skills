#!/usr/bin/env node
/**
 * serve-review.cjs: serve a built review page on localhost so its buttons can
 * reach the disk and gh: "Save for agent" writes the review as Markdown + JSON
 * next to the page, and "Submit review" posts it to the PR.
 *
 * Usage:
 *   node serve-review.cjs tmp/review/KATT-123.html [--port 4823] [--keep-alive]
 *
 * GET /api/file?path=... returns a file's text at the reviewed commit, which
 * is how the page expands context around hunks. Only files in the page's own
 * diff, only at its head commit.
 *
 * Prints the URL, then one line per save or submit. Exits after a successful
 * submit unless --keep-alive, so an agent running it in the background is
 * notified when the review has gone out.
 *
 * Binds 127.0.0.1 only. Every API call must carry the token injected into the
 * served page, and the Host header must be the loopback address, which keeps
 * other pages in the browser (and DNS rebinding) from posting reviews.
 * The default port is fixed so the page keeps its origin, and with it the
 * viewed checkmarks and drafts held in localStorage, across runs.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { submitReview, saveReview } = require('./submit-review.cjs');
const { parseDiff } = require('./lib/diff-parse.cjs');

const PLACEHOLDER = '<script id="server-src" type="application/json">null</script>';
const island = (html, id) => {
  const m = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
};

function serve(htmlPath, { port = 4823, keepAlive = false } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const outDir = path.dirname(path.resolve(htmlPath));
  let bound = port;

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) { reject(new Error('review too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${bound}` && host !== `localhost:${bound}`) return send(res, 403, { error: 'bad host' });
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      // Re-read each time so a rebuilt page (new reading guide) shows up on refresh.
      const html = fs.readFileSync(htmlPath, 'utf8').replace(PLACEHOLDER,
        `<script id="server-src" type="application/json">${JSON.stringify({ token })}</script>`);
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.headers['x-review-token'] !== token) return send(res, 403, { error: 'bad token; reload the page' });
    if (req.method === 'GET' && url.pathname === '/api/file') {
      try {
        const html = fs.readFileSync(htmlPath, 'utf8');
        const meta = island(html, 'meta-src') || {};
        const file = url.searchParams.get('path');
        if (!meta.headRev) return send(res, 404, { error: 'this page was built without a commit, so there is no file to read' });
        if (!parseDiff(island(html, 'diff-src') || '').some((f) => f.name === file)) return send(res, 403, { error: 'not a file in this diff' });
        const text = execFileSync('git', ['show', `${meta.headRev}:${file}`],
          { cwd: meta.repoRoot || process.cwd(), encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
        return send(res, 200, text, 'text/plain; charset=utf-8');
      } catch (e) {
        return send(res, 400, { error: (e.stderr || e.message).toString().trim() });
      }
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    try {
      const review = JSON.parse(await readBody(req));
      const action = url.pathname.slice(5);
      if (action === 'save') {
        const saved = saveReview(review, outDir);
        console.log(`saved: ${saved.markdown}`);
        return send(res, 200, saved);
      }
      if (action === 'check') return send(res, 200, submitReview(review, { dryRun: true, outDir }));
      if (action === 'submit') {
        saveReview(review, outDir);
        const result = submitReview(review, { outDir });
        console.log(`submitted: ${result.url}`);
        result.notes.forEach((n) => console.log(`note: ${n}`));
        send(res, 200, result);
        if (!keepAlive) setTimeout(() => process.exit(0), 300);
        return;
      }
      return send(res, 404, { error: 'unknown action' });
    } catch (e) {
      console.error(`error: ${e.message}`);
      return send(res, 400, { error: e.message });
    }
  });

  // One 'listening' handler for all attempts: a callback passed to each listen() call would stay
  // registered after EADDRINUSE and fire too, printing the URL once per port tried.
  server.once('listening', () => {
    bound = server.address().port;
    console.log(`serving http://127.0.0.1:${bound}/ (Ctrl-C to stop${keepAlive ? '' : '; exits after submit'})`);
  });
  const listen = (p, triesLeft) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && triesLeft) listen(p + 1, triesLeft - 1);
      else { console.error(`error: ${e.message}`); process.exit(1); }
    });
    server.listen(p, '127.0.0.1');
  };
  listen(port, 10);
  return server;
}

module.exports = { serve };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port');
  if (!file || !fs.existsSync(file)) { console.error('usage: serve-review.cjs <page.html> [--port N] [--keep-alive]'); process.exit(2); }
  const i = argv.indexOf('--port');
  serve(file, { port: i === -1 ? 4823 : +argv[i + 1], keepAlive: argv.includes('--keep-alive') });
}
