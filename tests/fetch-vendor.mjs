/**
 * Downloads the three.js files the app loads from the CDN into tests/.vendor/,
 * mirroring the CDN's own path layout. The verification run serves these in
 * place of the CDN so the suite works without network access to jsDelivr.
 *
 * The paths below are the exact paths index.html requests, so a mismatch here
 * is also a check that the importmap URLs are real package paths.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const VENDOR = join(HERE, '.vendor');
export const THREE_VERSION = '0.185.1';

/** Paths inside the three package that index.html loads via the importmap. */
export const NEEDED = [
  'build/three.module.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/loaders/OBJLoader.js',
  'examples/jsm/libs/stats.module.js',
];

/**
 * The validation EPW: Chicago O'Hare TMY3, from the Ladybug Tools test assets.
 * Fetched rather than committed so the repository stays small and text-only.
 */
export const EPW_URL = 'https://raw.githubusercontent.com/ladybug-tools/ladybug/master/tests/assets/epw/chicago.epw';
export const EPW_PATH = join(HERE, 'assets', 'chicago.epw');

export async function ensureEpw(){
  if (existsSync(EPW_PATH)) return EPW_PATH;
  await mkdir(dirname(EPW_PATH), { recursive: true });
  const res = await fetch(EPW_URL);
  if (!res.ok) throw new Error('Could not download the validation EPW: HTTP ' + res.status);
  await writeFile(EPW_PATH, Buffer.from(await res.arrayBuffer()));
  return EPW_PATH;
}

export async function ensureVendor(){
  const root = join(VENDOR, 'three@' + THREE_VERSION);
  if (existsSync(join(root, 'build/three.module.js'))) return root;

  await mkdir(VENDOR, { recursive: true });
  const meta = await (await fetch('https://registry.npmjs.org/three/' + THREE_VERSION)).json();
  const tgz = join(VENDOR, 'three.tgz');
  const buf = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  await writeFile(tgz, buf);
  await mkdir(root, { recursive: true });
  await run('tar', ['xzf', tgz, '-C', root, '--strip-components=1']);
  await rm(tgz);
  return root;
}

if (import.meta.url === 'file://' + process.argv[1]){
  const root = await ensureVendor();
  await ensureEpw();
  console.log('validation EPW at ' + EPW_PATH);
  const missing = NEEDED.filter(p => !existsSync(join(root, p)) && !p.includes('stats'));
  console.log('vendored three@' + THREE_VERSION + ' at ' + root);
  if (missing.length) { console.error('MISSING CDN PATHS: ' + missing.join(', ')); process.exit(1); }
  console.log('all importmap paths exist in the published package');
}
