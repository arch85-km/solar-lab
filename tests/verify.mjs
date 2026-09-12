/**
 * Headless verification for index.html.
 *
 * The published app loads three.js from jsDelivr. This sandbox has no route to
 * the CDN, so every jsDelivr request is intercepted and served from the copy of
 * the *published npm package* under tests/.vendor — which also proves the
 * importmap URLs point at paths that really exist in three@<version>.
 *
 * Physics assertions are checked against an independent reference: the Chicago
 * TMY3 EPW's own measured Global Horizontal Radiation.
 */
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ensureVendor, ensureEpw, THREE_VERSION } from './fetch-vendor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS = join(HERE, 'screenshots');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.css':'text/css', '.epw':'text/plain', '.obj':'text/plain', '.json':'application/json' };

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = ''){
  results.push({ name, ok, detail });
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else    { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, tolPct) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) <= tolPct / 100;

/* --------------------------------------------------------------- server --- */
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

/* ------------------------------------------------------------------ main --- */
const vendorRoot = await ensureVendor();
const epwPath = await ensureEpw();
const server = await serve(ROOT);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const cdnHits = new Set();
await ctx.route('**://cdn.jsdelivr.net/**', async (route) => {
  const url = new URL(route.request().url());
  const m = url.pathname.match(/^\/npm\/three@([^/]+)\/(.+)$/);
  if (!m) return route.fulfill({ status: 404, body: 'unexpected CDN path: ' + url.pathname });
  if (m[1] !== THREE_VERSION)
    return route.fulfill({ status: 404, body: 'version mismatch: page asked for ' + m[1] });
  const file = join(vendorRoot, m[2]);
  if (!existsSync(file))
    return route.fulfill({ status: 404, body: 'not in published package: ' + m[2] });
  cdnHits.add(m[2]);
  await route.fulfill({ status: 200, contentType: 'text/javascript',
                        headers: { 'access-control-allow-origin': '*' }, body: await readFile(file, 'utf8') });
});

/**
 * A synthetic 256 px map tile: pale, faintly checkered, like aerial imagery.
 *
 * Full tile size matters. The app draws each tile at its natural size, so a 1x1
 * stub leaves the stitched map almost entirely background colour — and then any
 * check that reads pixels "over a basemap" is really reading empty ground.
 */
function paleTile(){
  const S = 256;
  const rows = Buffer.alloc(S * (S * 3 + 1));
  let o = 0;
  for (let y = 0; y < S; y++){
    rows[o++] = 0;                                   // no per-row filter
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
  ihdr[8] = 8; ihdr[9] = 2;                          // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function crc32(buf){
  let c = ~0;
  for (const b of buf){
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
const TILE_PNG = paleTile();

// Synthetic map tiles, so orientation and count can be asserted without hitting
// OpenStreetMap's servers.
let tileRequests = [];
await ctx.route('**://tile.openstreetmap.org/**', async (route) => {
  const m = new URL(route.request().url()).pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!m) return route.fulfill({ status: 404, body: '' });
  tileRequests.push({ z: +m[1], x: +m[2], y: +m[3] });
  await route.fulfill({ status: 200, contentType: 'image/png',
                        headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG });
});

let geocodeRequests = 0;
await ctx.route('**://nominatim.openstreetmap.org/**', async (route) => {
  geocodeRequests++;
  await route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([
      { display_name: 'Sheffield School of Architecture, Sheffield, South Yorkshire, England',
        lat: '53.3811', lon: '-1.4701' },
      { display_name: 'Sheffield, South Yorkshire, England', lat: '53.3800', lon: '-1.4700' },
    ]),
  });
});

const page = await ctx.newPage();
const consoleErrors = [];
// The rejected-key test provokes real 403s on purpose, and the browser logs every
// failed image load. Suppress only inside that window, so genuine console errors
// anywhere else still fail the run.
let expectTileErrors = false;
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (expectTileErrors && /403|Forbidden|Failed to load resource/i.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

console.log('\n=== boot ===');
await page.goto('http://127.0.0.1:' + port + '/index.html?tour=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
check('app boots and exposes its API', true);
const boot = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('.sec')];
  return {
    total: secs.length,
    open: secs.filter(x => !x.classList.contains('closed')).map(x => x.dataset.sec),
    title: document.title,
    brand: document.querySelector('.brand-text b').textContent,
  };
});
check('every panel section starts collapsed',
      boot.total > 0 && boot.open.length === 0,
      boot.total + ' sections, open: ' + (boot.open.join(', ') || 'none'));
const stamp = await page.evaluate(() => ({
  build: window.__SUNAPP.BUILD,
  shown: (document.getElementById('build-tag') || {}).textContent,
  credit: document.querySelector('#statusbar .credit').textContent,
}));
check('the build version is visible in the status bar',
      !!stamp.build && stamp.shown === 'v' + stamp.build &&
      stamp.credit.includes('Karam Al-Obaidi') && stamp.credit.includes('v' + stamp.build),
      '"' + stamp.credit.trim() + '"');
check('the old key Show button is gone',
      await page.evaluate(() => !document.getElementById('b-bm-key-show')));

check('app is titled Sun Studio',
      boot.title === 'Sun Studio' && boot.brand === 'Sun Studio',
      'title "' + boot.title + '", brand "' + boot.brand + '"');
check('importmap resolves against the real published package',
      cdnHits.has('build/three.module.js') &&
      cdnHits.has('examples/jsm/controls/OrbitControls.js') &&
      cdnHits.has('examples/jsm/loaders/OBJLoader.js'),
      [...cdnHits].join(', '));

// First-load appearance: London, clear-sky model, demo massing, nothing imported
{ const { mkdir } = await import('node:fs/promises');
  await mkdir(SHOTS, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, 'first-load.png') }); }

/* ------------------------------------------------------- solar geometry --- */
console.log('\n=== solar geometry ===');

const clearSky = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const site = { lat: 51.48, lon: -0.45, tz: 0, el: 25 };
  const noon = A.SolarCore.dayInfo(site, 172, 0).solarNoon;
  const sun = A.SolarCore.position(site, 172, noon, 0);
  const cs = A.ClearSky.irradiance(sun.altitude, 172, 25);
  A.setAnalysis({ mode: 'inst', density: 1, useGround: false });
  A.State.doy = 172; A.State.minutes = Math.round(noon);
  const src = A.buildSources();
  return { alt: sun.altitude, ...cs, horiz: A.unobstructed(0, 1, 0, src) };
});
check('clear-sky model gives a plausible London midsummer noon global horizontal',
      clearSky.ghi > 780 && clearSky.ghi < 1000,
      Math.round(clearSky.ghi) + ' W/m² at ' + clearSky.alt.toFixed(1) + '° altitude');
check('clear-sky sky matrix reproduces its own global horizontal',
      near(clearSky.horiz, clearSky.ghi, 2),
      clearSky.horiz.toFixed(1) + ' vs ' + clearSky.ghi.toFixed(1) + ' W/m²');

const eq = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const site = { lat: 51.48, lon: -0.45, tz: 0, el: 25 };
  const info = A.SolarCore.dayInfo(site, 80, 0);          // 21 March
  const noon = A.SolarCore.position(site, 80, info.solarNoon, 0);
  return { alt: noon.altitude, decl: noon.decl, az: noon.azimuth, lat: site.lat };
});
check('London equinox solar-noon altitude equals 90 - latitude + declination',
      Math.abs(eq.alt - (90 - eq.lat + eq.decl)) < 0.6,
      'alt ' + eq.alt.toFixed(2) + '°, expected ' + (90 - eq.lat + eq.decl).toFixed(2) + '°');
check('London solar noon puts the sun due south',
      Math.abs(eq.az - 180) < 1.0, 'azimuth ' + eq.az.toFixed(2) + '°');

const jun = await page.evaluate(() => {
  const A = window.__SUNAPP;
  return A.SolarCore.dayInfo({ lat: 51.48, lon: -0.45, tz: 0, el: 25 }, 172, 0);
});
// Heathrow, 21 June: sunrise 04:44 BST = 03:44 GMT, sunset 21:22 BST = 20:22 GMT
check('London 21 June sunrise within 6 min of published time',
      Math.abs(jun.sunrise - (3 * 60 + 44)) <= 6,
      'computed ' + Math.floor(jun.sunrise/60) + ':' + String(Math.round(jun.sunrise%60)).padStart(2,'0') + ' GMT');
check('London 21 June sunset within 6 min of published time',
      Math.abs(jun.sunset - (20 * 60 + 22)) <= 6,
      'computed ' + Math.floor(jun.sunset/60) + ':' + String(Math.round(jun.sunset%60)).padStart(2,'0') + ' GMT');

const syd = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const site = { lat: -33.95, lon: 151.18, tz: 10, el: 3 };
  const info = A.SolarCore.dayInfo(site, 172, 0);
  const noon = A.SolarCore.position(site, 172, info.solarNoon, 0);
  return { day: info.dayLength, az: noon.azimuth, alt: noon.altitude };
});
check('Sydney 21 June is a short winter day', syd.day > 9.4 && syd.day < 10.3, syd.day.toFixed(2) + ' h');
check('Sydney winter noon sun is due north (southern hemisphere)',
      Math.min(Math.abs(syd.az), Math.abs(syd.az - 360)) < 1.5, 'azimuth ' + syd.az.toFixed(2) + '°');

/* ---------------------------------------------------------- sky patches --- */
console.log('\n=== sky discretisation ===');
const dome = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const t = A.buildSkyDome(1), r = A.buildSkyDome(2);
  const sum = (d) => { let s = 0; for (let i = 0; i < d.count; i++) s += d.solidAngle[i]; return s; };
  return { tregenza: t.count, reinhart: r.count, omegaT: sum(t), omegaR: sum(r) };
});
check('Tregenza sky has 145 patches', dome.tregenza === 145, String(dome.tregenza));
check('Reinhart sky has 577 patches', dome.reinhart === 577, String(dome.reinhart));
check('sky patch solid angles sum to a hemisphere (2π sr)',
      near(dome.omegaT, 2 * Math.PI, 0.01) && near(dome.omegaR, 2 * Math.PI, 0.01),
      dome.omegaT.toFixed(6) + ' sr');

