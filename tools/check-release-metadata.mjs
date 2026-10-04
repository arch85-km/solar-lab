#!/usr/bin/env node
/**
 * Release-metadata consistency.
 *
 * The version is written in several places that nothing builds from and no
 * other test reads, so they drift silently. .zenodo.json is the dangerous one:
 * Zenodo's GitHub integration reads it in preference to the release tag and to
 * CITATION.cff, so a stale version there publishes the archive under the wrong
 * label with a correct new DOI — a failure that looks like success.
 *
 * Dependency-free and runnable on a bare Node: node tools/check-release-metadata.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

/* --- the files that name a version ------------------------------------- */
const versions = {};
if (has('package.json')) versions['package.json'] = JSON.parse(read('package.json')).version;
if (has('.zenodo.json')) versions['.zenodo.json'] = JSON.parse(read('.zenodo.json')).version;

let cff = null, cffVersion = null, cffDois = [];
if (has('CITATION.cff')) {
  cff = read('CITATION.cff');
  cffVersion = (cff.match(/^version:[ \t]*"?([^"\s]+)"?/m) || [])[1];
  versions['CITATION.cff'] = cffVersion;
  cffDois = [...cff.matchAll(/10\.5281\/zenodo\.(\d+)/g)].map((m) => m[0]);
}

const names = Object.keys(versions);
const distinct = [...new Set(Object.values(versions))];
ok(`${names.join(', ')} agree on the version`, distinct.length === 1,
  names.map((n) => `${n} ${versions[n]}`).join(' · '));
const VERSION = distinct[0];

/* --- the documents that print it ---------------------------------------- */
const docs = [];
for (const dir of ['docs', '.']) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const f of readdirSync(full)) {
    if (/method-notes.*\.html$/.test(f)) docs.push(dir === '.' ? f : `${dir}/${f}`);
  }
}
ok('the method notes were found', docs.length > 0, docs.join(', ') || 'none');

/* The concept DOI is the one CITATION.cff carries as its top-level `doi:`;
   citing it in place of a version DOI is what an un-finished release looks
   like, and it is easy to leave behind. */
const conceptDoi = cff
  ? ((cff.match(/^doi:[ \t]*(\S+)/m) || [])[1] || '').replace(/^["']|["']$/g, '') || null
  : null;

for (const doc of docs) {
  const html = read(doc);
  const byline = (html.match(/Version<\/b>[^0-9]*([0-9][0-9.]*)/) || [])[1];
  ok(`${doc} byline names ${VERSION}`, byline === VERSION, `byline ${byline}`);

  const bibDoi = (html.match(/doi\s*=\s*\{([^}]+)\}/) || [])[1];
  if (bibDoi) {
    ok(`${doc} cites a version DOI, not the concept DOI`,
      !!conceptDoi && bibDoi.trim() !== conceptDoi.trim(),
      `BibTeX doi ${bibDoi}, concept ${conceptDoi}`);
    ok(`${doc} cites a DOI that CITATION.cff declares`,
      cffDois.some((d) => bibDoi.includes(d)),
      `${bibDoi} vs ${cffDois.join(', ') || 'none declared'}`);
  }
}

/* The citation the app itself hands a reader. It is the copy most likely to be
   pasted straight into a bibliography, and it sat for two releases naming a
   title no record anywhere carried: "An interactive sun path, shadow and
   irradiance tool", against CITATION.cff's "A browser-based sun path and solar
   irradiance tool". The DOI resolved, so the mistake survived every check that
   looked at DOIs. Compare the title too.

   The panel builds its strings by concatenating source literals across lines,
   so the literal punctuation is stripped before comparing: `\n' +` joins, the
   quotes around each fragment, and the indentation BibTeX uses to wrap a long
   title field. */
const cffTitle = cff
  ? ((cff.match(/^title:[ \t]*(.+)$/m) || [])[1] || '').trim().replace(/^["']|["']$/g, '')
  : null;
if (cffTitle && has('index.html')) {
  const app = read('index.html');
  const flat = (block) => block
    .replace(/\\n/g, ' ')          // the newlines the panel renders
    .replace(/'\s*\+\s*'/g, '')    // fragment joins
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [what, re] of [
    ['APA', /about-apa'\)\.textContent\s*=([\s\S]{0,400}?);/],
    ['BibTeX', /about-bib'\)\.textContent\s*=([\s\S]{0,900}?);/],
  ]) {
    const m = app.match(re);
    ok(`the app's ${what} citation names the title CITATION.cff declares`,
      !!m && flat(m[1]).includes(cffTitle),
      m ? `found "${(flat(m[1]).match(/Solar Analysis Lab[^(}]*/) || ['?'])[0].trim()}"`
        : 'citation block not found');
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
