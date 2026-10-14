# Design decisions

The decisions behind Solar Analysis Lab, and my reasons for them.
[`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code is organised, and
[`docs/method-notes.html`](docs/method-notes.html) describes the methods and
their limits. This file records why the tool is the way it is. Written in
October 2026, at version 1.2.1.

— Karam Al-Obaidi

## Why it exists

My students needed to study sun and shade on their own early-stage massing,
and none of the tools available to them fitted that well:

- **Ladybug and Grasshopper** are powerful, but they need Rhino, a licence and
  a scripting skill set most students do not have at the early stages of design.
- **Ecotect** and similar legacy tools have been discontinued, and nothing
  replaced their ease for teaching sun paths and overshadowing.
- **Paper sun-path charts and heliodons** are good for geometry, but they give
  no irradiance numbers and do not work on the student's own model.

## Why it runs in the browser

The tool is a single HTML file because of where it has to run:

- **University-managed machines.** Nothing to install, no admin rights, no
  licences, nothing for IT to approve.
- **Any device, and embeddable.** It runs on students' own laptops, Mac or
  Windows, and sits inside my applications page on the web.

## Method

### Following Radiance and Ladybug

The calculation follows the Radiance and Ladybug chain: the Perez all-weather
sky, Tregenza and Reinhart sky patches, and coefficients transcribed from
Radiance's `gendaymtx.c`. I chose this over a simpler uniform sky for three
reasons:

- **Every step traces to a published source**, so a number can be defended.
- **It is a bridge to professional tools.** Students who move on to Ladybug and
  Honeybee meet the same concepts, and the results agree on the diffuse term.
- **I use it for research too**, so the numbers need to be defensible beyond
  the teaching room.

### No reflected light, for now

Reflected light is not modelled: a ray that hits a surface is blocked and
does not bounce. That is a limit of running in a browser, not a statement
that it does not matter. I would add it if it could run fast enough in a
browser tab. Until then, the method notes tell students that a courtyard reads
darker than it really is.

### A clear sky when there is no climate file

With no EPW file loaded, the tool falls back to a synthetic clear sky instead
of refusing to run. I chose that so it **works immediately**: students see
results in the first minute, without first having to find and load a weather
file. The notes are explicit that a clear sky is not a climate, and that a
total produced that way must not be quoted as one.

### The sun kept out of the sky patches

Over a period, sun-up hours are binned onto a 2.5° grid, and the sun is kept
separate from the sky patches rather than smeared across them:

- **Speed in a browser.** Binning reduces a year's ~4,700 sun-up hours to
  about 590 directions, which makes a full-year run feasible in a tab.
- **A known artefact, avoided.** Smearing a low sun across the coarse
  Tregenza patches is a documented weakness of the `gendaymtx` default, and I
  chose not to repeat it.

### Neighbours shade by default

When OpenStreetMap buildings are loaded, they shade the analysis, and that
switch is on by default:

- **Realistic by default.** A site study without its neighbours is the
  misleading case, so the honest default is a shaded run.
- **Students forget.** With the default off, students who never found the
  switch would produce unshaded runs without knowing it.

## Teaching

### The three exercises

The exercises in the method notes come from mistakes I have seen in studio,
and from core teaching points I already teach, made testable on a model:

1. A neighbour that costs nothing at noon can still take your afternoon:
   students judge shade at noon only.
2. Overhang depth is set by the summer altitude, not the equinox: students
   size shading devices at the equinox.
3. East and west are identical under a clear sky and unequal under a real
   climate: students assume east and west behave the same.

### Where it is used, and what that changed

I use the tool in undergraduate and postgraduate teaching. Two features came
directly from watching students use it:

- **The guided tour.** Students did not know where to start, so the app now
  opens with a step-by-step tour.
- **Movable sample massing** (1.2.0). Students wanted to place the sample on
  their own site.

## What it deliberately leaves out

- **Daylight and illuminance.** Daylight factor and illuminance belong to my
  separate Daylight Lab, not here.
- **Energy and thermal modelling.** This stays a solar-access and irradiance
  tool.
- **Accounts and cloud storage.** There is no log-in and no server storage;
  everything stays in the user's browser.

## How a release is checked

Before I teach with a release:

- **The automated suite must pass**: about 290 checks, run in a headless
  browser against the shipped file.
- **I use the live site myself**, as a student would. That is how the 1.2.1
  bugs were found: the toolbar scrolling out of view, and the 3D buildings not
  following a new site.
- **I run the three exercises** and check that their figures still hold.

## Licensing and archiving

The code is MIT and the teaching material is CC BY 4.0:

- **The code is free to reuse.** Anyone can adapt or embed it.
- **The material is reusable with credit.** Other educators can use the notes
  and exercises in their own courses, crediting the source.
- **The cube mark is reserved from both**, so a modified copy cannot pass
  itself off as mine.
- **Open licensing is expected** of this kind of work by my university or
  funders.

Every version is archived on Zenodo with its own DOI:

- **Reproducible figures.** A reported number can be traced to the exact build
  that produced it.
- **A citable research output.** The software counts as an output in its own
  right.
- **A permanent archive.** Each version survives even if my website changes.
- **Credit when reused.** Anyone who uses it has a proper way to cite it.

## How this was made

I defined the problem and the scope: what the tool is for, who it is for and
what it leaves out. I chose the methods and the sources it relies on. I test
it, find and report the bugs, and judge whether a fix works, and I decide
what is released and when.

The code was written with an AI coding assistant, working to my specification
and direction. It wrote most of the code, drafted the documentation, which I
review, diagnosed bugs and proposed fixes, which I then tested, and wrote and
ran the automated tests and release checks.

## Next

- **Reflected light**, once it can run fast enough in a browser.
- **Satellite imagery**, through the server-side tile proxy that keeps the map
  key out of the page.
