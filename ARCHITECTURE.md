# Architecture

How Solar Analysis Lab is put together: what lives where, how a calculation
flows through the code, and what the tooling around it does. For *why* the
methods were chosen and what they do not model, read
[`docs/method-notes.html`](docs/method-notes.html); this file is the map, not
the argument.

## One file

The whole application is `index.html` — about 1.6 MB, with no build step for
the person using it and nothing fetched at start-up. It opens from a web
server, from disk, or from a USB stick with no connection.

| Part of `index.html` | Size | What it is |
|---|---|---|
| `<head>` and two `<style>` blocks | ~76 kB | Markup, the dark and light themes, layout |
| First `<script>` | ~1.0 MB | three.js r185 (0.185.1), minified, with OrbitControls and OBJLoader, licence headers intact. Exposed as `window.THREE`. |
| Second `<script type="module">` | ~0.5 MB | The application. Of this, ~256 kB is the two embedded data grids. |

Bundling three.js arrived in 1.1.0. Before that the page loaded it from a CDN,
and failed on networks that block one.

## Conventions

- Scene axes: **Y up, −Z north, +X east**. All lengths in metres.
- Irradiance in **W/m²**, cumulative radiation in **kWh/m²**.
- **Project north turns the building, and only the building.** The sun path
  is the sky and the basemap is the ground; both are geographic and stay put.
- A non-leap reference year (`YEAR = 2025`, 8,760 hours) for every
  period calculation.
- The version and release date are written as `BUILD` and `RELEASED`
  constants in the module. The About panel and the deploy build read them;
  `tools/check-release-metadata.mjs` holds them to `CITATION.cff`.

## The calculation chain

Each stage is a self-contained module (an IIFE returning an API) inside the
application script, named as below so it can be found by search.

| Module | Does | Method and source |
|---|---|---|
| `SolarCore` | Sun position, sunrise, sunset, day length | NOAA solar position algorithm (Meeus, *Astronomical Algorithms*) |
| `EPW` | Parses an EnergyPlus weather file | Hourly DNI, DHI, GHI; header supplies site, time zone, elevation |
| `ClearSky` | Stands in when no EPW is loaded | Hottel (1976) beam, Liu & Jordan (1960) diffuse. A synthetic clear day, not a climate |
| `buildSkyDome` | Divides the sky into patches | Tregenza (145) or Reinhart (577), built as Radiance `rh_init()` does |
| `Perez` | Distributes diffuse light over the patches | Perez et al. (1993) all-weather model, coefficients from Radiance `gendaymtx.c` |
| `SkyMatrix` | Turns weather into a list of light sources | Sky patches, ground reflection, and the sun binned on a 2.5° grid, kept out of the sky patches |
| `WORKER_SOURCE` / `Tracer` | Visibility tests | Bounding-volume hierarchy over the model triangles, run in a Web Worker |
| `buildSensorGrid` | Places sensors on every surface | Target edge length set by the user; capped at `MAX_SENSORS` (120,000) |

### An analysis run

`runAnalysis()` drives one run:

1. **Sources.** `buildSources()` asks `SkyMatrix` for either an instant or a
   cumulative period. A period that wraps the new year (the heating season)
   is built in two halves and joined. The result is one flat list: every sky
   patch, the ground, and every sun bin, each a direction with an energy.
2. **Sensors.** `buildSensorGrid()` lays sensors over the model's own
   triangles, offset slightly off each surface.
3. **Occluders.** `occluderTriangles()` collects the model, plus the
   OpenStreetMap context when that switch is on. Context shades the model but
   carries no sensors of its own.
4. **Trace.** `Tracer` hands the triangles to the worker, which builds the
   BVH and answers, for each sensor and source, whether the way is clear.
   Each sensor's value is the cosine-weighted sum of the sources it can see.
5. **Show.** `renderResults()` colours the mesh, `updateLegend()` and
   `updateResultStats()` fill the panel. `exportCSV()` and `exportSheet()`
   write the results out, with every setting that changes the numbers in the
   CSV header.

`unobstructed()` evaluates the same source list against an open surface. The
status bar uses it to compare computed horizontal irradiance with the climate
file's own measured GHI, and the test suite uses it for the physics checks.