/* ------------------------------------------------------------------- EPW --- */
console.log('\n=== EPW import (Chicago O\'Hare TMY3) ===');
const epwText = await readFile(epwPath, 'utf8');
const epwInfo = await page.evaluate((text) => {
  const A = window.__SUNAPP;
  const w = A.EPW.parse(text, 'chicago.epw');
  A.applyEPW(w);
  return { site: w.site, summary: w.summary };
}, epwText);
check('EPW LOCATION header parsed', near(epwInfo.site.lat, 41.98, 0.1) && near(epwInfo.site.lon, -87.92, 0.1)
      && epwInfo.site.tz === -6, JSON.stringify({ lat: epwInfo.site.lat, lon: epwInfo.site.lon, tz: epwInfo.site.tz }));
check('EPW annual global horizontal reads 1406.6 kWh/m²',
      near(epwInfo.summary.annualGhi, 1406.6, 0.5), epwInfo.summary.annualGhi.toFixed(1) + ' kWh/m²');
check('EPW sun-up hours read 4703', epwInfo.summary.sunUpHours === 4703, String(epwInfo.summary.sunUpHours));

/* -------------------------------------------------- Perez normalisation --- */
console.log('\n=== Perez sky model ===');
const perez = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const dome = A.buildSkyDome(1);
  const out = new Float64Array(dome.count);
  const cases = [
    { alt: 55, az: 180, dni: 850, dhi: 120 },   // clear
    { alt: 30, az: 140, dni: 300, dhi: 260 },   // intermediate
    { alt: 12, az: 105, dni:   0, dhi: 90  },   // overcast, low sun
    { alt: 78, az: 180, dni: 900, dhi: 100 },   // clear, high sun
  ];
  return cases.map(c => {
    A.Perez.patchIrradiance(dome, c.alt, c.az, c.dni, c.dhi, 172, out);
    let horiz = 0;
    for (let i = 0; i < dome.count; i++) horiz += out[i] * Math.sin(dome.altitude[i]);
    return { dhi: c.dhi, horiz, alt: c.alt };
  });
});
for (const p of perez){
  check('Perez sky integrates back to DHI (sun at ' + p.alt + '°)',
        near(p.horiz, p.dhi, 0.5), p.horiz.toFixed(2) + ' vs ' + p.dhi + ' W/m²');
}

/* ------------------------------------- annual energy on a horizontal plane --- */
console.log('\n=== annual energy balance vs EPW ===');
const annual = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.setAnalysis({ mode: 'cum', period: 'year', density: 1, useGround: false, hourFrom: 0, hourTo: 24 });
  const src = A.buildSources();
  const horizWh = A.unobstructed(0, 1, 0, src);
  return { kwh: horizWh / 1000, ghiSum: src.meta.ghiSum / 1000,
           nSky: src.meta.nSky, nSun: src.meta.nSun, hours: src.meta.hours };
});
check('annual cumulative on an unobstructed horizontal plane matches the EPW total',
      near(annual.kwh, 1406.6, 3),
      annual.kwh.toFixed(1) + ' kWh/m² vs EPW 1406.6 kWh/m² (' +
      ((annual.kwh / 1406.6 - 1) * 100).toFixed(2) + '%)');
check('direct beam binned into a manageable number of unique sun directions',
      annual.nSun > 150 && annual.nSun < 1500, annual.nSun + ' sun bins from 4703 sun-up hours');
check('sky matrix covers all 8760 hours', annual.hours === 8760, String(annual.hours));

/* ------------------------------------------------ instantaneous vs EPW GHI --- */
const inst = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.setAnalysis({ mode: 'inst', density: 1, useGround: false });
  let sumComputed = 0, sumEpw = 0, worst = 0;
  for (let doy = 5; doy <= 365; doy += 7){
    for (let h = 0; h < 24; h++){
      A.State.doy = doy; A.State.minutes = h * 60 + 30;
      const src = A.buildSources();
      const c = A.unobstructed(0, 1, 0, src);
      const e = A.State.weather.ghi[(doy - 1) * 24 + h];
      sumComputed += c; sumEpw += e;
      if (e > 200) worst = Math.max(worst, Math.abs(c - e) / e);
    }
  }
  return { sumComputed, sumEpw, worst };
});
check('instantaneous horizontal irradiance reproduces EPW global horizontal',
      near(inst.sumComputed, inst.sumEpw, 4),
      'sampled sum ' + Math.round(inst.sumComputed) + ' vs ' + Math.round(inst.sumEpw) +
      ' W/m² (' + ((inst.sumComputed / inst.sumEpw - 1) * 100).toFixed(2) + '%)');

/* ------------------------------------------------------- ground-reflected --- */
const grnd = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.setAnalysis({ mode: 'inst', density: 1, useGround: true, groundRefl: 0.2 });
  A.State.doy = 172; A.State.minutes = 720;
  const src = A.buildSources();
  const down = A.unobstructed(0, -1, 0, src);              // a soffit sees only the ground
  const h = clamp => 0;
  const ghi = A.State.weather.ghi[(172 - 1) * 24 + 12];
  return { down, expected: 0.2 * ghi, ghi };
});
check('a downward-facing surface receives reflectance × GHI',
      near(grnd.down, grnd.expected, 1),
      grnd.down.toFixed(1) + ' vs ' + grnd.expected.toFixed(1) + ' W/m²');

/* ------------------------------------------------------- shading and mesh --- */
console.log('\n=== geometry, shading and results ===');
const box = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.loadSample('box');
  A.setAnalysis({ mode: 'cum', period: 'year', unit: 'kwh', density: 1,
                  gridSize: 2, useGround: true, groundRefl: 0.2, shade: true });
  await A.runAnalysis();
  const r = A.State.results;
  const g = {};
  for (let i = 0; i < r.sensors.count; i++){
    const k = A.orientOf(r.sensors.normals[i*3], r.sensors.normals[i*3+1], r.sensors.normals[i*3+2]);
    (g[k] = g[k] || { s: 0, a: 0 });
    g[k].s += r.values[i] * r.sensors.areas[i];
    g[k].a += r.sensors.areas[i];
  }
  const mean = {};
  for (const k in g) mean[k] = g[k].s / g[k].a;
  return { mean, count: r.sensors.count, unit: r.unit, ms: r.ms };
});
check('a box in Chicago receives most annual radiation on its roof',
      box.mean.Roof > box.mean.S && box.mean.S > box.mean.N,
      'roof ' + box.mean.Roof.toFixed(0) + ', south ' + box.mean.S.toFixed(0) +
      ', north ' + box.mean.N.toFixed(0) + ' kWh/m²');
check('east and west faces are near-symmetric on an unobstructed box',
      near(box.mean.E, box.mean.W, 3),
      'east ' + box.mean.E.toFixed(0) + ' vs west ' + box.mean.W.toFixed(0) + ' kWh/m²');
check('roof annual radiation is close to the site global horizontal',
      near(box.mean.Roof, 1406.6, 8), box.mean.Roof.toFixed(0) + ' kWh/m² vs 1406.6 site GHI');

const shade = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.loadSample('court');
  A.setAnalysis({ mode: 'cum', period: 'year', unit: 'kwh', gridSize: 2.5, shade: true });
  await A.runAnalysis();
  let withShade = 0, aw = 0;
  let r = A.State.results;
  for (let i = 0; i < r.sensors.count; i++){ withShade += r.values[i] * r.sensors.areas[i]; aw += r.sensors.areas[i]; }
  A.setAnalysis({ shade: false });
  await A.runAnalysis();
  r = A.State.results;
  let noShade = 0;
  for (let i = 0; i < r.sensors.count; i++) noShade += r.values[i] * r.sensors.areas[i];
  return { withShade: withShade / aw, noShade: noShade / aw, n: r.sensors.count };
});
check('self-shading in a courtyard reduces incident radiation',
      shade.withShade < shade.noShade * 0.97,
      'shaded ' + shade.withShade.toFixed(0) + ' vs unshaded ' + shade.noShade.toFixed(0) + ' kWh/m²');

/* ------------------------------------------------------------ OBJ import --- */
const objText = [
  '# 10 x 10 x 10 cube',
  'v 0 0 0','v 10 0 0','v 10 0 10','v 0 0 10',
  'v 0 10 0','v 10 10 0','v 10 10 10','v 0 10 10',
  'f 1 2 3','f 1 3 4','f 5 7 6','f 5 8 7',
  'f 1 6 2','f 1 5 6','f 2 7 3','f 2 6 7',
  'f 3 8 4','f 3 7 8','f 4 5 1','f 4 8 5',
].join('\n');
const obj = await page.evaluate((text) => {
  const A = window.__SUNAPP;
  const before = A.State.model.count;
  const blobFile = new File([text], 'cube.obj', { type: 'text/plain' });
  return new Promise((res) => {
    const input = document.getElementById('f-obj');
    const dt = new DataTransfer();
    dt.items.add(blobFile);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    setTimeout(() => res({ before, after: A.State.model.count, name: A.State.objName,
                           height: A.State.modelHeight }), 400);
  });
}, objText);
check('OBJ import replaces the model', obj.after === 12 && obj.name === 'cube.obj',
      obj.after + ' triangles, ' + obj.height.toFixed(1) + ' m tall');

/* ------------------------------------------------------ chrome and credit --- */
console.log('\n=== chrome, credit and controls ===');

