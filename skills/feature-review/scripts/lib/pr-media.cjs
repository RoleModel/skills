/**
 * pr-media.cjs — find the images in a PR description and download them.
 *
 * PR screenshots are usually GitHub attachments (github.com/user-attachments/...),
 * which need the gh token. The token is only ever sent to github.com; signed
 * *.githubusercontent.com URLs are fetched without it, and any other host is
 * skipped, so building a page never sends credentials anywhere else.
 *
 * Downloads are cached in the directory by URL (index.json), so the build and
 * the scripts/pr-media.cjs CLI share them.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

// Every image in a Markdown body: ![alt](url) and <img ... src="url">, plus GitHub's bare
// attachment links (a video pasted into a PR is a bare URL on its own line). Each with the
// heading it sits under, so a list of them still says what each one shows.
function findImages(body) {
  const out = [];
  let heading = '';
  const seen = new Set();
  const add = (url, alt, match) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, alt: (alt || '').trim(), heading, match });
  };
  String(body || '').split(/\r?\n/).forEach((line) => {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) heading = h[1].trim();
    for (const m of line.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[2], m[1], m[0]);
    for (const m of line.matchAll(/<img\b[^>]*>/gi)) {
      const src = m[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i), alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i);
      if (src) add(src[1], alt && alt[1], m[0]);
    }
    const bare = line.trim().match(/^https:\/\/github\.com\/user-attachments\/assets\/[\w-]+$/);
    if (bare) add(bare[0], '', bare[0]);
  });
  return out;
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ''; } };

// Download what can be downloaded into `dir`; returns [{url, alt, heading, match, file, type}] for the ones that worked.
function download(images, dir, log) {
  if (!images.length) return [];
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, 'index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) { /* first run */ }
  let token = null;
  const out = [];
  images.forEach((img, i) => {
    const cached = index[img.url];
    if (cached && fs.existsSync(path.join(dir, cached.file))) { out.push(Object.assign({}, img, cached, { file: path.join(dir, cached.file) })); return; }
    const host = hostOf(img.url);
    const github = host === 'github.com', signed = /(^|\.)githubusercontent\.com$/.test(host);
    if (!github && !signed) { if (log) log(`skipped ${img.url} (not hosted on GitHub)`); return; }
    if (github && token === null) { try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch (e) { token = ''; } }
    const tmp = path.join(dir, `.download-${i}`);
    try {
      const args = ['-sSLf', '--max-time', '60', '-o', tmp, '-w', '%{content_type}'];
      if (github && token) args.push('-H', `Authorization: token ${token}`);
      const type = execFileSync('curl', [...args, img.url], { encoding: 'utf8' }).split(';')[0].trim().toLowerCase();
      const ext = EXT[type];
      if (!ext) { fs.rmSync(tmp, { force: true }); if (log) log(`skipped ${img.url} (${type || 'unknown type'})`); return; }
      const name = `desc-${Object.keys(index).length + 1}.${ext}`;
      fs.renameSync(tmp, path.join(dir, name));
      index[img.url] = { file: name, type };
      out.push(Object.assign({}, img, { file: path.join(dir, name), type }));
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if (log) log(`could not download ${img.url} (${(e.stderr || e.message).toString().trim()})`);
    }
  });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return out;
}

const defaultDir = (pr) => path.join('tmp', 'review', `pr-${pr.number}`, 'description');

module.exports = { findImages, download, defaultDir };
