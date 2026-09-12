# Third-party notices

Sun Studio is licensed under the MIT License (see `LICENSE`). It builds on the work
below. Copies of the required notices are reproduced in full.

---

## three.js

The only runtime dependency. Loaded from jsDelivr at
`https://cdn.jsdelivr.net/npm/three@0.185.1/` — the app itself contains no three.js code.
**If you self-host three.js instead** (the offline option in the README), you are
redistributing copies and this notice must ship alongside them.

Project: https://github.com/mrdoob/three.js

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## Radiance

Sun Studio contains no Radiance code, but two things were derived from it and
reimplemented in JavaScript:

- the Tregenza / Reinhart sky-patch construction, following `rh_init()` in `gendaymtx.c`;
- the Perez all-weather sky coefficient table and its parameter equations
  (`PerezCoeff`, `CalcPerezParam`, `CalcRelLuminance` in `gendaymtx.c`).

The coefficients themselves are published data from Perez, Seals & Michalsky (1993),
*Solar Energy* 50(3):235–245, Table 1. The notice below is reproduced as the Radiance
Software License asks.

Project: https://github.com/LBNL-ETA/Radiance

```
The Radiance Software License, Version 2.0

Radiance v6.1 Copyright (c) 1990 to 2025, The Regents of the University of
California, through Lawrence Berkeley National Laboratory (subject to receipt
of any required approvals from the U.S. Dept. of Energy).  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

(1) Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.

(2) Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

(3) Neither the name of the University of California, Lawrence Berkeley
National Laboratory, U.S. Dept. of Energy nor the names of its contributors
may be used to endorse or promote products derived from this software
without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

You are under no obligation whatsoever to provide any bug fixes, patches,
or upgrades to the features, functionality or performance of the source
code ("Enhancements") to anyone; however, if you choose to make your
Enhancements available either publicly, or directly to Lawrence Berkeley
National Laboratory, without imposing a separate written license agreement
for such Enhancements, then you hereby grant the following license: a
non-exclusive, royalty-free perpetual license to install, use, modify,
prepare derivative works, incorporate into other computer software,
distribute, and sublicense such enhancements or derivative works thereof,
in binary and source code form.
```

---

## Methods and published data — credited, not licensed

These are scientific methods, correlations and datasets rather than licensed software.
They are implemented from their published descriptions and cited here as good practice.

| Used for | Source |
|---|---|
| Solar position, equation of time, refraction | NOAA Global Monitoring Laboratory solar calculator; Meeus, *Astronomical Algorithms*, 2nd ed. A US federal work, public domain in the United States. |
| Sky radiance distribution | Perez, R., Seals, R., Michalsky, J. (1993). *All-Weather Model for Sky Luminance Distribution.* Solar Energy 50(3):235–245. |
| Sky clearness and brightness | Perez, R., Ineichen, P., Seals, R., Michalsky, J., Stewart, R. (1990). *Modeling Daylight Availability and Irradiance Components from Direct and Global Irradiance.* Solar Energy 44(5):271–289. |
| Sky hemisphere subdivision | Tregenza, P. R. (1987); Reinhart, C. F. subdivision factors. |
| Clear-sky fallback | Hottel, H. C. (1976) beam transmittance; Liu, B. Y. H. & Jordan, R. C. (1960) diffuse correlation. |
| EPW field layout | EnergyPlus Weather File (EPW) Data Dictionary, US Department of Energy. |