const chrome = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.refresh(true);
  const credit = document.querySelector('#statusbar .credit');
  const items = document.getElementById('status-items');
  return {
    credit: credit ? credit.textContent.trim() : null,
    statusItems: items ? items.children.length : 0,
    statusText: items ? items.textContent : '',
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  };
});
check('author credit is present at the bottom left',
      /^© Karam Al-Obaidi/.test(chrome.credit), String(chrome.credit));
check('status bar still renders after the footer was split',
      chrome.statusItems > 5 && /Chicago|London/.test(chrome.statusText),
      chrome.statusItems + ' readouts');

// The orientation table only exists once an analysis has been run
const tableAlign = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.loadSample('box');
  A.setAnalysis({ mode: 'inst', gridSize: 4 });
  await A.runAnalysis();
  const rows = document.querySelectorAll('#orient-tbl tr');
  const body = rows[1];
  const cells = body ? [...body.children] : [];
  const heads = [...(rows[0] ? rows[0].children : [])];
  return {
    rows: rows.length,
    firstCell: cells[0] ? getComputedStyle(cells[0]).textAlign : null,
    numCell:   cells[2] ? getComputedStyle(cells[2]).textAlign : null,
    firstHead: heads[0] ? getComputedStyle(heads[0]).textAlign : null,
    numHead:   heads[2] ? getComputedStyle(heads[2]).textAlign : null,
  };
});
check('results table: numeric cells align with their headers',
      tableAlign.numCell === 'right' && tableAlign.numHead === 'right',
      'cell ' + tableAlign.numCell + ', header ' + tableAlign.numHead);
check('results table: the face column stays left-aligned',
      tableAlign.firstCell === 'left' && tableAlign.firstHead === 'left',
      'cell ' + tableAlign.firstCell + ', header ' + tableAlign.firstHead);

/* ---------------------------------------------------------- dropdown flash --- */
check('page declares a dark color-scheme so native popups are not light',
      /dark/.test(chrome.colorScheme), chrome.colorScheme);

// The native popup is out of the interaction path entirely: each select is
// hidden and a listbox of our own is what the user operates. That is the only
// way to stop the OS-painted popup flashing, so the checks below are about the
// replacement, not about styling <option>.
const dd = await page.evaluate(() => {
  const sel = document.getElementById('i-city');
  const btn = sel.nextElementSibling;
  return {
    enhanced: sel.dataset.enhanced === '1',
    hidden: getComputedStyle(sel).clipPath !== 'none' || getComputedStyle(sel).display === 'none',
    notTabbable: sel.getAttribute('tabindex') === '-1' && sel.getAttribute('aria-hidden') === 'true',
    isButton: !!btn && btn.classList.contains('sel-btn'),
    chevron: btn ? getComputedStyle(btn).backgroundImage : 'none',
    label: btn ? btn.querySelector('.lbl').textContent : '',
    selectedText: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '',
    haspopup: btn ? btn.getAttribute('aria-haspopup') : null,
    count: window.__SUNAPP.Selects.count,
    inDom: document.querySelectorAll('select').length,
  };
});
check('every dropdown in the page is replaced by a custom listbox',
      dd.enhanced && dd.isButton && dd.count === dd.inDom && dd.count >= 9,
      dd.count + ' of ' + dd.inDom + ' selects enhanced');
check('the native select is hidden and unreachable, so no OS popup can open',
      dd.hidden && dd.notTabbable);
check('the custom button mirrors the select and keeps its chevron',
      dd.label === dd.selectedText && dd.label.length > 0 &&
      dd.chevron !== 'none' && dd.haspopup === 'listbox',
      'button "' + dd.label + '" vs option "' + dd.selectedText + '"');

// Picking a row must behave exactly like the native control did
const ddPick = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  const sel = document.getElementById('i-sample');
  const btn = sel.nextElementSibling;
  btn.click();
  await new Promise(r => setTimeout(r, 120));
  const list = [...document.querySelectorAll('.sel-list')].find(l => !l.hidden);
  const rows = [...list.querySelectorAll('.sel-opt')];
  const target = rows.find(r => r.dataset.value === 'court');
  const opened = rows.length;
  target.click();
  await new Promise(r => setTimeout(r, 250));
  return {
    opened,
    value: sel.value,
    label: btn.querySelector('.lbl').textContent,
    triangles: A.State.model.count,
    closed: [...document.querySelectorAll('.sel-list')].every(l => l.hidden),
    expanded: btn.getAttribute('aria-expanded'),
  };
});
check('clicking a row sets the select, fires change and runs the existing handler',
      ddPick.value === 'court' && /Courtyard/.test(ddPick.label) && ddPick.triangles > 0,
      ddPick.opened + ' rows → "' + ddPick.label + '", ' + ddPick.triangles + ' triangles loaded');
check('choosing an option closes the list', ddPick.closed && ddPick.expanded === 'false');

const ddKeys = await page.evaluate(async () => {
  // Panel sections start collapsed, and focus() is a no-op inside display:none,
  // so open the section first — which is the state a user would be in anyway.
  document.querySelector('.sec[data-sec="model"]').classList.remove('closed');
  const sel = document.getElementById('i-units');
  const btn = sel.nextElementSibling;
  btn.focus();
  const fire = (key) => btn.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  fire('Enter');
  await new Promise(r => setTimeout(r, 100));
  const openedByKeyboard = [...document.querySelectorAll('.sel-list')].some(l => !l.hidden);
  fire('ArrowDown'); fire('Enter');
  await new Promise(r => setTimeout(r, 150));
  const afterEnter = sel.value;
  const focusedAfterChoose = document.activeElement === btn;
  btn.click(); await new Promise(r => setTimeout(r, 100));
  fire('Escape'); await new Promise(r => setTimeout(r, 100));
  return {
    openedByKeyboard, afterEnter, focusedAfterChoose,
    closedByEscape: [...document.querySelectorAll('.sel-list')].every(l => l.hidden),
    focusBack: document.activeElement === btn,
  };
});
check('the listbox is fully keyboard operable',
      ddKeys.openedByKeyboard && ddKeys.afterEnter !== '1',
      'arrow+enter selected unit scale "' + ddKeys.afterEnter + '"');
check('Escape closes the list and returns focus to the button',
      ddKeys.closedByEscape && ddKeys.focusBack);

const ddSync = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const sel = document.getElementById('i-density');
  const btn = sel.nextElementSibling;
  sel.value = '2';                       // a programmatic write fires no event
  const stale = btn.querySelector('.lbl').textContent;
  A.refresh(true);                       // refresh() resyncs the labels
  return { stale, fresh: btn.querySelector('.lbl').textContent };
});
check('a programmatic value change is picked up on the next refresh',
      /Reinhart/.test(ddSync.fresh), '"' + ddSync.stale + '" → "' + ddSync.fresh + '"');

/* ------------------------------------------------------------ image export --- */
console.log('\n=== annotated image export ===');

const exp = await page.evaluate(() => {
  const A = window.__SUNAPP;
  const before = { w: A.State ? 0 : 0 };
  const vp = document.getElementById('viewport');
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const cnv = document.querySelector('#viewport canvas');
  const liveW = cnv.width, liveH = cnv.height;

  const probe = (sheet) => {
    const g = sheet.getContext('2d');
    const p = g.getImageData(3, 3, 1, 1).data;
    return (p[0] + p[1] + p[2]) / 3;
  };
  const dark = A.exportSheet({ theme: 'dark', scale: 2, save: false });
  const light = A.exportSheet({ theme: 'light', scale: 2, save: false });
  return {
    vw, vh, liveW, liveH,
    darkW: dark.width, darkH: dark.height, darkInfo: {
      headerH: dark.sheetInfo.headerH, footerH: dark.sheetInfo.footerH, imageH: dark.sheetInfo.imageH,
      cropH: Math.round(dark.sheetInfo.crop.h), renderH: 0 },
    lightW: light.width, lightH: light.height,
    darkLum: probe(dark), lightLum: probe(light),
    themeAfter: A.getTheme(),
    canvasAfterW: cnv.width, canvasAfterH: cnv.height,
  };
});
const di = exp.darkInfo;
check('sheet is a title block plus the render plus a footer',
      exp.darkH === di.headerH + di.imageH + di.footerH &&
      di.headerH > 0 && di.footerH > 0 && exp.darkW === Math.round(exp.vw * 2),
      exp.darkW + ' × ' + exp.darkH + ' px (header ' + di.headerH + ' + image ' + di.imageH +
      ' + footer ' + di.footerH + ')');
check('the render is cropped to the sun path and model, not the empty viewport',
      di.cropH < exp.vh * 2 * 0.97, 'crop height ' + di.cropH + ' of ' + exp.vh * 2 + ' rendered px');
check('light sheet is light and dark sheet is dark',
      exp.lightLum > 200 && exp.darkLum < 60,
      'light luminance ' + Math.round(exp.lightLum) + ', dark ' + Math.round(exp.darkLum));
check('export restores the live theme and canvas size',
      exp.themeAfter === 'dark' && exp.canvasAfterW === exp.liveW && exp.canvasAfterH === exp.liveH,
      'theme ' + exp.themeAfter + ', canvas ' + exp.canvasAfterW + '×' + exp.canvasAfterH);

const expNoResults = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.loadSample('demo');                       // loadSample clears results
  const sheet = A.exportSheet({ theme: 'dark', scale: 1, save: false });
  return { hasResults: !!A.State.results, w: sheet.width, h: sheet.height };
});
check('a sun-path study can be exported with no analysis run',
      !expNoResults.hasResults && expNoResults.w > 0 && expNoResults.h > expNoResults.w * 0,
      expNoResults.w + ' × ' + expNoResults.h + ' px, results = ' + expNoResults.hasResults);

/* --------------------------------------------------- basemap and projection --- */
console.log('\n=== Web Mercator basemap ===');

