#!/usr/bin/env node
// The help pictures of the edit marks (technical-design-mark-help.md §2): draws every entry of
// docs/user/marks/marks.mjs whose spec or drawing code changed into
// docs/user/images/marks/<id>.png (marked + after Apply) and <id>-icon.png (the overview's
// shape), greyscale, and records them in manifest.json. The PNGs are committed;
// scripts/gen-mark-images.mjs bundles them into the plugin.
//
//   npm run marks            draw what changed
//   npm run marks -- --all   draw everything
//   npm run marks -- --check report missing, stale or orphaned pictures (no drawing; in npm run check)
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {MARKS} from '../docs/user/marks/marks.mjs';
import {entryHash, manifestProblems, specProblems} from './lib/markSpec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'user', 'images', 'marks');
const MANIFEST = join(OUT, 'manifest.json');
/** Icons are drawn at this zoom of the full picture's scale. */
const ICON_ZOOM = 0.75;

const drawingSource = readFileSync(join(ROOT, 'scripts', 'lib', 'markDrawing.mjs'), 'utf8');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const args = process.argv.slice(2);

const specIssues = specProblems(MARKS);
if (specIssues.length > 0) {
  for (const issue of specIssues) console.error(`marks: ${issue}`);
  process.exit(1);
}

if (args.includes('--check')) {
  const files = existsSync(OUT) ? readdirSync(OUT) : [];
  const problems = manifestProblems(MARKS, drawingSource, manifest, files);
  for (const problem of problems) console.error(`marks: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`marks: ${MARKS.length} pictures up to date.`);
  process.exit(0);
}

// Drawing needs the dev dependencies; --check above doesn't.
const require = createRequire(import.meta.url);
const opentype = (await import('opentype.js')).default;
const {Resvg} = await import('@resvg/resvg-js');
const {drawMark, drawMarkIcon} = await import('./lib/markDrawing.mjs');
const {toGrayPng, decodePng} = await import('./lib/pngGray.mjs');

function font(file) {
  const bytes = readFileSync(require.resolve(file));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const fonts = {
  text: font('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
  hand: font('@fontsource/caveat/files/caveat-latin-400-normal.woff'),
};

function render(svg, zoom) {
  const png = toGrayPng(new Resvg(svg, {fitTo: {mode: 'zoom', value: zoom}, font: {loadSystemFonts: false}}).render().asPng());
  const {width, height} = decodePng(png);
  return {png, width, height};
}

mkdirSync(OUT, {recursive: true});
const next = {};
let drawn = 0;
for (const entry of MARKS) {
  const hash = entryHash(entry, drawingSource);
  const known = manifest[entry.id];
  const filesThere = existsSync(join(OUT, `${entry.id}.png`)) && existsSync(join(OUT, `${entry.id}-icon.png`));
  if (!args.includes('--all') && known?.hash === hash && filesThere) {
    next[entry.id] = known;
    continue;
  }
  const picture = render(drawMark(entry, fonts).svg, 1);
  const icon = render(drawMarkIcon(entry, fonts).svg, ICON_ZOOM);
  writeFileSync(join(OUT, `${entry.id}.png`), picture.png);
  writeFileSync(join(OUT, `${entry.id}-icon.png`), icon.png);
  next[entry.id] = {
    hash,
    width: picture.width,
    height: picture.height,
    bytes: picture.png.length,
    icon: {width: icon.width, height: icon.height, bytes: icon.png.length},
  };
  drawn += 1;
  console.log(`marks: ${entry.id} ${picture.width} x ${picture.height} (${(picture.png.length / 1024).toFixed(1)} KB), icon ${icon.width} x ${icon.height}`);
}
writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
const leftovers = readdirSync(OUT).filter(name => name.endsWith('.png') && !MARKS.some(e => name === `${e.id}.png` || name === `${e.id}-icon.png`));
for (const name of leftovers) console.warn(`marks: ${name} belongs to no entry: delete it.`);
console.log(`marks: ${drawn} drawn, ${MARKS.length - drawn} unchanged.`);
