#!/usr/bin/env python3
"""Build the embedded site-elevation grid used by Solar Lab.

A geocoder returns coordinates and no elevation, so searching for a place left
the elevation field at whatever the previous site used. Elevation feeds the A
term of Hottel's clear-sky model, so London's default 25 m carried over to
Nairobi understates clear-sky DNI by about a quarter. This script rasterises a
global topography grid onto 0.25 degree cells of height above mean sea level
and run-length encodes it into a JS block for index.html.

Heights are stored in 50 m steps and clamped to 0-2500 m, which is not a
shortcut: the app already clamps elevation to that range because it is where
Hottel's fit is valid, and 50 m is worth 1.2 per cent of DNI, well inside the
error of the source grid itself.

SOURCE DATA
    Earth topography at 10 arc-minute resolution, from the Fatiando a Terra
    data collection: ETOPO1 ice-surface heights, expanded in spherical
    harmonics to degree 720 by the ICGEM calculation service and repackaged by
    Fatiando.

    repository  https://github.com/fatiando-data/earth-topography-10arcmin
    DOI         https://doi.org/10.5281/zenodo.5882203
    licence     CC BY 4.0 (the packaging); ETOPO1 itself is US Government
                public domain
    file        raw/etopo1.gdf.xz
    sha256      5654ab6d8bcccb8011348edb13dad31319c50a03c6bcfe3137b43477e4e70a05

    Attribution for the packaged grid is carried in NOTICE, under THIRD-PARTY
    COMPONENTS, and in the app's method notes. Keep it there if you regenerate
    this data: CC BY requires it to travel with any redistribution.

    Note what degree-720 expansion means: the grid is smoothed over roughly
    28 km, so summits are flattened (its highest point is 6,081 m, not
    Everest's 8,848) and valley floors are lifted. That is the right trade for
    this purpose, which is the height of a site's region rather than of a
    summit, but it is why a fjord city like Oslo reads about 180 m high.

Requirements (not needed to run the app, only to regenerate the data):
    pip install numpy
    git clone --depth 1 https://github.com/fatiando-data/earth-topography-10arcmin

Usage:
    python3 tools/build-elevation-grid.py PATH/TO/raw/etopo1.gdf.xz > elev-grid.js

ACCURACY, measured against the hand-checked elevations of the app's own 24
preset cities: median error 26 m, mean 37 m, worst 183 m (Oslo), which is
worth at most 4.8 per cent of clear-sky DNI against the 28 per cent the stale
elevation cost. Against the source grid sampled at the exact point, the
0.25 degree cells lose a median of 15 m, 244 m at the 99th percentile and
700 m at worst, the last in genuine mountain terrain where the field is
flagged for checking anyway. A 0.5 degree grid saves 145 kB and takes the
worst case to 1,750 m, which is as bad as the bug this replaces.
"""

import hashlib
import lzma
import sys

import numpy as np

STEP = 0.25
QUANTUM = 50                      # metres per stored level
CEILING = 2500                    # Hottel's upper bound, the app clamps here too
NLON = int(round(360 / STEP))
NLAT = int(round(180 / STEP))

SRC_STEP = 1 / 6                  # 10 arc-minute source grid
SRC_COLS = 2161                   # nodes, both meridians included
SRC_ROWS = 1081                   # nodes, both poles included
SRC_SHA256 = "5654ab6d8bcccb8011348edb13dad31319c50a03c6bcfe3137b43477e4e70a05"

# Same two disjoint alphabets as tools/build-tz-grid.py: a value character
# opens a run and the base-32 digits after it give the length, absent meaning 1.
DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
VALCHARS = "abcdefghijklmnopqrstuvwxyzWXYZ!#$%()*+,-.:;=?@[]^_{|}~"