// Reference values: ground resolution at the equator for 256 px tiles is
// 156543.034 m/px at zoom 0, halving each level; and London should land in a
// known tile at zoom 12.
const merc = await page.evaluate(() => {
  const M = window.__SUNAPP.Mercator;
  const p = M.project(-0.45, 51.48, 12);
  return {
    mppEq0: M.metresPerPixel(0, 0),
    mppEq19: M.metresPerPixel(0, 19),
    mpp51at19: M.metresPerPixel(51.48, 19),
    tileX: Math.floor(p.x / 256),
    tileY: Math.floor(p.y / 256),
    zoomFor400m: M.chooseZoom(51.48, 400, 6),
    zoomFor2000m: M.chooseZoom(51.48, 2000, 6),
  };
});
check('metres per pixel at the equator matches the Web Mercator constant',
      near(merc.mppEq0, 156543.034, 0.01) && near(merc.mppEq19, 156543.034 / 2 ** 19, 0.01),
      'z0 ' + merc.mppEq0.toFixed(3) + ', z19 ' + merc.mppEq19.toFixed(4));
check('resolution shrinks with the cosine of latitude',
      near(merc.mpp51at19, 156543.034 * Math.cos(51.48 * Math.PI / 180) / 2 ** 19, 0.01),
      merc.mpp51at19.toFixed(4) + ' m/px at 51.48°');
check('London projects into the expected zoom-12 tile',
      merc.tileX === 2042 && merc.tileY === 1362,
      'tile ' + merc.tileX + '/' + merc.tileY);
check('a tighter extent picks a higher zoom',
      merc.zoomFor400m.z > merc.zoomFor2000m.z &&
      merc.zoomFor400m.tiles <= 6 && merc.zoomFor2000m.tiles <= 6,
      '400 m → z' + merc.zoomFor400m.z + ' (' + merc.zoomFor400m.tiles + ' tiles), ' +
      '2000 m → z' + merc.zoomFor2000m.z + ' (' + merc.zoomFor2000m.tiles + ' tiles)');

tileRequests = [];
const bm = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.basemap.extent = 400;
  const r = await A.Basemap.loadTiles('osm');
  const m = A.Basemap.mesh;
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox;
  return {
    ...r,
    width: bb.max.x - bb.min.x,
    attribution: A.Basemap.info.attribution,
    onScreen: document.getElementById('vp-attrib').textContent,
    rotX: +m.rotation.x.toFixed(4),
    y: m.position.y,
    excluded: m.userData.noAnalysis === true,
  };
});
check('the basemap covers at least the requested extent at true metre scale',
      bm.width >= 400 && bm.width < 400 * 3,
      bm.width.toFixed(0) + ' m wide for a 400 m extent at zoom ' + bm.zoom);
check('tile requests stay within the 6x6 policy cap',
      tileRequests.length === bm.tiles && tileRequests.length <= 36,
      tileRequests.length + ' tiles requested');
check('every tile came from one zoom level, none pre-fetched beyond the extent',
      new Set(tileRequests.map(t => t.z)).size === 1, 'zoom ' + tileRequests[0].z);
check('the basemap lies flat and is excluded from analysis',
      Math.abs(bm.rotX + Math.PI / 2) < 1e-3 && bm.excluded,
      'rotX ' + bm.rotX);

// A 2 mm gap between these planes striped the map at site distances, so the
// ordering and the separation are both pinned down here.
const layers = await page.evaluate(() => window.__SUNAPP.groundLayers());
const gaps = [layers.basemap - layers.ground, layers.grid - layers.basemap];
check('ground, basemap and grid are stacked in order, all at or below the model base',
      layers.ground < layers.basemap && layers.basemap < layers.grid && layers.grid <= 0,
      'ground ' + layers.ground + ' < basemap ' + layers.basemap + ' < grid ' + layers.grid);
check('their separation is far outside depth-buffer precision',
      gaps.every(g => g >= 0.05), 'gaps ' + gaps.map(g => g.toFixed(2)).join(' / ') + ' m');
check('the grid is hidden while a basemap is shown',
      layers.gridVisible === false);
check('the shadow map is refreshed on change, not rebuilt every frame',
      layers.shadowAuto === false);

// The reported striping was the shadow camera's frustum edge: the basemap was a
// shadow receiver up to a kilometre across, so most of it sampled outside the
// depth texture. Shadows now land on a small dedicated catcher instead, which
// keeps the frustum tight no matter how large the map is.
const shad = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  const out = [];
  for (const ex of [400, 2000]){
    A.State.basemap.extent = ex;
    await A.Basemap.loadTiles('osm');
    A.refresh(true);
    out.push(A.shadowProbe());
  }
  return out;
});
check('neither the basemap nor the ground receives shadows',
      shad.every(p => p.basemapReceives === false && p.groundReceives === false));
check('the shadow frustum stays tight however large the basemap is',
      shad.every(p => p.ext < 200) && shad[0].ext === shad[1].ext,
      'basemap ' + shad.map(p => p.basemapExtent.toFixed(0) + ' m').join(' and ') +
      ' → frustum ±' + shad[0].ext.toFixed(0) + ' m both times');
check('the shadow catcher covers the model neighbourhood',
      shad.every(p => p.catcherHalf >= 60), '±' + shad[0].catcherHalf.toFixed(0) + ' m');

// Z-fighting is view-dependent: it appears at some camera angles and not others,
// which is why it read as "happens when I orbit". Sweep low elevations, where
// depth precision is worst, and look for the artefact's signature — near-black
// pixels over a light basemap.
const sweep = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  const cnv = document.querySelector('#viewport canvas');
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d');
  let worst = { darkFrac: 0, az: 0, el: 0 };
  for (const el of [4, 10, 20, 40]){
    for (let az = 0; az < 360; az += 60){
      A.orbitTo(az, el);
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      const w = 200, h = 120;
      scratch.width = w; scratch.height = h;
      sctx.drawImage(cnv, 0, 0, w, h);
      const d = sctx.getImageData(0, 0, w, h).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4)
        if ((d[i] + d[i+1] + d[i+2]) / 3 < 14) dark++;
      const darkFrac = dark / (w * h);
      if (darkFrac > worst.darkFrac) worst = { darkFrac, az, el };
    }
  }
  return worst;
});
check('no depth artefacts anywhere in an orbit sweep over a basemap',
      sweep.darkFrac < 0.01,
      'worst ' + (sweep.darkFrac * 100).toFixed(2) + '% dark at elevation ' +
      sweep.el + '°, azimuth ' + sweep.az + '° (24 positions)');
check('OpenStreetMap attribution is shown on screen',
      /OpenStreetMap contributors/.test(bm.attribution) && /OpenStreetMap contributors/.test(bm.onScreen),
      bm.onScreen);

// A basemap must not break the image export
const bmExport = await page.evaluate(() => {
  const sheet = window.__SUNAPP.exportSheet({ theme: 'dark', scale: 1, save: false });
  return { w: sheet.width, h: sheet.height };
});
check('the export still works with a basemap loaded (no tainted canvas)',
      bmExport.w > 0 && bmExport.h > 0, bmExport.w + ' × ' + bmExport.h + ' px');

const bmClear = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.Basemap.clear();
  return { mesh: A.Basemap.mesh, attrib: document.getElementById('vp-attrib').textContent };
});
check('clearing the basemap removes it and its attribution',
      bmClear.mesh === null && bmClear.attrib === '');

/* --------------------------------------------------------- keyed basemaps --- */
console.log('\n=== MapTiler and custom tile sources ===');

let maptilerUrls = [];
let maptilerStatus = 200;
await ctx.route('**://api.maptiler.com/**', async (route) => {
  maptilerUrls.push(route.request().url());
  if (maptilerStatus !== 200) return route.fulfill({ status: maptilerStatus, body: 'denied' });
  await route.fulfill({ status: 200, contentType: 'image/png',
                        headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG });
});
await ctx.route('**://tiles.example.org/**', async (route) => {
  maptilerUrls.push(route.request().url());
  await route.fulfill({ status: 200, contentType: 'image/png',
                        headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG });
});

// Key priority: URL parameter, then this browser's stored key, then the constant
{
  const keyCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await keyCtx.route('**://cdn.jsdelivr.net/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/three@[^/]+\/(.+)$/);
    const f = m && join(vendorRoot, m[1]);
    if (!f || !existsSync(f)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, contentType: 'text/javascript',
                          headers: { 'access-control-allow-origin': '*' }, body: await readFile(f, 'utf8') });
  });
  await keyCtx.addInitScript(() => {
    try { localStorage.setItem('sunpath.maptiler.v1', 'FROM_STORE'); } catch (e) {}
  });
  const kp = await keyCtx.newPage();
  const base = 'http://127.0.0.1:' + port + '/index.html';
  await kp.goto(base + '?tour=0&maptiler=FROM_URL', { waitUntil: 'load' });
  await kp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  const fromUrl = await kp.evaluate(() => window.__SUNAPP.resolveMapKey());
  await kp.goto(base + '?tour=0', { waitUntil: 'load' });
  await kp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  const fromStore = await kp.evaluate(() => window.__SUNAPP.resolveMapKey());
  await keyCtx.close();

  // A clean context, with no init script re-seeding storage, exercises the
  // constant fallback — the state a fresh visitor to the committed file is in.
  const bareCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await bareCtx.route('**://cdn.jsdelivr.net/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/three@[^/]+\/(.+)$/);
    const f = m && join(vendorRoot, m[1]);
    if (!f || !existsSync(f)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, contentType: 'text/javascript',
                          headers: { 'access-control-allow-origin': '*' }, body: await readFile(f, 'utf8') });
  });
  const bp = await bareCtx.newPage();
  await bp.goto(base + '?tour=0', { waitUntil: 'load' });
  await bp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  const fromConst = await bp.evaluate(() => window.__SUNAPP.resolveMapKey());
  await bareCtx.close();

  check('the key comes from the URL first, then storage, then the constant',
        fromUrl === 'FROM_URL' && fromStore === 'FROM_STORE' && fromConst === '',
        [fromUrl, fromStore, JSON.stringify(fromConst)].join(' → '));

  // Checked at the file level too: no key may ever be committed
  const src = await readFile(join(ROOT, 'index.html'), 'utf8');
  check('the committed file carries an empty key constant',
        /const MAPTILER_KEY = '';/.test(src) && fromConst === '',
        (src.match(/const MAPTILER_KEY = '[^']*';/) || ['not found'])[0]);
}

maptilerUrls = [];
const mt = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  try { localStorage.setItem('sunpath.maptiler.v1', 'TESTKEY123'); } catch (e) {}
  A.State.basemap.source = 'maptiler';
  A.State.basemap.style = 'satellite';
  A.State.basemap.extent = 400;
  const r = await A.Basemap.loadTiles('maptiler');
  const m = A.Basemap.mesh;
  m.geometry.computeBoundingBox();
  return { ...r, width: m.geometry.boundingBox.max.x - m.geometry.boundingBox.min.x,
           attribution: A.Basemap.info.attribution,
           onScreen: document.getElementById('vp-attrib').textContent };
});
const sampleUrl = maptilerUrls[0] || '';
check('MapTiler tiles use the documented path shape with key and style',
      /\/maps\/satellite\/256\/\d+\/\d+\/\d+\.jpg\?key=TESTKEY123$/.test(sampleUrl),
      sampleUrl.replace('TESTKEY123', '<key>'));