## Interaction and drawing

- `State` holds everything the user can change: site, date, time, display
  switches, analysis settings, results.
- Changing a control calls `refresh()`, which recomputes the sun with
  `SolarCore` and redraws through `updateSunVisuals()`.
- Rendering is on demand. `requestRender()` keeps the loop drawing for a
  short window after a change, so an idle page does not hold the GPU.
- The sun path is drawn as a 3D dome or a stereographic chart
  (`buildSunPath()`, `setProjection()`). Over a map, chart lines become
  flat ribbons with a casing (`ribbonFromPoints()`, `addChartLine()`), and the
  ink switches between dark and light by measuring the map's luminance
  (`mapChart()`, `MAP_DARK_BELOW`).
- `Selects`, `Tour` and `About` are small UI modules: the custom drop-downs,
  the first-run guided tour, and the licence, credits and citation panel.

## Site, map and context

| Piece | Does | Network |
|---|---|---|
| `runSearch()` | Place search | Nominatim, on request. A typed coordinate pair (`coordsFromQuery()`) skips it entirely |
| `zoneFromGrid()` | Standard UTC offset for any point | None. 0.25° grid of IANA zone offsets, run-length encoded (~53 kB) |
| `elevationFromGrid()` | Site elevation for the clear-sky model | None. 0.25° ETOPO1 grid in 50 m steps (~203 kB) |
| `rleGridDecode()` | Decodes both grids on first use | — |
| `Mercator` | Web Mercator maths for tiles and footprints | — |
| `Basemap` | Map tiles under the model | OpenStreetMap, a server-side proxy, or a custom tile service, on request |
| `OsmBuildings` | Building footprints as 3D context | This site's `overpass-proxy.php` where installed; otherwise the Overpass API (overpass-api.de, then overpass.private.coffee), on request, retried when busy |

Those three — tiles, Overpass and Nominatim — are the only network requests
the app makes, and only when the user asks for them. Looked-up time zone and
elevation are flagged in the panel until the user confirms or saves them.

What the browser remembers lives in `localStorage` under four keys:
`sunpath.places.v1` (saved locations), `sunpath.theme.v1`,
`sunpath.tour.seen.v1`, and `sunpath.basemap.custom.v1` (a custom tile
service, kept in the browser rather than in the file).

## The repository

```
index.html                  the application
docs/                       method notes (full and short), screenshots
tools/
  build-tz-grid.py          regenerates the time-zone grid from the IANA boundaries
  build-elevation-grid.py   regenerates the elevation grid from ETOPO1
  make-deploy.mjs           builds the files to upload: the page, the buildings proxy, and the tile proxy if a key is given
  make-screenshots.mjs      regenerates the documentation screenshots
  check-release-metadata.mjs  holds every version and date stamp to CITATION.cff
server/tile-proxy.php       keeps a map API key on the server, never in the page
server/overpass-proxy.php   fetches the OpenStreetMap buildings and keeps them 30 days
tests/
  verify.mjs                the headless test suite
  overpass-proxy.mjs        checks the buildings proxy under PHP's built-in server
  fetch-vendor.mjs          fetches the Chicago TMY3 climate file the physics checks use
CITATION.cff, .zenodo.json  citation and archive metadata
LICENSE, NOTICE             MIT for code, CC BY 4.0 for documentation, third-party notices
```

Both grid scripts write a block to paste into `index.html` between markers,
and record their source, checksum and measured accuracy.

## Testing and release

`npm test` runs both checks:

- `tools/check-release-metadata.mjs` (14 checks). Versions, dates and DOIs
  agree across `package.json`, `.zenodo.json`, `CITATION.cff`, `index.html`
  and both method notes pages. The DOI rule is derived from `CITATION.cff`, so
  it knows whether a version DOI has been minted yet.
- `tests/verify.mjs` (about 300 checks). Drives the shipped file in headless
  Chromium: solar geometry, the sky model, analysis results against the
  Chicago O'Hare TMY3 file's measured irradiance, the site lookups, the
  interface in both themes, the tour, the export, and the deploy build.

A release goes: bump every stamp, run both checks, cut the tag, let Zenodo
archive it, then record the new version DOI in a separate commit. Until then
the documents cite the concept DOI and say why.
