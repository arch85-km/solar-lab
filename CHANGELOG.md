# Changelog

Every release of Solar Analysis Lab, newest first. Each entry is a summary;
the release page linked from its heading has the full notes, and the version
DOI resolves to the archived copy of exactly that build. To cite the software
in general rather than one build, use the concept DOI
[10.5281/zenodo.22812939](https://doi.org/10.5281/zenodo.22812939).

## Unreleased

- **Fixed** with an EPW loaded and **Daylight saving** ticked, the sun and the
  weather were paired an hour apart: a single moment read the following hour's
  record, and a cumulative run computed each record's sun an hour early. EPW
  hours are standard time, so the switch now moves the clock only. On the test
  suite's Chicago file a year's east and west façades had come out about 21%
  high and low; with the switch ticked they now match the run without it.
- **Fixed** exercise 1's plan labelled the neighbours "11 m" where it meant
  their height; they now read "11 m high". Its key named the tower's south face
  blue; it is red.
- **Fixed** with a basemap loaded, an exported sheet was cut down to the sun
  path dome whatever the view, so zooming out, panning or the top view changed
  nothing in the image. The map and the 3D context now count as content, and
  the sheet is the whole view as framed.
- **Fixed** OpenStreetMap buildings often failed with "Failed to fetch". A busy
  Overpass server frequently replies without the header the browser needs, so
  the browser reports only a failed request. That is now treated as busy, like
  a 504: the panel says it is trying again, and it asks up to four times,
  waiting 1, 5 and then 10 s. An attempt with no answer after 45 s is
  abandoned rather than left on "Fetching…".
- **Added** a fallback Overpass server. When overpass-api.de is busy, the next
  try goes to overpass.private.coffee, a second public instance serving the
  same OpenStreetMap data, with no key or account. A server that refuses
  outright is dropped and the other asked, rather than giving up on both.
- **Fixed** a query Overpass ran out of time for comes back as a success with
  a "runtime error" note and no buildings, and was reported as "OpenStreetMap
  has no building footprints mapped around this point". It is now retried as
  a busy server.
- **Fixed** a building load overtaken by a newer one, or by switching the 3D
  context off, is now cancelled. Its answer could arrive late and put the
  previous site's buildings on the new map, and two queries at once counted
  twice against Overpass's per-user limit.
- **Fixed** the guided tour opens each section it points at, and left them all
  open when it finished or was skipped, so the panels came back with every
  control showing. It now closes what it opened and scrolls the panels back;
  a section that was open before the tour stays open.
- **Docs** `ARCHITECTURE.md`, `CHANGELOG.md` and `DESIGN.md` added; the "How
  this was developed" statement in the README, both method notes and
  `.zenodo.json`; both method notes set in the website's style.

## [1.2.1](https://github.com/arch85-km/solar-lab/releases/tag/v1.2.1) — 12 October 2026

Version DOI [10.5281/zenodo.23326705](https://doi.org/10.5281/zenodo.23326705)

A patch release: fixes found on the live 1.2.0 build. No calculation changed,
so every figure 1.2.0 produced comes out the same.

- **Fixed** the toolbar could be scrolled out of the window by toggling cast
  shadows. The app shell now uses `overflow: clip` instead of `hidden`, so it
  is no longer a scroll container.
- **Fixed** the basemap now follows the site however it is moved: picked from
  search, typed into the coordinate fields, or chosen from the city list.
- **Fixed** a typed coordinate pair goes straight to the point instead of to
  the geocoder.
- **Fixed** the previous town's OpenStreetMap buildings are cleared when a new
  load starts, instead of standing over the new site.
- **Changed** Overpass is asked up to three times when it answers busy (429,
  502, 503, 504), backing off 1.5 s and then 3 s.
- **Docs** the short method notes now say where the looked-up time zone and
  elevation come from, and how accurate each is.

## [1.2.0](https://github.com/arch85-km/solar-lab/releases/tag/v1.2.0) — 12 October 2026

Version DOI [10.5281/zenodo.23324265](https://doi.org/10.5281/zenodo.23324265)

- **Added** time zone from the IANA boundaries, embedded as a 0.25° grid:
  right for 99.6% of the world's cities, against 58.9% for the longitude
  estimate it replaces.
- **Added** site elevation from ETOPO1 topography at the same resolution,
  median error 26 m against the preset cities. Both lookups are flagged for
  checking until confirmed.
- **Added** the sample massing can be moved, turned and scaled.
- **Added** a custom tile service, kept in the browser rather than the file.
- **Fixed** turning off cast shadows turned off the sun, dimming the scene.
- **Fixed** the opacity slider did nothing until the camera next moved.
- **Changed** the chart measures the map under it and inks itself dark on a
  street map, light over an aerial. The 3D dome gets the same ribbon
  treatment over a map.
- **Docs** NOTICE gains the attribution for the topography and time-zone data.

## [1.1.0](https://github.com/arch85-km/solar-lab/releases/tag/v1.1.0) — 4 October 2026

Version DOI [10.5281/zenodo.23141695](https://doi.org/10.5281/zenodo.23141695)

- **Changed** three.js is bundled into `index.html` instead of fetched from a
  CDN, so the app opens offline and behind networks that block CDNs. The file
  grew from 0.3 MB to 1.3 MB.
- **Added** the licence, credits, release and citation, inside the app.
- **Added** the short method notes, `docs/method-notes-summary.html`.
- **Fixed** the exercises, corrected against the source and the geometry.
- **Fixed** citations printed 1.0.0's version DOI under a later version label.
- **Added** `tools/check-release-metadata.mjs`, holding every version stamp
  to `CITATION.cff`.

## [1.0.0](https://github.com/arch85-km/solar-lab/releases/tag/v1.0.0) — 17 September 2026

Version DOI [10.5281/zenodo.22812940](https://doi.org/10.5281/zenodo.22812940)

First public release. A sun path in 3D or stereographic projection over the
user's model, real-time shadows, OBJ import and OpenStreetMap context, EPW
climate with a clear-sky fallback, and irradiance on every surface by ray
tracing under the Perez all-weather sky. CSV and study-sheet export, 24 preset
cities, light and dark themes, and a guided tour.
