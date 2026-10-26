#!/usr/bin/env node
/**
 * pr-media.cjs — download the screenshots and recordings in a PR's description,
 * so they can be reused as `image`/`video` visuals in the overview.
 *
 *   node pr-media.cjs --pr <N|url|owner/repo#N> [-o dir]
 *
 * Saves to tmp/review/pr-<N>/description/ by default (the build reads the same
 * cache) and prints one line per file: path, the heading it sat under, and its alt text.
 */
const { execFileSync } = require('child_process');
const { findImages, download, defaultDir } = require('./lib/pr-media.cjs');

const argv = process.argv.slice(2);
const opt = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
const spec = opt('--pr');
if (!spec) { console.error('usage: pr-media.cjs --pr <N|url|owner/repo#N> [-o dir]'); process.exit(2); }
const m = spec.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
const pr = JSON.parse(execFileSync('gh', ['pr', 'view', ...(m ? [m[2], '--repo', m[1]] : [spec]), '--json', 'number,body'], { encoding: 'utf8' }));
const images = findImages(pr.body);
const got = download(images, opt('-o') || defaultDir(pr), (msg) => console.error('pr-media: ' + msg));
got.forEach((g) => console.log(`${g.file}\t${g.heading ? 'under "' + g.heading + '"' : 'top of description'}${g.alt && g.alt !== 'image' ? '\t' + g.alt : ''}`));
console.error(`pr-media: ${got.length} of ${images.length} image(s) from #${pr.number}'s description`);