def read_source(path):
    """The source grid as [lat 90..-90, lon -180..180] metres."""
    with open(path, "rb") as raw:
        digest = hashlib.sha256(raw.read()).hexdigest()
    if digest != SRC_SHA256:
        print(f"warning: source sha256 is {digest}, expected {SRC_SHA256}",
              file=sys.stderr)
    with lzma.open(path, "rt") as text:
        for line in text:
            if line.startswith("end_of_head"):
                break
        rows = np.loadtxt(text)
    if rows.shape[0] != SRC_COLS * SRC_ROWS:
        sys.exit(f"source has {rows.shape[0]} points, expected {SRC_COLS * SRC_ROWS}")
    return rows[:, 2].reshape(SRC_ROWS, SRC_COLS)


def resample(src):
    """Bilinear sample of the source at the centre of every output cell."""
    lats = 90 - (np.arange(NLAT) + 0.5) * STEP
    lons = -180 + (np.arange(NLON) + 0.5) * STEP
    gy = (90 - lats) / SRC_STEP
    gx = (lons + 180) / SRC_STEP
    y0 = np.clip(gy.astype(int), 0, SRC_ROWS - 1)
    x0 = np.clip(gx.astype(int), 0, SRC_COLS - 1)
    y1 = np.clip(y0 + 1, 0, SRC_ROWS - 1)
    x1 = np.clip(x0 + 1, 0, SRC_COLS - 1)
    fy = (gy - y0)[:, None]
    fx = (gx - x0)[None, :]
    out = (src[np.ix_(y0, x0)] * (1 - fy) * (1 - fx)
           + src[np.ix_(y0, x1)] * (1 - fy) * fx
           + src[np.ix_(y1, x0)] * fy * (1 - fx)
           + src[np.ix_(y1, x1)] * fy * fx)
    # Sea and land below sea level both store as 0: the app clamps there, and
    # it makes every ocean a single run.
    return np.clip(np.round(out / QUANTUM), 0, CEILING // QUANTUM).astype(np.int16)


def base32(n):
    out = ""
    while n:
        out = DIGITS[n % 32] + out
        n //= 32
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__.strip().splitlines()[-1] if False else
                 "usage: build-elevation-grid.py PATH/TO/raw/etopo1.gdf.xz")
    cells = resample(read_source(sys.argv[1])).ravel()

    levels = int(cells.max()) + 1
    if levels > len(VALCHARS):
        sys.exit(f"too many levels ({levels}) for the alphabet")

    starts = np.flatnonzero(np.r_[True, cells[1:] != cells[:-1]])
    lengths = np.diff(np.r_[starts, len(cells)])
    stream = "".join(VALCHARS[int(v)] + (base32(int(n)) if n > 1 else "")
                     for v, n in zip(cells[starts], lengths))

    print("// Height above mean sea level for the whole Earth, in 50 m steps")
    print(f"// clamped to 0-{CEILING} m, on a {STEP} degree grid ({NLON} x {NLAT} cells)")
    print("// walked west to east from the north-west corner, run-length encoded.")
    print("// Built by tools/build-elevation-grid.py from ETOPO1 at 10 arc-minute")
    print("// (doi:10.5281/zenodo.5882203, CC BY 4.0); see that file and NOTICE")
    print("// for provenance, attribution and accuracy.")
    print(f"// {len(starts)} runs, {len(stream)} characters, {levels} levels.")
    print(f"const ELEV_GRID_STEP = {STEP};")
    print(f"const ELEV_GRID_COLS = {NLON};")
    print(f"const ELEV_GRID_ROWS = {NLAT};")
    print(f"const ELEV_GRID_QUANTUM = {QUANTUM};")
    print(f"const ELEV_GRID_DIGITS = '{DIGITS}';")
    print(f"const ELEV_GRID_SYMBOLS = '{VALCHARS[:levels]}';")
    print(f"const ELEV_GRID_RUNS = '{stream}';")
    print(f"runs {len(starts)}  chars {len(stream)}  levels {levels}", file=sys.stderr)


if __name__ == "__main__":
    main()
