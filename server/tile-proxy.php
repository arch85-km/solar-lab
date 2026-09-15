<?php
/**
 * Solar Analysis Lab — map tile proxy
 *
 * Keeps a MapTiler (or any keyed XYZ) API key on the server so it never reaches
 * the browser. The page requests tiles from this script; this script adds the
 * key and passes the image back. PHP source is executed, not served, so the key
 * is not readable by visitors.
 *
 * Install
 *   Upload next to index.html, e.g.
 *     /wp-content/uploads/solar-analysis-lab/tile-proxy.php
 *   Set $MAPTILER_KEY below. Nothing else needs configuring: requests are only
 *   accepted from pages on this same host.
 *
 * Licence: MIT, same as the app's code. © 2026 Karam Al-Obaidi
 */
declare(strict_types=1);

/* ── configuration ─────────────────────────────────────────────────────── */

/** Your MapTiler key. This file is the only place it should ever appear. */
$MAPTILER_KEY = 'PUT_YOUR_MAPTILER_KEY_HERE';

/** Styles this proxy will serve. An allowlist, so the query cannot ask for
 *  arbitrary upstream paths. */
$ALLOWED_STYLES = ['satellite', 'hybrid', 'streets-v2', 'topo-v2', 'basic-v2'];

/** Tiles one visitor may fetch per hour. A site map view is ~36 tiles, so this
 *  allows plenty of panning while capping what a scraper can take. */
$MAX_TILES_PER_HOUR = 3000;

/** Highest zoom to serve. */
$MAX_ZOOM = 20;

/** Seconds the browser may reuse a tile. Browser-side only — tiles are not
 *  stored on this server, which keeps the proxy simple and avoids questions
 *  about caching provider imagery. */
$BROWSER_CACHE_SECONDS = 86400;

/* ── helpers ───────────────────────────────────────────────────────────── */

/**
 * End the request with a status and a short plain-text reason.
 * Never includes the key or the upstream URL.
 */
function fail(int $code, string $why): void {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $why;
    exit;
}

/** Host of a URL, or '' if it has none. */
function host_of(?string $url): string {
    if (!$url) return '';
    $h = parse_url($url, PHP_URL_HOST);
    return is_string($h) ? strtolower($h) : '';
}

/* ── only serve pages on this same host ────────────────────────────────── */

$self = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
$from = host_of($_SERVER['HTTP_ORIGIN'] ?? null) ?: host_of($_SERVER['HTTP_REFERER'] ?? null);

// Follow the scheme the page was actually served over, including behind a proxy
// or load balancer. Guessing https breaks the CORS header on an http site, and
// the tiles then fail to reach the canvas for no visible reason.
$fwd = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
$secure = $fwd !== '' ? $fwd === 'https'
        : (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off');
$scheme = $secure ? 'https' : 'http';

// The app and this script sit in the same directory, so the browser always
// sends a same-host Origin or Referer. A request without one is not from the
// page, and is refused rather than quietly allowed — otherwise this becomes an
// open proxy anyone can point at.
if ($self === '' || $from === '' || $from !== $self) {
    fail(403, 'Tile requests are only accepted from pages on this site.');
}

/* ── validate the tile coordinates ─────────────────────────────────────── */

$z = filter_input(INPUT_GET, 'z', FILTER_VALIDATE_INT);
$x = filter_input(INPUT_GET, 'x', FILTER_VALIDATE_INT);
$y = filter_input(INPUT_GET, 'y', FILTER_VALIDATE_INT);
$style = (string)($_GET['s'] ?? 'satellite');

if ($z === false || $z === null || $z < 0 || $z > $MAX_ZOOM) fail(400, 'Bad zoom.');
$limit = 1 << $z;                                  // 2^z tiles per axis
if ($x === false || $x === null || $x < 0 || $x >= $limit) fail(400, 'Bad tile x.');
if ($y === false || $y === null || $y < 0 || $y >= $limit) fail(400, 'Bad tile y.');
if (!in_array($style, $ALLOWED_STYLES, true))      fail(400, 'Unknown style.');

if ($MAPTILER_KEY === '' || $MAPTILER_KEY === 'PUT_YOUR_MAPTILER_KEY_HERE') {
    fail(500, 'This tile proxy has no API key configured yet.');
}

/* ── rate limit per visitor ────────────────────────────────────────────── */

$ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$bucket = sys_get_temp_dir() . '/sunstudio-tiles-' . date('YmdH') . '-' . sha1($ip) . '.cnt';
$count = (int)@file_get_contents($bucket);
if ($count >= $MAX_TILES_PER_HOUR) {
    header('Retry-After: 600');
    fail(429, 'Tile limit reached for this hour.');
}
@file_put_contents($bucket, (string)($count + 1), LOCK_EX);

/* ── fetch upstream ────────────────────────────────────────────────────── */

// Imagery styles are JPEG; the vector-derived ones are PNG.
$ext = preg_match('/satellite|hybrid|aerial/i', $style) ? 'jpg' : 'png';
$upstream = sprintf(
    'https://api.maptiler.com/maps/%s/256/%d/%d/%d.%s?key=%s',
    rawurlencode($style), $z, $x, $y, $ext, rawurlencode($MAPTILER_KEY)
);

$ch = curl_init($upstream);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT        => 12,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_USERAGENT      => 'SunStudio-tile-proxy/1.0 (+' . $scheme . '://' . $self . ')',
]);
$body = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($body === false || $status === 0) fail(502, 'Could not reach the tile service.');

// Pass an upstream refusal through as a plain status: the message may name the
// key or the account, so it is not forwarded to the browser.
if ($status !== 200) {
    fail($status === 403 || $status === 401 ? 502 : $status,
         'The tile service refused the request. Check the key and style on the server.');
}
if (strpos($type, 'image/') !== 0) fail(502, 'Tile service returned a non-image.');

/* ── hand it to the browser ────────────────────────────────────────────── */

header('Content-Type: ' . $type);
header('Content-Length: ' . strlen((string)$body));
header('Cache-Control: public, max-age=' . $BROWSER_CACHE_SECONDS);
// The app draws tiles into a canvas, which needs CORS even same-origin-ish
header('Access-Control-Allow-Origin: ' . $scheme . '://' . $self);
header('X-Content-Type-Options: nosniff');
echo $body;
