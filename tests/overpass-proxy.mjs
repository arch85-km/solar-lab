#!/usr/bin/env node
/**
 * Checks for server/overpass-proxy.php, run against PHP's built-in server and a
 * stand-in for the Overpass servers, so nothing leaves the machine.
 *
 *   node tests/overpass-proxy.mjs
 *
 * Skipped, not failed, where PHP is not installed.
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(name, ok, detail = ''){
  if (ok) passed++; else failed++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

console.log('\n=== OpenStreetMap buildings proxy (server/overpass-proxy.php) ===');
if (spawnSync('php', ['-v']).status !== 0){
  console.log('  SKIP  PHP is not installed here');
  process.exit(0);
}

/* ── a stand-in for the three Overpass servers ─────────────────────────── */

// mode per server: 'ok', 'busy' (504), 'remark' (200 with a runtime error),
// 'slow' (ok after 600 ms)
const mode = { u1: 'ok', u2: 'ok', u3: 'ok' };
const hits = { u1: 0, u2: 0, u3: 0 };
let lastQuery = '';
const ELEMENTS = [{ type: 'way', id: 1, tags: { building: 'yes', height: '12' },
  geometry: [{ lat: 53.38, lon: -1.47 }, { lat: 53.38, lon: -1.4699 }, { lat: 53.3801, lon: -1.4699 }, { lat: 53.38, lon: -1.47 }] }];