check('imagery styles request JPEG, not PNG', /\.jpg\?/.test(sampleUrl));
check('a keyed basemap georeferences the same way as the OSM one',
      mt.width >= 400 && mt.width < 400 * 3, mt.width.toFixed(0) + ' m at zoom ' + mt.zoom);
check('MapTiler attribution is shown on screen',
      /MapTiler/.test(mt.attribution) && /MapTiler/.test(mt.onScreen), mt.onScreen);

const styleSwap = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.basemap.style = 'streets-v2';
  await A.Basemap.loadTiles('maptiler');
  return true;
});
check('a non-imagery style switches to PNG',
      styleSwap && /\/maps\/streets-v2\/256\/.*\.png\?/.test(maptilerUrls[maptilerUrls.length - 1]),
      maptilerUrls[maptilerUrls.length - 1].replace('TESTKEY123', '<key>'));

maptilerStatus = 403;
expectTileErrors = true;
const denied = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  try { await A.Basemap.loadTiles('maptiler'); return 'no error'; }
  catch (e) { return e.message; }
});
maptilerStatus = 200;
await page.waitForTimeout(150);
expectTileErrors = false;
check('a rejected key reports the key or style, not a connection problem',
      /API key/i.test(denied) && /domain|style/i.test(denied) && !/connection/i.test(denied),
      denied.slice(0, 96) + '…');

maptilerUrls = [];
const custom = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.basemap.source = 'custom';
  A.State.basemap.customUrl = 'https://tiles.example.org/layer/{z}/{x}/{y}.png?tok=abc';
  A.State.basemap.customAttrib = '© Example Imagery Ltd';
  await A.Basemap.loadTiles('custom');
  return { attribution: A.Basemap.info.attribution,
           onScreen: document.getElementById('vp-attrib').textContent };
});
check('a custom template substitutes {z}/{x}/{y}',
      /^https:\/\/tiles\.example\.org\/layer\/\d+\/\d+\/\d+\.png\?tok=abc$/.test(maptilerUrls[0] || ''),
      maptilerUrls[0] || '(no request)');
check('a custom source uses the attribution the user typed, verbatim',
      custom.attribution === '© Example Imagery Ltd' && custom.onScreen === '© Example Imagery Ltd',
      custom.onScreen);

// The key must not leak into anything the user hands to someone else
const leak = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.basemap.source = 'maptiler';
  let captured = '';
  const realCreate = URL.createObjectURL;
  // Capture the blob but still hand back a real URL, or the anchor click logs
  // "Not allowed to load local resource" and trips the console-error check.
  URL.createObjectURL = (blob) => { captured = blob; return realCreate.call(URL, blob); };
  A.setAnalysis({ mode: 'inst', gridSize: 4 });
  await A.runAnalysis();
  A.Selects.closeOpen();
  document.getElementById('b-csv').click();
  await new Promise(r => setTimeout(r, 300));
  URL.createObjectURL = realCreate;
  const text = captured && captured.text ? await captured.text() : '';
  return { len: text.length, hasKey: text.includes('TESTKEY123'), head: text.slice(0, 60) };
});
check('the API key never appears in an exported CSV',
      leak.len > 0 && !leak.hasKey, leak.len + ' bytes exported, key present: ' + leak.hasKey);

await page.evaluate(() => { window.__SUNAPP.Basemap.clear(); window.__SUNAPP.State.basemap.source = 'none'; });

// A key on screen ends up in every screenshot and every projected lecture
const keyUi = await page.evaluate(() => {
  const A = window.__SUNAPP;
  try { localStorage.setItem(A.MAPTILER_KEY_STORE, 'SECRET_KEY_9876'); } catch (e) {}
  A.State.basemap.source = 'maptiler';
  const sel = document.getElementById('i-basemap');
  sel.value = 'maptiler';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    resolves: A.resolveMapKey(),
    setShown: document.getElementById('bm-key-set').style.display !== 'none',
    entryShown: document.getElementById('bm-key-entry').style.display !== 'none',
    fieldValue: document.getElementById('i-bm-key').value,
    inMarkup: document.body.innerHTML.includes('SECRET_KEY_9876'),
  };
});
check('a configured key is acknowledged but never rendered on screen',
      keyUi.resolves === 'SECRET_KEY_9876' && keyUi.setShown && !keyUi.entryShown &&
      keyUi.fieldValue === '' && !keyUi.inMarkup,
      'shown as configured: ' + keyUi.setShown + ', key anywhere in the DOM: ' + keyUi.inMarkup);

const keyReplace = await page.evaluate(() => {
  document.getElementById('b-bm-key-replace').click();
  return {
    entryShown: document.getElementById('bm-key-entry').style.display !== 'none',
    setShown: document.getElementById('bm-key-set').style.display !== 'none',
    empty: document.getElementById('i-bm-key').value === '',
  };
});
check('Replace opens an empty field rather than revealing the old key',
      keyReplace.entryShown && !keyReplace.setShown && keyReplace.empty);

await page.evaluate(() => {
  const A = window.__SUNAPP;
  try { localStorage.removeItem(A.MAPTILER_KEY_STORE); } catch (e) {}
  A.State.basemap.source = 'none';
  A.Basemap.clear();
});

// The proxy exists so the key can leave the page entirely. Verified on a
// separate load with PROXY_URL patched in, since the committed file has none.
{
  const proxCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await proxCtx.route('**://cdn.jsdelivr.net/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/three@[^/]+\/(.+)$/);
    const f = m && join(vendorRoot, m[1]);
    if (!f || !existsSync(f)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, contentType: 'text/javascript',
                          headers: { 'access-control-allow-origin': '*' }, body: await readFile(f, 'utf8') });
  });
  const proxied = [];
  await proxCtx.route('**/tile-proxy.php*', async (route) => {
    proxied.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png',
                          headers: { 'access-control-allow-origin': '*' }, body: TILE_PNG });
  });
  // Serve the app with PROXY_URL filled in, as a deployment would
  const src = (await readFile(join(ROOT, 'index.html'), 'utf8'))
    .replace("const PROXY_URL = '';",
             "const PROXY_URL = 'tile-proxy.php?z={z}&x={x}&y={y}&s={style}';");
  // The glob must allow a query string, or ?tour=0 slips past the route
  await proxCtx.route('**/proxied.html*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: src }));

  const pp = await proxCtx.newPage();
  await pp.goto('http://127.0.0.1:' + port + '/proxied.html?tour=0', { waitUntil: 'load' });
  await pp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });

  const px = await pp.evaluate(async () => {
    const A = window.__SUNAPP;
    A.State.basemap.extent = 400;
    A.State.basemap.style = 'satellite';
    const r = await A.Basemap.loadTiles('proxy');
    const opts = [...document.querySelectorAll('#i-basemap option')].map(o => o.value);
    return {
      tiles: r.tiles,
      selected: document.getElementById('i-basemap').value,
      options: opts,
      attribution: A.Basemap.info.attribution,
      keyBlockHidden: document.getElementById('bm-keyed').style.display === 'none',
      proxyBlockShown: document.getElementById('bm-proxy').style.display !== 'none',
      // Look for an actual key *value* assigned to the constant. Matching on
      // "key=" would hit the code that builds MapTiler URLs, which is fine to
      // ship — what must not be present is a credential.
      keyConstant: (document.documentElement.outerHTML
        .match(/const MAPTILER_KEY = '([^']*)'/) || [, null])[1],
      resolvedKey: A.resolveMapKey(),
    };
  });
  check('a configured proxy becomes the default source',
        px.options.includes('proxy') && px.selected === 'proxy',
        px.options.join(', '));
  check('tiles are requested from the proxy with substituted coordinates',
        proxied.length === px.tiles &&
        /tile-proxy\.php\?z=\d+&x=\d+&y=\d+&s=satellite$/.test(proxied[0] || ''),
        (proxied[0] || '(none)').split('/').pop());
  check('no API key appears anywhere in the served page',
        px.keyConstant === '' && px.resolvedKey === '',
        'MAPTILER_KEY = "' + px.keyConstant + '", resolveMapKey() = "' + px.resolvedKey + '"');
  check('the key field is replaced by a server-side notice',
        px.keyBlockHidden && px.proxyBlockShown);
  check('the provider attribution still reaches the viewport',
        /MapTiler/.test(px.attribution), px.attribution);

  await proxCtx.close();
}

/* ------------------------------------------------------- saved locations --- */
console.log('\n=== saved locations ===');