The "Ladybug spectrum" colour scheme is named after the palette used by
[Ladybug Tools](https://www.ladybug.tools/), so that students recognise it from
Grasshopper. No Ladybug Tools code is included in this app.

---

## OpenStreetMap — map tiles and geocoding

The **Site Basemap** feature can fetch raster tiles from `tile.openstreetmap.org`, and
the **Find a place** search queries Nominatim. Both are operated by the OpenStreetMap
Foundation and both are used under their published policies.

- Map data and geocoding results are **© OpenStreetMap contributors**, licensed under the
  Open Database License (ODbL). The app displays this credit in the viewport whenever a
  basemap is loaded and repeats it in the footer of every exported study sheet.
- Tiles are fetched **only for the site extent currently being viewed** and are capped at
  6 × 6 per load. Nothing is pre-fetched, cached for offline use or archived — the OSMF
  Tile Usage Policy prohibits bulk downloading.
- Place searches run **only on an explicit Search or Enter**, never per keystroke, with at
  least 1.1 s between requests, to stay inside the Nominatim usage policy.
- Both policies may change at any time, and both ask heavy users to run their own servers.
  **If your deployment grows beyond light teaching traffic, switch to your own tile server
  or a commercial provider.** The basemap source is a small table (`TILE_SOURCES` in
  `index.html`) precisely so another provider can be dropped in with its own attribution.

No basemap is loaded by default, and the alternative **Site image** source uses a file you
supply, involving no third party at all.

## OpenStreetMap building data (Overpass API)

The **OpenStreetMap + 3D buildings** basemap fetches building footprints and height tags
from the **Overpass API** (`overpass-api.de`) and extrudes them.

- The data is OpenStreetMap's, under the **Open Database License (ODbL) 1.0**, and carries
  the same **"© OpenStreetMap contributors"** credit the app already shows on screen and in
  exported sheets.
- Overpass is a free, volunteer-run service with an
  [API usage policy](https://dev.overpass-api.de/): it is for modest, occasional use. The
  app makes **one request per load**, for a box capped at 600 m across, only when you pick
  that source, and it never polls. Do not wire it into anything that loops.
- Heights in OpenStreetMap are incomplete. Untagged buildings are drawn at 8 m and the
  panel says how many were guessed; the volumes are context for a sun study, not survey
  data.

## MapTiler and other tile services

The basemap can also use **MapTiler** aerial imagery or any XYZ raster service. The app
itself holds **no key and no way to store one**: a key in a public page is readable by
anyone who views the source, and its usage counts against the key owner's quota.

- MapTiler imagery reaches the app only through `server/tile-proxy.php`. The key sits in
  that PHP file, which a server executes rather than serves, so it never reaches the
  browser. The proxy answers only requests from pages on its own host, validates the tile
  coordinates, restricts the style to an allowlist and rate-limits per visitor, so it
  cannot be used as an open proxy.
- Tiles from MapTiler are used under **your** MapTiler Cloud account and its terms, and
  require the attribution **"© MapTiler © OpenStreetMap contributors"**, which the app
  displays on screen and in exported sheets.
- For a custom XYZ service you type the attribution that provider requires, and it is
  shown verbatim. Honouring that provider's terms is yours to do. A template you type is
  held in memory for the session only; it is never stored or written into the file.

---

### Why there is no Google Maps option

The Google Maps Platform terms include a *No Use With Non-Google Maps* restriction —
Google Maps content may not be used with or near a non-Google map. Painting Google tiles
onto this app's ground plane would be Google imagery displayed with no Google map present,
which those terms do not allow. Google Maps Platform also requires a billing-enabled API
key, which cannot be distributed inside a freely shared file. A Google basemap is
therefore deliberately absent rather than merely unimplemented.

---

## Weather data

**Sun Studio redistributes no weather data.** EPW files are supplied by the person using
the app, and are read in the browser — nothing is uploaded anywhere.

The test suite downloads one EPW at run time (Chicago O'Hare TMY3, from the Ladybug Tools
test assets) purely to validate the physics; it is not committed to this repository and is
not part of any deployment.

If you bundle an EPW file with your own deployment, check the terms of the collection it
came from. Most are free to use and redistribute, but some sources restrict redistribution
even where the download itself is free.

---

## Fonts

No web fonts are loaded. The interface uses a system font stack, so no font licence
applies to a deployment of this app.
