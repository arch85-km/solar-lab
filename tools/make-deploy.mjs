#!/usr/bin/env node
/**
 * Sun Studio — build the files to upload to a web server.
 *
 * The app itself holds no map key — a key in a public page is readable by anyone
 * who views the source, so there is nowhere in the HTML to put one. For aerial
 * imagery this script emits a pair: the page, plus a small PHP proxy that keeps
 * the key server-side. It refuses to write the page if the key has leaked into
 * it.
 *
 *   node tools/make-deploy.mjs                      just the page
 *   node tools/make-deploy.mjs --key YOUR_KEY       page + keyed tile proxy
 *
 * Options
 *   --key KEY   your MapTiler Cloud key — goes into the PHP file only
 *   --out DIR   output directory (default: deploy/)
 *
 * Output lands in deploy/, which is gitignored, so a key-bearing file is never a
 * candidate for a commit.
 *
 * Licence: MIT, same as the app. © 2026 Karam Al-Obaidi
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_TEMPLATE = 'tile-proxy.php?z={z}&x={x}&y={y}&s={style}';

/* ── arguments ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

if (flag('--help') || flag('-h')){
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
  process.exit(0);
}

const key = (value('--key') || '').trim();
const outRoot = value('--out') || join(ROOT, 'deploy');

/* ── read the source ───────────────────────────────────────────────────── */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const php  = readFileSync(join(ROOT, 'server', 'tile-proxy.php'), 'utf8');

// The version comes from the source, so a stamped filename can never drift from
// the build it was cut from — which is what caused a round of stale downloads.
const build = (html.match(/const BUILD = '([^']+)';/) || [])[1];
if (!build) fail('Could not find the BUILD constant in index.html.');

/* ── rewrite ───────────────────────────────────────────────────────────── */

const variant = key ? 'proxy' : 'plain';
let page = html;

if (key){
  // Takes the "e.g." comment with it, which would otherwise read as if the
  // line were still unconfigured.
  page = replaceOnce(page, /const PROXY_URL = '';[^\n]*/,
                           `const PROXY_URL = '${PROXY_TEMPLATE}';`, 'PROXY_URL');
}

/* ── the check that matters ────────────────────────────────────────────── */

// Everything above is convenience; this is the part that makes the build safe.
if (key && page.includes(key)){
  fail('The key appears in the generated page. Refusing to write it.');
}

/* ── write ─────────────────────────────────────────────────────────────── */

const dir = join(outRoot, `sun-studio-v${build}-${variant}`);
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir, { recursive: true });

// Named index.html because that is what it is uploaded as; PROXY_URL is a
// relative path, so the pair works in any directory under any domain.
writeFileSync(join(dir, 'index.html'), page);
const written = ['index.html'];

if (key){
  writeFileSync(join(dir, 'tile-proxy.php'),
    replaceOnce(php, "$MAPTILER_KEY = 'PUT_YOUR_MAPTILER_KEY_HERE';",
                     `$MAPTILER_KEY = '${key}';`, '$MAPTILER_KEY'));
  written.push('tile-proxy.php');
}

/* ── say what to do with it ────────────────────────────────────────────── */

console.log(`Sun Studio v${build} — ${variant}`);
console.log(`  ${dir}`);
for (const f of written) console.log(`    ${f}`);
console.log('');
if (variant === 'proxy'){
  console.log('Upload BOTH files into the same folder on your server, keeping these names.');
  console.log('The key is only in tile-proxy.php, which the server executes rather than');
  console.log('serves, so it is not readable from the page. Do not set an allowed-origins');
  console.log('restriction on this key: the proxy requests tiles server-side and sends no');
  console.log('browser origin, so the restriction would block it.');
} else {
  console.log('One file, no key anywhere: OpenStreetMap tiles, a custom tile service, or');
  console.log('an uploaded site image. Pass --key YOUR_KEY to add aerial imagery through');
  console.log('the tile proxy.');
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Substitute, insisting the target appears exactly once. */
function replaceOnce(text, needle, replacement, label){
  const n = needle instanceof RegExp
    ? (text.match(new RegExp(needle.source, 'g')) || []).length
    : text.split(needle).length - 1;
  if (n !== 1) fail(`Expected exactly one ${label} to substitute, found ${n}.`);
  return text.replace(needle, replacement);
}
function fail(msg){
  console.error('make-deploy: ' + msg);
  process.exit(1);
}