const saved = await page.evaluate(() => {
  const A = window.__SUNAPP;
  try { localStorage.removeItem(A.PLACES_KEY); } catch (e) {}
  A.renderPlaces();
  A.State.site = { lat: 53.3811, lon: -1.4701, tz: 1, el: 105, name: 'Sheffield campus' };
  document.getElementById('i-place-name').value = 'Sheffield campus';
  A.savePlace();
  const sel = document.getElementById('i-city');
  const grp = [...sel.querySelectorAll('optgroup')].map(g => g.label);
  const savedOpts = [...sel.querySelectorAll('optgroup[label="Saved locations"] option')]
    .map(o => ({ v: o.value, t: o.textContent }));
  return { stored: A.loadPlaces(), groups: grp, savedOpts,
           rows: document.querySelectorAll('#place-list .place-row').length };
});
check('saving records the name, coordinates, time zone and elevation together',
      saved.stored.length === 1 && saved.stored[0].tz === 1 && saved.stored[0].el === 105,
      JSON.stringify(saved.stored[0]));
check('it appears in a Saved locations group above the presets',
      saved.groups[0] === 'Saved locations' && saved.groups[1] === 'Preset cities' &&
      saved.savedOpts.length === 1 && /Sheffield/.test(saved.savedOpts[0].t),
      saved.groups.join(' | '));
check('and in the removable list', saved.rows === 1);

const restored = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.site = { lat: 0, lon: 0, tz: 0, el: 0, name: 'wiped' };
  const sel = document.getElementById('i-city');
  sel.value = 's0';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  return { ...A.State.site, tzField: document.getElementById('i-tz').value };
});
check('choosing a saved location restores all four values, time zone included',
      near(restored.lat, 53.3811, 0.01) && near(restored.lon, -1.4701, 0.01) &&
      restored.tz === 1 && restored.el === 105 && restored.tzField === '1',
      restored.name + ' @ ' + restored.lat + ', ' + restored.lon + ' UTC+' + restored.tz);

const dup = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.State.site.tz = 2;
  document.getElementById('i-place-name').value = 'sheffield CAMPUS';   // same name, different case
  A.savePlace();
  return A.loadPlaces();
});
check('saving the same name overwrites instead of duplicating',
      dup.length === 1 && dup[0].tz === 2, dup.length + ' entry, tz now ' + dup[0].tz);

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
const afterReload2 = await page.evaluate(() => ({
  stored: window.__SUNAPP.loadPlaces().length,
  inSelect: document.querySelectorAll('#i-city optgroup[label="Saved locations"] option').length,
}));
check('saved locations survive a reload',
      afterReload2.stored === 1 && afterReload2.inSelect === 1,
      afterReload2.stored + ' stored, ' + afterReload2.inSelect + ' in the dropdown');

const removed = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.removePlace(A.loadPlaces()[0].n);
  return { stored: A.loadPlaces().length,
           groups: [...document.querySelectorAll('#i-city optgroup')].map(g => g.label),
           rows: document.querySelectorAll('#place-list .place-row').length };
});
check('removing one clears it from the list and the dropdown',
      removed.stored === 0 && removed.rows === 0 && !removed.groups.includes('Saved locations'),
      removed.groups.join(' | '));

const corrupt = await page.evaluate(() => {
  const A = window.__SUNAPP;
  try { localStorage.setItem(A.PLACES_KEY, '{{{not json'); } catch (e) {}
  const list = A.loadPlaces();
  A.renderPlaces();
  const presets = document.querySelectorAll('#i-city optgroup[label="Preset cities"] option').length;
  try { localStorage.removeItem(A.PLACES_KEY); } catch (e) {}
  return { list, presets };
});
check('corrupt storage degrades to the built-in presets rather than throwing',
      Array.isArray(corrupt.list) && corrupt.list.length === 0 && corrupt.presets > 20,
      corrupt.presets + ' presets still listed');

// The reload above reset the page, so restore the EPW the later checks expect
await page.evaluate((t) => {
  const A = window.__SUNAPP;
  A.applyEPW(A.EPW.parse(t, 'chicago.epw'));
}, epwText);

/* ------------------------------------------------- stereographic projection --- */
console.log('\n=== stereographic sun path ===');

const stereo = await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.setProjection('stereo');
  const R = 100;
  const pt = (alt, az) => { const p = A.domePoint(alt, az, R); return { x: p.x, y: p.y, z: p.z }; };
  const rad = (alt) => { const p = A.domePoint(alt, 0, R); return Math.hypot(p.x, p.z); };
  return {
    mode: A.State.disp.projection,
    rHorizon: rad(0), r45: rad(45), rZenith: rad(90),
    north: pt(0, 0), east: pt(0, 90),
    flat: [0, 30, 60, 90].every(a => Math.abs(pt(a, 45).y - pt(0, 45).y) < 1e-9),
  };
});
check('the horizon maps to the outer circle and the zenith to the centre',
      near(stereo.rHorizon, 100, 0.1) && stereo.rZenith < 0.01,
      'r(0°) = ' + stereo.rHorizon.toFixed(2) + ', r(90°) = ' + stereo.rZenith.toFixed(4));
check('mid altitudes follow R·tan((90−alt)/2)',
      near(stereo.r45, 100 * Math.tan(22.5 * Math.PI / 180), 0.1),
      'r(45°) = ' + stereo.r45.toFixed(3) + ', expected ' + (100 * Math.tan(22.5 * Math.PI / 180)).toFixed(3));
check('bearings are preserved: north is −Z, east is +X',
      stereo.north.z < -99 && Math.abs(stereo.north.x) < 0.01 &&
      stereo.east.x > 99 && Math.abs(stereo.east.z) < 0.01,
      'north z=' + stereo.north.z.toFixed(1) + ', east x=' + stereo.east.x.toFixed(1));
check('the whole chart is flat — one plane, whatever the altitude', stereo.flat);

// TOP view should flatten it, and leaving TOP should restore the dome
await page.evaluate(() => window.__SUNAPP.setProjection('3d'));
await page.click('#view-cube button[data-view="top"]');
await page.waitForTimeout(350);
const afterTop = await page.evaluate(() => window.__SUNAPP.State.disp.projection);
await page.click('#view-cube button[data-view="axo"]');
await page.waitForTimeout(350);
const afterAxo = await page.evaluate(() => window.__SUNAPP.State.disp.projection);
check('top view flattens the chart and leaving it restores the dome',
      afterTop === 'stereo' && afterAxo === '3d', afterTop + ' → ' + afterAxo);

const optOut = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  document.getElementById('d-autostereo').checked = false;
  document.getElementById('d-autostereo').dispatchEvent(new Event('change'));
  document.querySelector('#view-cube button[data-view="top"]').click();
  await new Promise(r => setTimeout(r, 250));
  const p = A.State.disp.projection;
  document.getElementById('d-autostereo').checked = true;
  document.getElementById('d-autostereo').dispatchEvent(new Event('change'));
  return p;
});
check('the auto-flatten toggle can be switched off', optOut === '3d', 'stayed ' + optOut);

/* ---------------------------------------------------- chart clarity slider --- */
// Over aerial imagery the flattened chart vanished: the 0.42-0.55 opacities that
// suit the plain ground plane have nothing to read against. One slider raises
// both the backdrop disc and the line ink, and must leave the 3D dome alone.
const clarity = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  const set = (v) => {
    const s = document.getElementById('d-chart');
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  };
  A.setProjection('3d');
  const dome25 = A.chartProbe();
  set(0.6);
  const dome60 = A.chartProbe();
  set(0.25);
  A.setProjection('stereo');
  set(0);
  const low = A.chartProbe();
  set(1);
  const high = A.chartProbe();
  const readout = document.getElementById('v-chart').textContent;
  set(0.25);
  return { dome25, dome60, low, high, readout };
});
check('the clarity slider is offered only where it does something',
      clarity.dome25.rowVisible === false && clarity.low.rowVisible === true,
      '3D hidden, stereographic shown');
check('the backdrop goes from all but invisible to all but solid',
      clarity.low.plateOpacity < 0.1 && clarity.high.plateOpacity > 0.9,
      'plate ' + clarity.low.plateOpacity.toFixed(2) + ' → ' + clarity.high.plateOpacity.toFixed(2));
check('the faintest chart lines are strengthened with it',
      clarity.high.minLineOpacity > clarity.low.minLineOpacity + 0.3 &&
      clarity.high.minLineOpacity <= 1,
      'faintest line ' + clarity.low.minLineOpacity.toFixed(2) + ' → ' +
      clarity.high.minLineOpacity.toFixed(2) + ' over ' + clarity.high.lineCount + ' lines');
check('the 3D dome is unaffected by it',
      clarity.dome25.plateOpacity === null &&
      clarity.dome25.minLineOpacity === clarity.dome60.minLineOpacity,
      'dome faintest line ' + clarity.dome25.minLineOpacity.toFixed(2) + ' at both settings');
check('the slider reads out as a percentage', clarity.readout === '100%', clarity.readout);

// The point of the control is pixels, not material properties: looking straight
// down on a basemap, turning it up must actually replace the imagery behind the
// chart with a flat backdrop.
const clarityPx = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  A.State.basemap.extent = 400;
  await A.Basemap.loadTiles('osm');
  A.setProjection('stereo');
  A.orbitTo(0, 88);                       // straight down on the chart
  const cnv = document.querySelector('#viewport canvas');
  const scratch = document.createElement('canvas');
  const g = scratch.getContext('2d');
  const sample = async (v) => {
    const s = document.getElementById('d-chart');
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const sc = A.chartProbe().screen;
    scratch.width = sc.w; scratch.height = sc.h;
    g.drawImage(cnv, 0, 0, sc.w, sc.h);
    // Four patches at 55% of the chart radius: inside the disc, outside the
    // model in the middle, so what is measured is chart against imagery.
    const lum = [];
    for (const deg of [45, 135, 225, 315]){
      const a = deg * Math.PI / 180;
      const px = Math.round(sc.cx + Math.cos(a) * sc.r * 0.55) - 6;
      const py = Math.round(sc.cy + Math.sin(a) * sc.r * 0.55) - 6;
      const d = g.getImageData(px, py, 12, 12).data;
      for (let i = 0; i < d.length; i += 4)
        lum.push(d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114);
    }
    return { mean: lum.reduce((x, y) => x + y, 0) / lum.length, n: lum.length };
  };
  const low = await sample(0);
  const high = await sample(1);
  const s = document.getElementById('d-chart');
  s.value = '0.25';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  A.Basemap.clear();
  return { low, high };
});
check('turning it up visibly replaces the imagery behind the chart',
      clarityPx.low.mean - clarityPx.high.mean > 60,
      'mean luminance ' + clarityPx.low.mean.toFixed(0) + ' → ' + clarityPx.high.mean.toFixed(0) +
      ' over ' + clarityPx.high.n + ' px');

