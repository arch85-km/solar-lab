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

const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
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
      chrome.credit === '© Karam Al-Obaidi', String(chrome.credit));
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

const selFocus = await page.evaluate(() => {
  const el = document.getElementById('i-city');
  const before = getComputedStyle(el).backgroundImage;
  el.focus();
  const after = getComputedStyle(el).backgroundImage;
  const opt = document.querySelector('#i-city option');
  return { before, after, optBg: opt ? getComputedStyle(opt).backgroundColor : null };
});
check('focusing a dropdown does not wipe its chevron (no background shorthand)',
      selFocus.before !== 'none' && selFocus.after !== 'none',
      'before ' + (selFocus.before === 'none' ? 'none' : 'image') +
      ', after ' + (selFocus.after === 'none' ? 'none' : 'image'));
check('option rows carry an explicit dark background',
      !!selFocus.optBg && selFocus.optBg !== 'rgba(0, 0, 0, 0)', String(selFocus.optBg));

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
  check('finishing the tour closes it and records that it was seen',
        done.hidden === true && done.stored === '1', 'stored = ' + done.stored);

  await tp.reload({ waitUntil: 'load' });
  await tp.waitForFunction(() => window.__SUNAPP && window.__SUNAPP.ready, null, { timeout: 30000 });
  await tp.waitForTimeout(1100);
  const second = await tp.evaluate(() => document.getElementById('tour-card').hidden);
  check('the tour does not reappear on the next visit', second === true);

  // Help replays it on demand
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

/* ------------------------------------------------------------------ done --- */
await browser.close();
server.close();

console.log('\n' + '─'.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('─'.repeat(66));
process.exit(fail ? 1 : 0);