const upstream = createServer((req, res) => {
  const which = req.url.slice(1);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    hits[which] = (hits[which] || 0) + 1;
    lastQuery = decodeURIComponent(body.replace(/^data=/, ''));
    const m = mode[which];
    const ok = () => { res.writeHead(200, { 'Content-Type': 'application/json' });
                       res.end(JSON.stringify({ version: 0.6, elements: ELEMENTS })); };
    if (m === 'busy'){ res.writeHead(504); res.end('busy'); }
    else if (m === 'remark'){ res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 0.6, elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' })); }
    else if (m === 'slow') setTimeout(ok, 600);
    else ok();
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UP = 'http://127.0.0.1:' + upstream.address().port;

/* ── the proxy, pointed at the stand-in ────────────────────────────────── */

const dir = mkdtempSync(join(tmpdir(), 'overpass-proxy-'));
let php = readFileSync(join(ROOT, 'server', 'overpass-proxy.php'), 'utf8');
const swap = (from, to) => {
  if (php.split(from).length !== 2) throw new Error('expected one ' + from.slice(0, 40));
  php = php.replace(from, to);
};
swap(`$UPSTREAMS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];`, `$UPSTREAMS = ['${UP}/u1', '${UP}/u2', '${UP}/u3'];`);
swap('$SERVER_TIMEOUT = 30;', '$SERVER_TIMEOUT = 5;');
writeFileSync(join(dir, 'overpass-proxy.php'), php);

const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn('php', ['-S', '127.0.0.1:' + port, '-t', dir],
                     { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6' }, stdio: 'ignore' });
const BASE = 'http://127.0.0.1:' + port;
for (let i = 0; i < 50; i++){
  try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

const PAGE = BASE + '/index.html';
const ask = (bbox, headers = { Referer: PAGE }) =>
  fetch(BASE + '/overpass-proxy.php?bbox=' + bbox, { headers })
    .then(async (r) => ({ status: r.status, cache: r.headers.get('x-overpass-cache'),
                          age: +r.headers.get('x-overpass-age'), body: await r.text() }));
const reset = () => { for (const k of Object.keys(hits)) hits[k] = 0; };
const BOX = '53.378203,-1.473010,53.381797,-1.466990';

try {
  // Not from the page: refused, so the script is not an open relay
  const bare = await ask(BOX, {});
  const elsewhere = await ask(BOX, { Referer: 'https://example.org/page' });
  check('a request not from a page on this site is refused',
        bare.status === 403 && elsewhere.status === 403,
        'no referer ' + bare.status + ', another site ' + elsewhere.status);

  // Only a box, never a query
  const notBox = await ask('way["building"]');
  const huge = await ask('53.000000,-1.500000,53.100000,-1.400000');
  check('only a small box is accepted, never a query',
        notBox.status === 400 && huge.status === 400, 'query ' + notBox.status + ', 11 km box ' + huge.status);

  // First ask: the main server busy, the second answers
  reset(); mode.u1 = 'busy';
  const first = await ask(BOX);
  check('a busy server is skipped and the next one supplies the buildings',
        first.status === 200 && first.cache === 'miss' && hits.u1 === 1 && hits.u2 === 1 &&
        JSON.parse(first.body).elements.length === 1,
        'status ' + first.status + ', cache ' + first.cache + ', asked u1 ' + hits.u1 + ' u2 ' + hits.u2);
  check('the query sent is buildings in that box, written by the proxy',
        lastQuery.includes('(' + BOX + ')') && /way\["building"\]/.test(lastQuery) &&
        /relation\["building"\]/.test(lastQuery) && /out geom/.test(lastQuery));

  // Second ask: from the cache, Overpass not asked at all
  reset(); mode.u1 = 'ok';
  const second = await ask(BOX);
  check('asking again is answered from the cache, without asking Overpass',
        second.status === 200 && second.cache === 'hit' && hits.u1 + hits.u2 + hits.u3 === 0,
        'cache ' + second.cache + ', upstream requests ' + (hits.u1 + hits.u2 + hits.u3));

  // A runtime-error remark is a failure, not an empty map
  reset(); mode.u1 = 'remark';
  const BOX2 = '53.370000,-1.480000,53.373594,-1.473980';
  const remark = await ask(BOX2);
  check('a "runtime error" answer is not kept; the next server is asked',
        remark.status === 200 && JSON.parse(remark.body).elements.length === 1 && hits.u2 === 1,
        'asked u1 ' + hits.u1 + ', u2 ' + hits.u2);

  // Every server down, nothing cached: a busy status, not an empty answer
  reset(); mode.u1 = mode.u2 = mode.u3 = 'busy';
  const BOX3 = '51.500000,-0.130000,51.503594,-0.124230';
  const down = await ask(BOX3);
  check('with every server down and nothing kept, it says busy (503)',
        down.status === 503 && hits.u1 === 1 && hits.u2 === 1 && hits.u3 === 1,
        'status ' + down.status + ', each server asked once');

  // Every server down, an old answer kept: the old answer, marked stale
  const kept = readdirSync(join(dir, 'overpass-cache')).find((f) => f.endsWith('.php'));
  const old = (Date.now() / 1000) - 40 * 86400;
  for (const f of readdirSync(join(dir, 'overpass-cache')).filter((f) => f.endsWith('.php')))
    utimesSync(join(dir, 'overpass-cache', f), old, old);
  reset();
  const stale = await ask(BOX);
  check('with every server down, an answer older than 30 days is served, marked stale',
        stale.status === 200 && stale.cache === 'stale' && stale.age > 39 * 86400 && !!kept,
        'cache ' + stale.cache + ', ' + Math.round(stale.age / 86400) + ' days old');

  // A class at once: one request to Overpass
  reset(); mode.u1 = 'slow'; mode.u2 = mode.u3 = 'ok';
  const BOX4 = '55.950000,-3.190000,55.953594,-3.183570';
  const many = await Promise.all(Array.from({ length: 5 }, () => ask(BOX4)));
  check('five visitors asking for the same place at once cost one request to Overpass',
        many.every((r) => r.status === 200) && hits.u1 === 1 && hits.u2 === 0,
        many.map((r) => r.cache).join(', ') + '; Overpass asked ' + (hits.u1 + hits.u2 + hits.u3) + '×');

  // The cache folder is closed to the web
  check('the cache folder is closed to direct browsing',
        existsSync(join(dir, 'overpass-cache', '.htaccess')) &&
        /Require all denied/.test(readFileSync(join(dir, 'overpass-cache', '.htaccess'), 'utf8')));

  // Reported from the live site: SiteGround serves a plain .json file directly,
  // .htaccess or not, so a kept answer was downloadable by its name. Each is now
  // a .php file whose first line ends a direct request with nothing.
  const kept2 = readdirSync(join(dir, 'overpass-cache'));
  const direct = await fetch(BASE + '/overpass-cache/' + kept2.find((f) => f.endsWith('.php')));
  const directBody = await direct.text();
  check('a kept answer cannot be downloaded directly, even where .htaccess is ignored',
        !kept2.some((f) => f.endsWith('.json')) && kept2.some((f) => f.endsWith('.php')) &&
        direct.status === 404 && !directBody.includes('elements'),
        'files ' + [...new Set(kept2.map((f) => f.split('.').pop()))].join('/') +
        '; a direct request gets ' + direct.status + ', ' + directBody.length + ' bytes');

  // A POST is not how the page asks
  const post = await fetch(BASE + '/overpass-proxy.php?bbox=' + BOX, { method: 'POST', headers: { Referer: PAGE } });
  check('only GET is answered', post.status === 405, 'POST ' + post.status);
} finally {
  server.kill();
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