/* ------------------------------------------------------------ place search --- */
console.log('\n=== place search ===');
geocodeRequests = 0;
const search = await page.evaluate(async () => {
  const A = window.__SUNAPP;
  document.getElementById('i-search').value = 'Sheffield School of Architecture';
  document.getElementById('b-search').click();
  await new Promise(r => setTimeout(r, 1600));
  const results = [...document.querySelectorAll('#search-results button')];
  const first = results[0];
  if (first) first.click();
  await new Promise(r => setTimeout(r, 300));
  return {
    count: results.length,
    lat: A.State.site.lat, lon: A.State.site.lon, name: A.State.site.name,
    latField: document.getElementById('i-lat').value,
    cleared: document.getElementById('search-results').children.length,
  };
});
check('a search returns results and picking one moves the site',
      search.count === 2 && near(search.lat, 53.3811, 0.01) && near(search.lon, -1.4701, 0.01),
      search.count + ' results → ' + search.lat + ', ' + search.lon);
check('the coordinate fields and site name follow the pick',
      /53\.38/.test(search.latField) && /Sheffield/.test(search.name) && search.cleared === 0,
      'lat field "' + search.latField + '", name "' + search.name + '"');

const shortQuery = await page.evaluate(async () => {
  document.getElementById('i-search').value = 'ab';
  document.getElementById('b-search').click();
  await new Promise(r => setTimeout(r, 200));
  return document.querySelectorAll('#search-results button').length;
});
check('a too-short query does not hit the geocoder at all',
      shortQuery === 0 && geocodeRequests === 1,
      geocodeRequests + ' geocoder request(s) in total');

// Put the site back so later checks are unaffected
await page.evaluate((t) => {
  const A = window.__SUNAPP;
  A.applyEPW(A.EPW.parse(t, 'chicago.epw'));
}, epwText);

/* ------------------------------------------------------ presentation modes --- */
console.log('\n=== dark and light presentation ===');

// Contrast is the thing that actually breaks when a palette is duplicated by
// hand, so measure it rather than eyeballing the screenshots.
const CONTRAST_FN = `(() => {
  const lum = (c) => {
    const [r,g,b] = c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  window.__contrast = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
  };
  window.__lum = lum;
})()`;

async function probeTheme(){
  return page.evaluate((fnSrc) => {
    eval(fnSrc);
    const cs = getComputedStyle(document.body);
    const panel = getComputedStyle(document.querySelector('#panel-left'));
    const title = getComputedStyle(document.querySelector('.sec-title'));
    const value = getComputedStyle(document.querySelector('#statusbar .credit'));
    const status = getComputedStyle(document.getElementById('statusbar'));
    const btn = document.querySelector('.btn.primary');
    const btnCs = btn ? getComputedStyle(btn) : null;
    const opt = document.querySelector('.sel-opt');
    const list = document.querySelector('.sel-list');
    const A = window.__SUNAPP;
    return {
      attr: document.documentElement.dataset.theme || '(none)',
      scene: A.getTheme(),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyLum: window.__lum(cs.backgroundColor),
      panelLum: window.__lum(panel.backgroundColor),
      titleContrast: window.__contrast(title.color, panel.backgroundColor),
      creditContrast: window.__contrast(value.color, status.backgroundColor),
      btnContrast: btnCs ? window.__contrast(btnCs.color, btnCs.backgroundColor) : null,
      optContrast: (opt && list)
        ? window.__contrast(getComputedStyle(opt).color, getComputedStyle(list).backgroundColor) : null,
      chevron: getComputedStyle(document.getElementById('i-city')).backgroundImage,
    };
  }, CONTRAST_FN);
}

const darkT = await probeTheme();
check('the app opens in dark presentation by default',
      darkT.attr === 'dark' && darkT.scene === 'dark' && darkT.bodyLum < 0.06,
      'attr ' + darkT.attr + ', scene ' + darkT.scene + ', body luminance ' + darkT.bodyLum.toFixed(3));

await page.click('#tb-theme');
await page.waitForTimeout(400);
const lightT = await probeTheme();
check('the toggle switches interface and 3D scene together',
      lightT.attr === 'light' && lightT.scene === 'light' && lightT.bodyLum > 0.7,
      'attr ' + lightT.attr + ', scene ' + lightT.scene + ', body luminance ' + lightT.bodyLum.toFixed(3));
check('light mode tells the browser to draw native controls light',
      /light/.test(lightT.colorScheme), lightT.colorScheme);
check('the select chevron is redrawn for light mode',
      lightT.chevron !== darkT.chevron && lightT.chevron !== 'none');

for (const [name, t] of [['dark', darkT], ['light', lightT]]){
  check('body text meets 4.5:1 against its panel in ' + name + ' mode',
        t.titleContrast >= 4.5, t.titleContrast.toFixed(2) + ':1');
  check('the status-bar credit stays legible in ' + name + ' mode',
        t.creditContrast >= 4.0, t.creditContrast.toFixed(2) + ':1');
  check('primary button text meets 4.5:1 on its fill in ' + name + ' mode',
        t.btnContrast >= 4.5, t.btnContrast.toFixed(2) + ':1');
  check('dropdown rows meet 4.5:1 against the list in ' + name + ' mode',
        t.optContrast >= 4.5, t.optContrast.toFixed(2) + ':1');
}

// The viewport itself must follow, not just the chrome
const vpLight = await page.evaluate(() => {
  const c = document.querySelector('#viewport canvas');
  const g = document.createElement('canvas');
  g.width = g.height = 1;
  g.getContext('2d').drawImage(c, 2, 2, 1, 1, 0, 0, 1, 1);
  const p = g.getContext('2d').getImageData(0, 0, 1, 1).data;
  return (p[0] + p[1] + p[2]) / 3;
});
check('the 3D viewport renders light too, not just the panels',
      vpLight > 170, 'corner luminance ' + Math.round(vpLight));

await page.screenshot({ path: join(SHOTS, 'light-mode.png') });

// It has to survive a reload
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
await page.waitForTimeout(400);
const afterReload = await page.evaluate(() => ({
  attr: document.documentElement.dataset.theme,
  scene: window.__SUNAPP.getTheme(),
}));
check('the chosen presentation persists across a reload',
      afterReload.attr === 'light' && afterReload.scene === 'light',
      afterReload.attr + ' / ' + afterReload.scene);

const lightOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow in light mode', lightOverflow <= 1, 'overflow ' + lightOverflow + 'px');

