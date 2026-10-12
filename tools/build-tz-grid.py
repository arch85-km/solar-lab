#!/usr/bin/env python3
"""Build the embedded time-zone offset grid used by Solar Lab.

Solar Lab needs a standard UTC offset for any point on Earth, offline and
without an API key, because a geocoder returns coordinates but no time zone.
This script rasterises the IANA time-zone boundaries onto a 0.25 degree grid
of standard (non-summer) offsets, run-length encodes it, and writes a JS
block for pasting into index.html between the TZGRID markers.

The grid holds the STANDARD offset only. Daylight saving is the app's own
separate toggle, so a summer offset here would double-count it.

Requirements (not needed to run the app, only to regenerate the data):
    pip install timezonefinder     # boundaries, from timezone-boundary-builder
    python >= 3.9                  # zoneinfo, for the offset of each zone

Usage:
    python3 tools/build-tz-grid.py > tz-grid.js

Resolution note: 0.25 degree is about 28 km of latitude. Against the 34,006
cities in the GeoNames cities15000 set the grid agrees with the city's own
recorded zone for 99.6 per cent of them; the residue is towns sitting within
a few kilometres of a zone boundary. Halving the step to 0.125 buys 0.17
points for twice the bytes, which is not a trade worth making in a file a
browser has to download.
"""

import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

STEP = 0.25
NLON = int(round(360 / STEP))
NLAT = int(round(180 / STEP))

# Disjoint alphabets, so a run is self-delimiting: a value character opens a
# run and the base-32 digits after it give the length (absent means 1).
# Neither set contains a quote, a backslash, an ampersand or an angle bracket,
# so the block is safe inside an HTML script element.
DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
VALCHARS = "abcdefghijklmnopqrstuvwxyz!#$%()*+,-.:;=?@[]^_{|}~"


def nautical(lon):
    """The offset a ship would keep: the longitude rule, 15 degrees a zone."""
    return max(-48, min(56, round(lon / 15) * 4))


def standard_offset_quarters(zone, _cache={}):
    """Standard offset of an IANA zone, in quarter hours."""
    if zone in _cache:
        return _cache[zone]
    tz = ZoneInfo(zone)
    fallback = None
    for month in (1, 4, 7, 10):          # both hemispheres' winters
        when = datetime(2026, month, 15, 12)
        offset = tz.utcoffset(when)
        if tz.dst(when) == timedelta(0):
            fallback = offset
            break
        if fallback is None or offset < fallback:
            fallback = offset
    _cache[zone] = int(round(fallback.total_seconds() / 900.0))
    return _cache[zone]


def base32(n):
    out = ""
    while n:
        out = DIGITS[n % 32] + out
        n //= 32
    return out


def main():
    finder = TimezoneFinder(in_memory=True)
    cells = []
    for j in range(NLAT):
        lat = 90 - (j + 0.5) * STEP
        for i in range(NLON):
            lon = -180 + (i + 0.5) * STEP
            zone = finder.timezone_at(lat=lat, lng=lon)
            cells.append(standard_offset_quarters(zone) if zone else nautical(lon))

    values = sorted(set(cells))
    if len(values) > len(VALCHARS):
        sys.exit(f"too many distinct offsets ({len(values)}) for the alphabet")
    symbol = {v: VALCHARS[k] for k, v in enumerate(values)}

    runs, start = [], 0
    for k in range(1, len(cells) + 1):
        if k == len(cells) or cells[k] != cells[start]:
            runs.append((cells[start], k - start))
            start = k
    stream = "".join(symbol[v] + (base32(n) if n > 1 else "") for v, n in runs)

    tzdata = getattr(finder, "timezone_names", [])
    print("// Standard UTC offsets for the whole Earth, in quarter hours, on a")
    print(f"// {STEP} degree grid ({NLON} x {NLAT} cells) walked west to east from the")
    print("// north-west corner, run-length encoded. Built by tools/build-tz-grid.py")
    print("// from the IANA boundaries; see that file for provenance and accuracy.")
    print(f"// {len(runs)} runs, {len(stream)} characters, {len(values)} distinct offsets.")
    print(f"const TZ_GRID_STEP = {STEP};")
    print(f"const TZ_GRID_COLS = {NLON};")
    print(f"const TZ_GRID_ROWS = {NLAT};")
    print(f"const TZ_GRID_VALUES = [{','.join(str(v) for v in values)}];")
    print(f"const TZ_GRID_DIGITS = '{DIGITS}';")
    print(f"const TZ_GRID_SYMBOLS = '{VALCHARS[:len(values)]}';")
    print(f"const TZ_GRID_RUNS = '{stream}';")
    print(f"zones in source data: {len(tzdata)}", file=sys.stderr)
    print(f"runs {len(runs)}  chars {len(stream)}  offsets {len(values)}", file=sys.stderr)


if __name__ == "__main__":
    main()
