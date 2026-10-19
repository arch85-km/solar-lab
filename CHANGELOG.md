# Changelog

Every release of Solar Analysis Lab, newest first. Each entry is a summary;
the release page linked from its heading has the full notes, and the version
DOI resolves to the archived copy of exactly that build. To cite the software
in general rather than one build, use the concept DOI
[10.5281/zenodo.22812939](https://doi.org/10.5281/zenodo.22812939).

## [1.3.0](https://github.com/arch85-km/solar-lab/releases/tag/v1.3.0) — 19 October 2026

Version DOI minted when this release is archived; until then cite the concept
DOI above.

A feature and correctness release. One calculation changed: with an EPW
loaded and **Daylight saving** ticked, the sun and the weather are now paired
at the same hour, so a figure from that case on 1.2.1 does not reproduce here
and should cite 1.2.1's own DOI. Without that switch, and with no trees
placed, every result comes out as it did on 1.2.1.

- **Added** trees, for shading only. In the new *Trees* section, set a crown
  shape (round, conical or columnar), height, crown width and evergreen or
  deciduous, then click the site to place each tree; click one in the list to
  edit it. Trees shade the analysis and the 3D view like the OpenStreetMap
  context and are never measured. In leaf a crown is solid; a deciduous tree
  out of leaf (in leaf 1 May – 31 October by default, editable) shades with its
  trunk and five forked bare limbs, drawn in the view as well. Deciduous
  crowns are drawn a lighter green, since in leaf the two kinds shade alike.
  A cumulative run spanning both is traced in in-leaf and leaf-off
  parts. On the reference box, a 10 m round tree 6 m south of it cuts the south
  face's year from 1,089 to 908 kWh/m² evergreen and 992 deciduous, and the
  deciduous year equals its parts run separately. With no trees, every result
  is identical to before: compared value by value, the difference is zero.
- **Fixed** the buildings of a large imported model looked as if they floated:
  their shadows in the 3D view started metres away from the walls. The shadow
  offset was a fixed share of the shadow camera's depth, 0.2–0.5 m for the
  samples but 5 m for a 552 × 594 m Cadmapper district of Sheffield, so at noon
  in June a 9 m building's 5 m shadow all but vanished. It is now capped at
  0.5 m, and the shadow area for a large model covers the model plus its
  tallest part's shadow at a 5° sun, rather than 3.2 times its radius (about
  970 m against 1,323 m, so each shadow texel is about 0.95 m, not 1.29 m).
  The samples' shadows are unchanged. The view only: the analysis traces exact
  rays and was never affected.
- **Changed** the 3D view is lighter when the sun is low. A December day in
  Sheffield never gets the sun past 14°, and the view's ambient light and
  background, which follow the sun's height, made the whole day read as dusk;
  shadows at full strength from a 5° sun, eleven times as long as the
  buildings are tall, turned an imported city grey. The ambient light now
  stays above half while the sun is up and fades to a quarter by 6° below the
  horizon, and shadows lighten as the sun drops below 30°, as a low sun's
  weak direct light does. In the dark theme the demo massing at 09:00 on
  21 December reads 62 where it read 56 (noon in June: 77, unchanged). Every
  readout and every analysis value is identical to before.
- **Changed** the OpenStreetMap buildings are asked for in a box snapped to a
  grid of about 220 m, so sites close together ask for the same box and this
  site's building cache answers them. A box centred on the site was new for
  every coordinate: three points 30 m apart in Sheffield each waited for
  Overpass, and now share one. Sites 30 m apart share a box 84% of the time,
  10 m apart 95%. The box is up to 113 m wider on each side, and buildings
  that do not reach into the site's own square are left out, as before.
- **Changed** the placing buttons (*Place model*, the chart's, *Place trees*)
  show while they wait for a click on the site.
- **Added** a message over the model when the browser runs scripts without
  its compiler, as Microsoft Edge's "Enhance your security on the web" does
  for sites it does not know. Every run then takes about thirteen times as
  long (the demo massing 0.7 s against 9.9 s), and the app seems to hang. In
  Edge the message gives the steps (the padlock, "Enhanced security is active
  for this site", turn it off, Refresh); in any other browser in that mode, to
  use Chrome or Firefox. It stays until hidden. Recognised by timing, the same
  check as Urban Wind Lab's.
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
- **Added** `server/overpass-proxy.php`, uploaded beside the page or, where
  the host refuses PHP in subfolders, at the top of the site; the page looks
  in both places. The browser
  asks its own site for the buildings; the proxy asks the public Overpass
  servers in turn and keeps each answer for 30 days, serving an older one when
  every server is down. A network that blocks Overpass no longer matters, and a
  class loading together costs one request. Where it is not installed the page
  asks Overpass directly, as before. Checked by `tests/overpass-proxy.mjs`.
- **Changed** the tile proxy is looked for at the top of the site too: if no
  tile comes back from `tile-proxy.php` beside the page, the page tries the
  site root, where a host that refuses PHP in subfolders still runs it.
- **Changed** the buildings proxy counts each visitor's fetches for the hour
  under a keyed hash of the address, with a random key made for the hour, and
  deletes the counts and the key as soon as the hour is over. It used a plain
  hash, which can be undone by trying every IPv4 address, and left the counts
  in the server's temporary folder. Nothing it keeps can now be traced to an
  address once its hour is over. Checked by four new checks in
  `tests/overpass-proxy.mjs`, which fail on the old code.
- **Fixed** the buildings proxy kept its answers as plain `.json` files, which
  SiteGround serves directly whatever `.htaccess` says, so a kept answer could
  be downloaded by its name. They are now `.php` files whose first line ends a
  direct request with nothing; an old `.json` answer is moved into that form
  with its age kept.
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
- **Fixed** widening the window back past 1100 px threw "Maximum call stack
  size exceeded" dozens of times and brought back only the left panel: the
  panel switch re-entered the resize handler before it had recorded the new
  width. Both panels now return, with no error.
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