// Back to dark for the remaining checks and the reference screenshots
await page.evaluate(() => window.__SUNAPP.setUiTheme('dark'));
await page.waitForTimeout(300);
check('switching back restores the dark presentation',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');

/* -------------------------------------------------------------- tour --- */
console.log('\n=== guided tour ===');

// A fresh context has no localStorage flag, so the tour must auto-start there
{
  const tourCtx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await tourCtx.route('**://cdn.jsdelivr.net/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/three@[^/]+\/(.+)$/);
    const f = m && join(vendorRoot, m[1]);
    if (!f || !existsSync(f)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, contentType: 'text/javascript',
                          headers: { 'access-control-allow-origin': '*' }, body: await readFile(f, 'utf8') });
  });
  const tp = await tourCtx.newPage();
  const tourErrors = [];
  tp.on('pageerror', e => tourErrors.push(e.message));
  await tp.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
  await tp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });

  await tp.waitForSelector('#tour-card:not([hidden])', { timeout: 5000 });
  const first = await tp.evaluate(() => ({
    step: document.getElementById('tour-step').textContent,
    title: document.getElementById('tour-title').textContent,
    total: window.__SUNAPP.Tour.steps,
    backDisabled: document.getElementById('tour-back').disabled,
  }));
  check('tour auto-starts on a first visit', /Step 1 of/.test(first.step) && !!first.title,
        first.step + ' — "' + first.title + '"');
  check('Back is disabled on the first step', first.backDisabled === true);

  // Walk the whole tour through the Next button
  const seen = [];
  for (let i = 0; i < first.total; i++){
    seen.push(await tp.evaluate(() => {
      const spot = document.getElementById('tour-spot');
      const card = document.getElementById('tour-card');
      const sr = spot.getBoundingClientRect(), cr = card.getBoundingClientRect();
      // A step can only be judged on covering its target when there is somewhere
      // else for the card to go: a centred step has a zero-size spotlight, and a
      // target spanning the window in both axes leaves no clear side.
      const spotArea = sr.width * sr.height;
      const fits = (room) => room >= cr.height + 16;
      const fitsX = (room) => room >= cr.width + 16;
      const avoidable = fits(innerHeight - sr.bottom) || fits(sr.top) ||
                        fitsX(innerWidth - sr.right) || fitsX(sr.left);
      const pointed = spotArea > 400 && avoidable;
      return {
        title: document.getElementById('tour-title').textContent,
        onScreen: cr.left >= 0 && cr.top >= 0 &&
                  cr.right <= innerWidth + 1 && cr.bottom <= innerHeight + 1,
        pointed,
        overlaps: pointed &&
          !(cr.right < sr.left || cr.left > sr.right || cr.bottom < sr.top || cr.top > sr.bottom),
        spotVisible: !spot.hidden,
        pointerThrough: getComputedStyle(spot).pointerEvents === 'none',
      };
    }));
    await tp.click('#tour-next');
    await tp.waitForTimeout(320);
  }
  const offScreen = seen.filter(x => !x.onScreen).map(x => x.title);
  check('every tour card stays inside the viewport', offScreen.length === 0,
        offScreen.length ? offScreen.join(', ') : seen.length + ' steps checked at 1280×820');
  const pointed = seen.filter(x => x.pointed);
  check('the tour never covers the element it is pointing at',
        pointed.length >= 5 && pointed.every(x => !x.overlaps),
        pointed.filter(x => x.overlaps).map(x => x.title).join(', ') ||
        pointed.length + ' element-targeted steps clear of their target');
  check('the spotlight lets clicks through to the app',
        seen.every(x => x.pointerThrough));

  await tp.evaluate(() => window.__SUNAPP.Tour.start(2));   // a panel step, worth a look
  await tp.waitForTimeout(500);
  await tp.screenshot({ path: join(SHOTS, 'tour.png') });
  await tp.evaluate(() => { const T = window.__SUNAPP.Tour; T.start(9); });
  await tp.waitForTimeout(400);
  await tp.click('#tour-next');
  await tp.waitForTimeout(200);

  const done = await tp.evaluate(() => ({
    hidden: document.getElementById('tour-card').hidden,
    stored: localStorage.getItem(window.__SUNAPP.TOUR_KEY),
  }));
  check('finishing the tour closes it without silently opting the visitor out',
        done.hidden === true && done.stored === null, 'stored = ' + done.stored);

  // Default: it comes back on the next launch
  await tp.reload({ waitUntil: 'load' });
  await tp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  await tp.waitForSelector('#tour-card:not([hidden])', { timeout: 5000 });
  check('the intro returns on the next launch by default', true, 'shown again after reload');

  // The opt-out is offered on the first and last cards only
  const optoutFirst = await tp.evaluate(() => !document.getElementById('tour-optout').hidden);
  await tp.evaluate(() => window.__SUNAPP.Tour.start(4));
  await tp.waitForTimeout(200);
  const optoutMiddle = await tp.evaluate(() => !document.getElementById('tour-optout').hidden);
  await tp.evaluate((n) => window.__SUNAPP.Tour.start(n - 1), 10);
  await tp.waitForTimeout(200);
  const optoutLast = await tp.evaluate(() => !document.getElementById('tour-optout').hidden);
  check('the opt-out appears on the first and last cards, not in the middle',
        optoutFirst && optoutLast && !optoutMiddle,
        'first ' + optoutFirst + ', middle ' + optoutMiddle + ', last ' + optoutLast);

  // Ticking it stops the intro on later launches
  await tp.click('#tour-optout');
  await tp.waitForTimeout(150);
  const stored = await tp.evaluate(() => localStorage.getItem(window.__SUNAPP.TOUR_KEY));
  check('ticking the opt-out records the preference', stored === '1', 'stored = ' + stored);

  await tp.click('#tour-next');
  await tp.reload({ waitUntil: 'load' });
  await tp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  await tp.waitForTimeout(1100);
  const second = await tp.evaluate(() => document.getElementById('tour-card').hidden);
  check('after opting out the intro no longer shows on launch', second === true);

  // ?tour=1 overrides the opt-out, which is how the author demos it
  await tp.goto('http://127.0.0.1:' + port + '/index.html?tour=1', { waitUntil: 'load' });
  await tp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  await tp.waitForSelector('#tour-card:not([hidden])', { timeout: 5000 });
  check('?tour=1 forces the intro even after opting out', true, 'shown with ?tour=1');

  // Un-ticking restores it
  await tp.evaluate(() => window.__SUNAPP.Tour.start(0));
  await tp.waitForTimeout(200);
  await tp.click('#tour-optout');
  await tp.waitForTimeout(150);
  const cleared = await tp.evaluate(() => localStorage.getItem(window.__SUNAPP.TOUR_KEY));
  check('un-ticking the opt-out brings the intro back', cleared === null, 'stored = ' + cleared);
  await tp.evaluate(() => window.__SUNAPP.Tour.end());

  // Help replays it on demand
  await tp.waitForTimeout(150);
  await tp.click('#tb-help');
  await tp.waitForTimeout(250);
  const replay = await tp.evaluate(() => ({
    hidden: document.getElementById('tour-card').hidden,
    step: document.getElementById('tour-step').textContent,
  }));
  check('Help replays the tour from the beginning',
        replay.hidden === false && /Step 1 of/.test(replay.step), replay.step);

  // Escape closes it
  await tp.keyboard.press('Escape');
  await tp.waitForTimeout(150);
  check('Escape dismisses the tour',
        await tp.evaluate(() => document.getElementById('tour-card').hidden) === true);
  check('no page errors during the tour', tourErrors.length === 0, tourErrors.slice(0, 2).join(' | '));

  await tourCtx.close();
}

/* -------------------------------------------------------------- console --- */
console.log('\n=== runtime health ===');
check('no console errors during the whole run', consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | '));

/* ------------------------------------------------------------ screenshots --- */
console.log('\n=== responsive screenshots ===');
await page.evaluate(() => {
  const A = window.__SUNAPP;
  A.loadSample('demo');
  A.setDoy(172); A.setMinutes(600);
  A.setAnalysis({ mode: 'cum', period: 'year', unit: 'kwh', gridSize: 1.5, shade: true });
  return A.runAnalysis();
});
await page.waitForTimeout(500);

// Save one dark and one light study sheet for visual review
{
  const { writeFile } = await import('node:fs/promises');
  for (const theme of ['dark', 'light']){
    const b64 = await page.evaluate((t) =>
      window.__SUNAPP.exportSheet({ theme: t, scale: 1, save: false })
        .toDataURL('image/png').split(',')[1], theme);
    await writeFile(join(SHOTS, 'sheet-' + theme + '.png'), Buffer.from(b64, 'base64'));
  }
  console.log('  saved sheet-dark.png / sheet-light.png');
}

const sizes = [
  { w: 1440, h: 900, tag: 'desktop' },
  { w:  900, h: 700, tag: 'tablet' },
  { w:  390, h: 844, tag: 'mobile' },
];
for (const s of sizes){
  await page.setViewportSize({ width: s.w, height: s.h });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, s.tag + '.png') });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at ' + s.w + '×' + s.h, overflow <= 1, 'overflow ' + overflow + 'px');
}

/* ----------------------------------------------------------- deploy build --- */
// The key must never be in the page the public downloads. The build script is
// what guarantees that, so it is checked here with a fake key: the page it emits
// must not contain the key anywhere, only the PHP proxy may.
console.log('\n=== deploy build ===');
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, existsSync: exists } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const FAKE = 'TESTKEY_NOT_A_REAL_MAPTILER_KEY';
  const out = mkdtempSync(join(tmpdir(), 'sunstudio-deploy-'));
  const build = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)';/)[1];

  let ranOk = true, stdout = '';
  try {
    stdout = execFileSync(process.execPath,
      [join(ROOT, 'tools', 'make-deploy.mjs'), '--key', FAKE, '--out', out],
      { encoding: 'utf8' });
  } catch (e) { ranOk = false; stdout = String(e.stdout || e.message); }

  const dir = join(out, 'sun-studio-v' + build + '-proxy');
  const pageFile = join(dir, 'index.html');
  const phpFile = join(dir, 'tile-proxy.php');
  check('the build script emits a page and a proxy, stamped with the source version',
        ranOk && exists(pageFile) && exists(phpFile), 'sun-studio-v' + build + '-proxy');
  if (exists(pageFile) && exists(phpFile)){
    const html = readFileSync(pageFile, 'utf8');
    const php = readFileSync(phpFile, 'utf8');
    check('the emitted page contains no key at all',
          !html.includes(FAKE) && /const MAPTILER_KEY = '';/.test(html));
    check('it points at the proxy by relative path, so it works in any folder',
          /const PROXY_URL = 'tile-proxy\.php\?z=\{z\}&x=\{x\}&y=\{y\}&s=\{style\}';/.test(html));
    check('the key goes into the PHP file, which servers execute rather than serve',
          php.includes("$MAPTILER_KEY = '" + FAKE + "';"));
  }

  // The single-file variant is still available, but it is the one that exposes
  // the key — so it must say so rather than emit quietly.
  let warned = '';
  try {
    warned = execFileSync(process.execPath,
      [join(ROOT, 'tools', 'make-deploy.mjs'), '--key', FAKE, '--key-in-page', '--out', out],
      { encoding: 'utf8' });
  } catch (e) { warned = String(e.stdout || e.message); }
  const inPage = join(out, 'sun-studio-v' + build + '-key-in-page', 'index.html');
  check('the single-file variant warns that the key is readable',
        exists(inPage) && readFileSync(inPage, 'utf8').includes(FAKE) &&
        /readable|Allowed origins/i.test(warned));
  check('a build with no key emits neither a proxy nor a key', (() => {
    try {
      execFileSync(process.execPath,
        [join(ROOT, 'tools', 'make-deploy.mjs'), '--out', out], { encoding: 'utf8' });
    } catch (e) { return false; }
    const plain = join(out, 'sun-studio-v' + build + '-plain', 'index.html');
    if (!exists(plain)) return false;
    const h = readFileSync(plain, 'utf8');
    return /const MAPTILER_KEY = '';/.test(h) && /const PROXY_URL = '';/.test(h) &&
           !exists(join(out, 'sun-studio-v' + build + '-plain', 'tile-proxy.php'));
  })());
}

/* ------------------------------------------------------------------ done --- */
await browser.close();
server.close();

console.log('\n' + '─'.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('─'.repeat(66));
process.exit(fail ? 1 : 0);
