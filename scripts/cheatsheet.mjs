#!/usr/bin/env node
// The cheat sheet of the editing marks (technical-design-release-readiness.md §6.1): one picture
// with two columns of examples (docs/user/marks/cheatsheet.mjs), drawn like the help pictures
// (scripts/lib/markDrawing.mjs), each example's text saying what its mark does, and the "+ text"
// rule below. Output: docs/user/images/cheatsheet/cheatsheet.png with its size and hash in
// cheatsheet.json. The PNG is committed; scripts/gen-mark-images.mjs bundles it, and "Put cheat
// sheet on this page" puts it into the note.
//
//   npm run cheatsheet                    draw it when the examples, this script or the drawing changed
//   node scripts/cheatsheet.mjs --check   fail when the picture is missing or stale (in npm run check)
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'docs', 'user', 'marks', 'cheatsheet.mjs');
const DRAWING = join(ROOT, 'scripts', 'lib', 'markDrawing.mjs');
const OUT = join(ROOT, 'docs', 'user', 'images', 'cheatsheet');
const PNG = join(OUT, 'cheatsheet.png');
const META = join(OUT, 'cheatsheet.json');

const W = 1200;
const PAD = 40;
const TITLE = 44;
const FOOT = 28;
const COL_GAP = 24;
const CELL = {width: (W - 2 * PAD - COL_GAP) / 2, height: 150};

function hashOf() {
  const h = createHash('sha256');
  for (const file of [fileURLToPath(import.meta.url), SPEC, DRAWING]) h.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}

if (process.argv.includes('--check')) {
  const meta = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : null;
  if (!meta || !existsSync(PNG)) {
    console.error('cheatsheet: the picture is missing: run npm run cheatsheet.');
    process.exit(1);
  }
  if (meta.hash !== hashOf()) {
    console.error('cheatsheet: the picture is out of date: run npm run cheatsheet.');
    process.exit(1);
  }
  console.log('cheatsheet: up to date.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const opentype = (await import('opentype.js')).default;
const {Resvg} = await import('@resvg/resvg-js');
const {toGrayPng, decodePng} = await import('./lib/pngGray.mjs');
const {drawMarkExample} = await import('./lib/markDrawing.mjs');
const {CHEAT_SHEET_EXAMPLES, CHEAT_SHEET_FOOTER, CHEAT_SHEET_TITLE} = await import('../docs/user/marks/cheatsheet.mjs');

function font(file) {
  const bytes = readFileSync(require.resolve(file));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const fonts = {
  text: font('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
  hand: font('@fontsource/caveat/files/caveat-latin-400-normal.woff'),
};

const fmt = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// Glyph by glyph, as scripts/lib/markDrawing.mjs does (opentype.js's shaping gives NaN for some ligatures).
function label(str, x, baseline, size, bold = false) {
  let d = '';
  let cx = x;
  for (const ch of str) {
    const g = fonts.text.charToGlyph(ch);
    for (const k of g.getPath(cx, baseline, size).commands) {
      if (k.type === 'M' || k.type === 'L') d += `${k.type}${fmt(k.x)} ${fmt(k.y)}`;
      else if (k.type === 'Q') d += `Q${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x)} ${fmt(k.y)}`;
      else if (k.type === 'C') d += `C${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x2)} ${fmt(k.y2)} ${fmt(k.x)} ${fmt(k.y)}`;
      else d += 'Z';
    }
    cx += (g.advanceWidth * size) / fonts.text.unitsPerEm;
  }
  const svg = bold
    ? `<path d="${d}" fill="#000" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#000"/>`;
  return {svg, end: cx};
}

// Every example at the same scale, so their text has the same size: the largest that fits all cells.
const examples = CHEAT_SHEET_EXAMPLES.map(spec => ({spec, ...drawMarkExample(spec, fonts)}));
const scale = Math.min(...examples.map(e => Math.min(CELL.width / e.width, (CELL.height - 8) / e.height)));

const parts = [];
let y = PAD + TITLE;
parts.push(label(CHEAT_SHEET_TITLE, PAD, y, TITLE, true).svg);
y += 24;
parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#000" stroke-width="2"/>`);
y += 16;
const rows = Math.ceil(examples.length / 2);
examples.forEach((e, i) => {
  const col = i % 2;
  const row = Math.floor(i / 2);
  const cx = PAD + col * (CELL.width + COL_GAP);
  const cy = y + row * CELL.height;
  const w = e.width * scale;
  const h = e.height * scale;
  // The example's own svg, placed and scaled into its cell.
  const inner = e.svg.replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/, `<svg x="${fmt(cx)}" y="${fmt(cy + (CELL.height - h) / 2)}" width="${fmt(w)}" height="${fmt(h)}"`);
  parts.push(inner);
  if (e.spec.text) {
    const badge = label('+ text', 0, 0, 22, true);
    const bw = badge.end + 20;
    const bx = cx + CELL.width - bw;
    const by = cy + 12;
    parts.push(`<rect x="${fmt(bx)}" y="${fmt(by)}" width="${fmt(bw)}" height="32" rx="6" fill="#fff" stroke="#000" stroke-width="2"/>`);
    parts.push(label('+ text', bx + 10, by + 23, 22, true).svg);
  }
  if (col === 0 && row > 0) {
    parts.push(`<line x1="${PAD}" y1="${fmt(cy)}" x2="${W - PAD}" y2="${fmt(cy)}" stroke="#bdbdbd" stroke-width="1.5"/>`);
  }
});
parts.push(`<line x1="${fmt(W / 2)}" y1="${y}" x2="${fmt(W / 2)}" y2="${fmt(y + rows * CELL.height)}" stroke="#bdbdbd" stroke-width="1.5"/>`);
y += rows * CELL.height;
parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#000" stroke-width="2"/>`);
y += 8;
CHEAT_SHEET_FOOTER.forEach((line, i) => {
  y += FOOT + 12;
  parts.push(label(line, PAD, y, FOOT, i === 0 && line.startsWith('+ text')).svg);
});
const H = Math.ceil(y + PAD);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="#000" stroke-width="3"/>${parts.join('')}</svg>`;
const png = toGrayPng(new Resvg(svg, {font: {loadSystemFonts: false}}).render().asPng());
const {width, height} = decodePng(png);
mkdirSync(OUT, {recursive: true});
writeFileSync(PNG, png);
writeFileSync(META, `${JSON.stringify({hash: hashOf(), width, height, bytes: png.length}, null, 2)}\n`);
console.log(`cheatsheet: ${width} x ${height} (${(png.length / 1024).toFixed(1)} KB), examples at ${scale.toFixed(2)}`);
