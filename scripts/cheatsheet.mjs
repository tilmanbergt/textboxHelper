#!/usr/bin/env node
// The cheat sheet of the editing marks (technical-design-release-readiness.md §6.1): one picture
// with the core marks' icons (docs/user/images/marks/<id>-icon.png) and a few words each, drawn
// to docs/user/images/cheatsheet/cheatsheet.png with its size and hash in cheatsheet.json. The PNG
// is committed; scripts/gen-mark-images.mjs bundles it, and "Put cheat sheet on this page" puts
// it into the note.
//
//   npm run cheatsheet            draw it when this script or an icon changed
//   node scripts/cheatsheet.mjs --check   fail when the picture is missing or stale (in npm run check)
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'docs', 'user', 'images', 'marks');
const OUT = join(ROOT, 'docs', 'user', 'images', 'cheatsheet');
const PNG = join(OUT, 'cheatsheet.png');
const META = join(OUT, 'cheatsheet.json');

/** The rows: a mark's icon, its name, a few words; `text` marks the ones that take tagged text. */
export const CHEAT_SHEET = {
  title: 'Editing marks',
  rows: [
    {id: 'delete', name: 'Delete', words: 'a line through the words'},
    {id: 'replace', name: 'Replace', words: 'strike plus a small circle', text: true},
    {id: 'insert', name: 'Insert', words: 'a caret or a V where the words go', text: true},
    {id: 'delete-letters', name: 'Change letters', words: 'strike with two short lines: exactly what is between'},
    {id: 'slash', name: 'One letter', words: 'a slash through it'},
  ],
  footer: [
    '+ text: write the new words right after the mark, lasso them,',
    'and tap Insertion or Replacement in the lasso toolbar.',
    'Then open Manuscript to review and apply. More marks: ? in Manuscript.',
  ],
};

const W = 1200;
const PAD = 40;
const TITLE = 44;
const NAME = 32;
const WORDS = 28;
const ROW = 104;
const ICON_BOX = {width: 300, height: 84};

function hashOf() {
  const h = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  for (const row of CHEAT_SHEET.rows) h.update(readFileSync(join(ICONS, `${row.id}-icon.png`)));
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

function font(file) {
  const bytes = readFileSync(require.resolve(file));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const text = font('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff');

const fmt = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// Glyph by glyph, as scripts/lib/markDrawing.mjs does (opentype.js's shaping gives NaN for some ligatures).
function glyphs(str, x, baseline, size) {
  let d = '';
  let cx = x;
  for (const ch of str) {
    const g = text.charToGlyph(ch);
    for (const k of g.getPath(cx, baseline, size).commands) {
      if (k.type === 'M' || k.type === 'L') d += `${k.type}${fmt(k.x)} ${fmt(k.y)}`;
      else if (k.type === 'Q') d += `Q${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x)} ${fmt(k.y)}`;
      else if (k.type === 'C') d += `C${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x2)} ${fmt(k.y2)} ${fmt(k.x)} ${fmt(k.y)}`;
      else d += 'Z';
    }
    cx += (g.advanceWidth * size) / text.unitsPerEm;
  }
  return {d, end: cx};
}

function label(str, x, baseline, size, bold = false) {
  const {d, end} = glyphs(str, x, baseline, size);
  const path = bold
    ? `<path d="${d}" fill="#000" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#000"/>`;
  return {svg: path, end};
}

function pngSize(bytes) {
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

const parts = [];
let y = PAD + TITLE;
parts.push(label(CHEAT_SHEET.title, PAD, y, TITLE, true).svg);
y += 24;
parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#000" stroke-width="2"/>`);
y += 12;
for (const row of CHEAT_SHEET.rows) {
  const bytes = readFileSync(join(ICONS, `${row.id}-icon.png`));
  const size = pngSize(bytes);
  const scale = Math.min(ICON_BOX.width / size.width, ICON_BOX.height / size.height);
  const iw = size.width * scale;
  const ih = size.height * scale;
  const ix = PAD + (ICON_BOX.width - iw) / 2;
  const iy = y + (ROW - ih) / 2;
  parts.push(
    `<image x="${fmt(ix)}" y="${fmt(iy)}" width="${fmt(iw)}" height="${fmt(ih)}" href="data:image/png;base64,${bytes.toString('base64')}"/>`,
  );
  const tx = PAD + ICON_BOX.width + 32;
  const name = label(row.name, tx, y + ROW / 2 - 6, NAME, true);
  parts.push(name.svg);
  if (row.text) {
    // The "+ text" badge, as in the help.
    const bx = name.end + 16;
    const badge = label('+ text', bx + 10, y + ROW / 2 - 12, 22, true);
    parts.push(`<rect x="${fmt(bx)}" y="${fmt(y + ROW / 2 - 36)}" width="${fmt(badge.end - bx + 10)}" height="32" rx="6" fill="none" stroke="#000" stroke-width="2"/>`);
    parts.push(badge.svg);
  }
  parts.push(label(row.words, tx, y + ROW / 2 + 32, WORDS).svg);
  y += ROW;
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#bdbdbd" stroke-width="1.5"/>`);
}
y += 16;
for (const line of CHEAT_SHEET.footer) {
  y += WORDS + 12;
  parts.push(label(line, PAD, y, WORDS).svg);
}
const H = Math.ceil(y + PAD);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="#000" stroke-width="3"/>${parts.join('')}</svg>`;
const png = toGrayPng(new Resvg(svg, {font: {loadSystemFonts: false}}).render().asPng());
const {width, height} = decodePng(png);
mkdirSync(OUT, {recursive: true});
writeFileSync(PNG, png);
writeFileSync(META, `${JSON.stringify({hash: hashOf(), width, height, bytes: png.length}, null, 2)}\n`);
console.log(`cheatsheet: ${width} x ${height} (${(png.length / 1024).toFixed(1)} KB)`);
