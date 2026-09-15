/**
 * Regenerate the documentation screenshots in docs/.
 *
 *   node tools/make-screenshots.mjs          all ten
 *   node tools/make-screenshots.mjs intro    just the ones whose name matches
 *
 * These are the images the README and the site use, so they have to be retaken
 * whenever the interface changes visibly — a rename, a new control, a reworked
 * chart. Doing that by hand is how they drift, which is why this is a committed
 * tool and not a scratch file.
 *
 * It borrows the test suite's approach to the network: jsDelivr is served from
 * the vendored copy of the published three.js package, and map tiles are
 * synthesised, so a shot never depends on a CDN or on OpenStreetMap being
 * reachable. Unlike the suite it asserts nothing — it only takes pictures.
 */
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ensureVendor, THREE_VERSION } from '../tests/fetch-vendor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCS = join(ROOT, 'docs');
const only = process.argv[2] || '';

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.css':'text/css', '.epw':'text/plain', '.obj':'text/plain', '.json':'application/json' };

function serve(root){
  const server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, p === '/' ? 'index.html' : p);
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

/* A pale 256 px checkered tile standing in for aerial imagery. Full tile size
   matters: the app draws each tile at its natural size, so a small stub would
   leave the stitched map mostly background. */
function crc32(buf){
  let c = ~0;
  for (const b of buf){ c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function paleTile(){
  const S = 256;
  const rows = Buffer.alloc(S * (S * 3 + 1));
  let o = 0;
  for (let y = 0; y < S; y++){
    rows[o++] = 0;
    for (let x = 0; x < S; x++){
      const v = ((x >> 5) + (y >> 5)) % 2 ? 214 : 226;
      rows[o++] = v; rows[o++] = v - 4; rows[o++] = v - 12;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const vendorRoot = await ensureVendor();
const server = await serve(ROOT);
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/index.html';
await mkdir(DOCS, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const TILE_PNG = paleTile();

async function context(viewport){
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.route('**://cdn.jsdelivr.net/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/three@([^/]+)\/(.+)$/);
    if (!m || m[1] !== THREE_VERSION) return route.fulfill({ status: 404, body: '' });
    const file = join(vendorRoot, m[2]);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({ status: 200, contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: await readFile(file, 'utf8') });
  });
  await ctx.route('**://tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG }));
  await ctx.route('**://nominatim.openstreetmap.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
  await ctx.route('**://overpass-api.de/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
  return ctx;
}

/** Open the app, wait for it to be genuinely ready, and let one frame settle. */
async function open(ctx, query = '?tour=0'){
  const page = await ctx.newPage();
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return page;
}

/* Each shot: a name, the viewport, and what to do before the shutter. */
const SHOTS = [
  { name: 'first-load', vp: { width: 1440, height: 900 } },

  { name: 'intro', vp: { width: 1280, height: 820 }, query: '?tour=1' },

  { name: 'tour', vp: { width: 1280, height: 820 }, query: '?tour=1',
    async before(page){
      for (let i = 0; i < 3; i++){ await page.click('#tour-next'); await page.waitForTimeout(260); }
    } },

  { name: 'desktop', vp: { width: 1440, height: 900 },
    async before(page){
      await page.click('[data-sec="analysis"]');
      await page.waitForTimeout(200);
      await page.click('#b-run');
      await page.waitForFunction(() => !!window.__SUNAPP.State.results, null, { timeout: 120000 });
      await page.waitForTimeout(600);
    } },

  { name: 'light', vp: { width: 1440, height: 900 },
    async before(page){
      await page.keyboard.press('t');
      await page.waitForTimeout(400);
      await page.click('[data-sec="analysis"]');
      await page.waitForTimeout(200);
      await page.click('#b-run');
      await page.waitForFunction(() => !!window.__SUNAPP.State.results, null, { timeout: 120000 });
      await page.waitForTimeout(600);
    } },

  { name: 'stereographic', vp: { width: 1440, height: 900 },
    async before(page){
      await page.click('#view-cube button[data-view="top"]');
      await page.waitForTimeout(1200);
    } },

  { name: 'basemap', vp: { width: 1440, height: 900 },
    async before(page){
      await page.click('[data-sec="basemap"]');
      await page.waitForTimeout(200);
      await page.evaluate(async () => {
        const A = window.__SUNAPP;
        A.State.basemap.source = 'osm';
        A.State.basemap.extent = 400;
        await A.loadBasemapTiles();
      });
      await page.waitForTimeout(1500);
    } },

  { name: 'dropdown', vp: { width: 1440, height: 900 },
    async before(page){
      await page.click('[data-sec="loc"]');
      await page.waitForTimeout(300);
      // The custom listbox replaces the native <select> with a .sel-btn sibling.
      await page.click('#i-city + .sel-btn');
      await page.waitForTimeout(450);
    } },

  { name: 'sheet', vp: { width: 1440, height: 900 },
    async before(page){
      await page.click('[data-sec="analysis"]');
      await page.waitForTimeout(200);
      await page.click('#b-run');
      await page.waitForFunction(() => !!window.__SUNAPP.State.results, null, { timeout: 120000 });
      await page.waitForTimeout(400);
      await page.keyboard.press('e');
      await page.waitForTimeout(600);
    } },

  { name: 'mobile', vp: { width: 390, height: 844 } },
];

let made = 0;
for (const shot of SHOTS){
  if (only && !shot.name.includes(only)) continue;
  const ctx = await context(shot.vp);
  const page = await open(ctx, shot.query);
  try {
    if (shot.before) await shot.before(page);
    await page.screenshot({ path: join(DOCS, 'screenshot-' + shot.name + '.png') });
    console.log('  ' + shot.name.padEnd(14) + shot.vp.width + '×' + shot.vp.height);
    made++;
  } catch (err){
    console.log('  ' + shot.name.padEnd(14) + 'FAILED — ' + err.message);
    process.exitCode = 1;
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + made + ' screenshot' + (made === 1 ? '' : 's') + ' written to docs/');
