// Drawing the help pictures of the edit marks (docs/dev/history/technical-design-mark-help.md):
// one spec entry (docs/user/marks/marks.mjs) becomes one SVG: the marked textbox with the pen
// marks and the tagged handwriting on top, an arrow, and the text after Apply below. Text is laid
// out and turned into outlines with opentype.js, so the picture doesn't depend on installed fonts;
// pen strokes get a small, seeded wobble so they look written by hand but stay clean and identical
// on every run. Pure apart from the fonts handed in: no file access.

export const IMAGE_WIDTH = 960;
const PAD = 28;
const TEXT_SIZE = 34;
const LINE_HEIGHT = 1.55;
const HAND_SIZE = 46;
const PEN = 3.6;
const GREY = '#8a8a8a';
const FRAME = '#bdbdbd';
/** What Textbox Tools puts on the page itself (the numbers) is drawn in this grey, never black. */
const TOOL = '#7a7a7a';

/**
 * A string's outline drawn glyph by glyph (no shaping): opentype.js's own text shaping gives
 * NaN coordinates for some ligatures of these fonts ("fi"), and plain glyphs are all a help
 * picture needs.
 */
function advance(font, text, size) {
  let w = 0;
  for (const ch of text) w += font.charToGlyph(ch).advanceWidth;
  return (w * size) / font.unitsPerEm;
}

/** Path commands as SVG path data; opentype.js's own toPathData rounds some values to NaN. */
function commandsToPath(commands) {
  return commands
    .map(k => {
      if (k.type === 'M' || k.type === 'L') return `${k.type}${fmt(k.x)} ${fmt(k.y)}`;
      if (k.type === 'Q') return `Q${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x)} ${fmt(k.y)}`;
      if (k.type === 'C') return `C${fmt(k.x1)} ${fmt(k.y1)} ${fmt(k.x2)} ${fmt(k.y2)} ${fmt(k.x)} ${fmt(k.y)}`;
      return 'Z';
    })
    .join('');
}

function glyphPath(font, text, x, baseline, size) {
  let d = '';
  let cx = x;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    d += commandsToPath(g.getPath(cx, baseline, size).commands);
    cx += (g.advanceWidth * size) / font.unitsPerEm;
  }
  return d;
}

/** A small seeded random generator (mulberry32), so the wobble is the same on every run. */
function random(seedText) {
  let a = 0;
  for (const c of seedText) a = (Math.imul(a ^ c.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = n => (Math.round(n * 10) / 10).toString();

/**
 * A polyline as a hand-drawn stroke: resampled every few pixels, pushed sideways by a slow,
 * smooth wobble (two sine waves with seeded phase), drawn as a smoothed path. Corners stay
 * corners because each leg is wobbled on its own.
 */
export function handStroke(points, rnd, amount = 1.3) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / 6));
    const nx = -(y1 - y0) / (len || 1);
    const ny = (x1 - x0) / (len || 1);
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, f1 = 0.6 + rnd() * 0.8, f2 = 1.8 + rnd() * 1.4;
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const edge = Math.sin(Math.PI * t); // ends stay where they are meant to be
      const w = amount * edge * (Math.sin(p1 + f1 * Math.PI * t) + 0.35 * Math.sin(p2 + f2 * Math.PI * t));
      out.push([x0 + (x1 - x0) * t + nx * w, y0 + (y1 - y0) * t + ny * w]);
    }
  }
  return out;
}

/** Points through a smooth path (Catmull-Rom as cubic Béziers). */
export function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/** A circle (or ellipse) as a hand-drawn loop: slightly open, slightly overlapping, not quite round. */
function handLoop(cx, cy, rx, ry, rnd) {
  const pts = [];
  const start = -1.2 + rnd() * 0.4;
  const turn = 2 * Math.PI + 0.35;
  for (let k = 0; k <= 36; k++) {
    const a = start + (turn * k) / 36;
    const r = 1 + 0.05 * Math.sin(3 * a + rnd() * 0.2) + 0.03 * (k / 36);
    pts.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]);
  }
  return pts;
}

/** Text laid out on lines with every word's and character's x, in image pixels. */
function layoutLines(font, lines, x, top, size) {
  const scale = size / font.unitsPerEm;
  const asc = font.ascender * scale;
  const lh = size * LINE_HEIGHT;
  return lines.map((text, li) => {
    const baseline = top + li * lh + (lh - size) / 2 + asc * 0.92;
    const chars = [];
    let cx = x;
    for (const ch of text) {
      const w = advance(font, ch, size);
      chars.push({ch, x: cx, w});
      cx += w;
    }
    const words = [];
    let i = 0;
    while (i < chars.length) {
      if (chars[i].ch === ' ') { i++; continue; }
      let j = i;
      while (j < chars.length && chars[j].ch !== ' ') j++;
      words.push({text: text.slice(i, j), start: i, x0: chars[i].x, x1: chars[j - 1].x + chars[j - 1].w});
      i = j;
    }
    return {text, baseline, top: top + li * lh, bottom: top + (li + 1) * lh, xHeight: baseline - size * 0.27, capTop: baseline - size * 0.72, chars, words, x1: cx};
  });
}

/** Text with **bold** parts as outlines; bold is drawn as a thicker outline stroke. */
function textPaths(font, text, x, baseline, size, color = '#000') {
  const parts = text.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  let out = '';
  let cx = x;
  for (const part of parts) {
    const bold = part.startsWith('**');
    const t = bold ? part.slice(2, -2) : part;
    const d = glyphPath(font, t, cx, baseline, size);
    out += bold
      ? `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="${color}"/>`;
    cx += advance(font, t, size);
  }
  return out;
}

const plain = text => text.replace(/\*\*/g, '');

/**
 * Where a spec position is: `{line, word, edge: 'start' | 'end'}` for a word's edge,
 * `{line, gap}` for the middle of the space before word `gap`, `{line, word, char}` for the
 * boundary before character `char` of a word.
 */
function xOf(lines, pos) {
  const line = lines[pos.line ?? 0];
  if (pos.gap !== undefined) {
    const w = line.words[pos.gap];
    const prev = line.words[pos.gap - 1];
    return prev ? (prev.x1 + w.x0) / 2 : w.x0 - 6;
  }
  const w = line.words[pos.word];
  if (pos.char !== undefined) return line.chars[w.start + pos.char].x;
  return pos.edge === 'end' ? w.x1 : w.x0;
}

/** The pen marks a spec can draw, each returning SVG. `ctx` has lines, fonts, rnd and the handwriting slots. */
const MARKS = {
  /** A line through words, at mid x-height, a little past both ends. */
  strike(m, c) {
    const L = c.lines[m.line ?? 0];
    const y = (L.baseline + L.xHeight) / 2 + 1;
    const x0 = xOf(c.lines, {line: m.line, word: m.from, edge: 'start'}) - 5;
    const x1 = xOf(c.lines, {line: m.line, word: m.to, edge: 'end'}) + 6;
    c.anchor = {x: x1, y};
    return pen(handStroke([[x0, y + 1], [x1, y - 1]], c.rnd, 1.1), c);
  },
  /** The replace loop: small and round, right after the strike's end at its height. */
  loop(m, c) {
    // Drawn just above the line near the strike's end (the other place the recognizer accepts,
    // right after the end, collides with the next word at this text size).
    const r = 19;
    const L = c.lines[m.line ?? 0];
    const cx = c.anchor.x - 4, cy = L.capTop - r - 6;
    return pen(handLoop(cx, cy, r, r * 0.9, c.rnd), c) + (m.number ? numberIn(c, m.number, cx, cy) : '');
  },
  /** Two short verticals across the strike, at its ends. */
  verticals(m, c) {
    const L = c.lines[m.line ?? 0];
    const xs = [xOf(c.lines, {line: m.line, word: m.from, edge: 'start'}) - 2, xOf(c.lines, {line: m.line, word: m.to, edge: 'end'}) + 3];
    return xs.map(x => pen(handStroke([[x + 1, L.capTop - 6], [x - 1, L.baseline + 8]], c.rnd, 0.8), c)).join('');
  },
  /** A V (tip down, on the baseline) or ∧ (tip up, legs below the line); number between the leg ends. */
  caret(m, c) {
    const L = c.lines[m.line ?? 0];
    const x = xOf(c.lines, m.at);
    const h = m.size ?? 30, half = h * 0.55;
    let pts, num;
    if (m.dir === 'down') {
      const tip = L.baseline + 4;
      pts = [[x - half, tip - h], [x, tip], [x + half, tip - h]];
      num = [x, tip - h * 0.55];
    } else {
      const tip = L.baseline + 2;
      pts = [[x - half, tip + h], [x, tip], [x + half, tip + h]];
      num = [x, tip + h * 0.62];
    }
    c.anchor = {x: x + half, y: L.baseline};
    let svg = pen(handStroke(pts, c.rnd, 0.9), c);
    if (m.number) svg += numberIn(c, m.number, num[0], num[1], 0.62);
    if (m.circle) {
      // The punctuation circle between the legs (punctMark.ts: its middle in the caret's opening),
      // with the mark written inside it.
      const r = h * 0.3;
      const cx = x, cy = m.dir === 'down' ? L.baseline + 4 - h * 0.62 : L.baseline + 2 + h * 0.62;
      svg += pen(handLoop(cx, cy, r, r, c.rnd), c);
      if (m.circle === ',') svg += pen([[cx + 1, cy], [cx + 2.5, cy + r * 0.25], [cx + 1, cy + r * 0.5], [cx - 3, cy + r * 0.75]], c);
      else if (m.circle === '.') svg += pen([[cx, cy], [cx + 1, cy + 1]], c);
    }
    if (m.cross) {
      // The small cross that makes a caret an inserted space: at the tip, inside the caret's
      // opening (spaceMark.ts accepts its middle within 40 px of the tip).
      const s2 = 6;
      const cy = m.dir === 'down' ? L.baseline - h * 0.7 : L.baseline + h * 0.7;
      svg += pen(handStroke([[x - s2, cy - s2], [x + s2, cy + s2]], c.rnd, 0.3), c) + pen(handStroke([[x - s2, cy + s2], [x + s2, cy - s2]], c.rnd, 0.3), c);
    }
    return svg;
  },
  /** A < or > in the margin, its tip at the boundary below line `after` (or above line 0 with after: -1). */
  sideways(m, c) {
    const lines = c.lines;
    const next = lines[m.after + 1];
    // Between two textboxes (an empty line in the spec) the tip sits in the middle of the gap.
    const y = m.after < 0 ? lines[0].top : next && next.text === '' ? (next.top + next.bottom) / 2 : lines[m.after].bottom;
    const right = m.dir === 'left'; // '<' sits right of the text and points left
    const x = right ? Math.max(...lines.map(l => l.x1)) + 30 : c.textX - 30;
    const w = 44, h = 36;
    const pts = right ? [[x + w, y - h], [x, y], [x + w, y + h]] : [[x - w, y - h], [x, y], [x - w, y + h]];
    c.anchor = {x, y};
    let svg = pen(handStroke(pts, c.rnd, 0.8), c);
    if (m.number) svg += numberIn(c, m.number, right ? x + w * 0.7 : x - w * 0.7, y, 0.6);
    return svg;
  },
  /** The step mark _|‾ : under the line to the right, up at the gap, on above the next word. */
  step(m, c) {
    const L = c.lines[m.line ?? 0];
    const x = xOf(c.lines, {line: m.line, gap: m.gap});
    const yLow = L.baseline + 10, yHigh = L.capTop - 10;
    const pts = [[x - 70, yLow], [x, yLow], [x, yHigh], [x + 70, yHigh]];
    let svg = pen(handStroke(pts, c.rnd, 0.9), c);
    // The second upright that makes a step a paragraph break (_||‾): beside the step's own upright
    // (paragraphMarks.ts accepts 3-32 px) and at least half as tall.
    if (m.second) svg += pen(handStroke([[x + 13, L.capTop - 7], [x + 13, L.baseline + 7]], c.rnd, 0.5), c);
    return svg;
  },
  /**
   * The swap mark: up at A's start, across above A, down between A and B, across below B, up at
   * B's end (a sideways S with square corners).
   */
  swap(m, c) {
    const L = c.lines[m.line ?? 0];
    const a0 = xOf(c.lines, {line: m.line, word: m.a[0], edge: 'start'}) - 6;
    const split = xOf(c.lines, {line: m.line, gap: m.b[0]});
    const b1 = xOf(c.lines, {line: m.line, word: m.b[1], edge: 'end'}) + 6;
    const top = L.capTop - 12, low = L.baseline + 12, mid = (top + low) / 2;
    const pts = [[a0, mid], [a0, top], [split, top], [split, low], [b1, low], [b1, mid]];
    return pen(handStroke(pts, c.rnd, 1), c);
  },
  /** A slash through one character: short, steep, a little taller than the letters. */
  slash(m, c) {
    const L = c.lines[m.line ?? 0];
    const w = c.lines[m.line ?? 0].words[m.word];
    const ch = L.chars[w.start + m.char];
    const x = ch.x + ch.w / 2;
    const top = L.capTop - 6, bottom = L.baseline + 8;
    c.anchor = {x: x + 30, y: L.baseline};
    let svg = pen(handStroke([[x + 7, top], [x - 7, bottom]], c.rnd, 0.4), c);
    if (m.number) svg += ringAbove(c, m.number, x + 7, top);
    return svg;
  },
  /** A strike with two verticals at exact character places (from/to: {word, char} or edge). */
  exact(m, c) {
    const L = c.lines[m.line ?? 0];
    const y = (L.baseline + L.xHeight) / 2 + 1;
    const x0 = xOf(c.lines, {line: m.line, ...m.from});
    const x1 = xOf(c.lines, {line: m.line, ...m.to});
    c.anchor = {x: x1 + 20, y};
    let svg = pen(handStroke([[x0 - 2, y + 1], [x1 + 2, y - 1]], c.rnd, 0.6), c);
    svg += [x0, x1].map(x => pen(handStroke([[x + 1, L.capTop - 6], [x - 1, L.baseline + 8]], c.rnd, 0.5), c)).join('');
    if (m.number) svg += ringAbove(c, m.number, x1, L.capTop - 6);
    return svg;
  },
  /**
   * The close-up arc ‿ under a gap (or ⁀ over it, dir 'down'); `piece: 'end'` after the line's last
   * word, `'start'` before its first, for a gap at a line wrap.
   */
  arc(m, c) {
    const L = c.lines[m.line ?? 0];
    let x0, x1;
    if (m.piece === 'end') {
      const last = L.words[L.words.length - 1];
      x0 = last.x1 - 22; x1 = last.x1 + 22;
    } else if (m.piece === 'start') {
      const first = L.words[0];
      x0 = first.x0 - 22; x1 = first.x0 + 22;
    } else {
      const x = xOf(c.lines, {line: m.line, gap: m.gap});
      x0 = x - 22; x1 = x + 22;
    }
    const up = m.dir !== 'down';
    const y = up ? L.baseline + 6 : L.capTop - 6;
    const sag = up ? 12 : -12;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push([x0 + (x1 - x0) * t, y + sag * 4 * t * (1 - t)]);
    }
    return pen(handStroke(pts, c.rnd, 0.3), c);
  },
  /** Tagged handwriting: the words in a handwriting face, with the circled number left of them. */
  write(m, c) {
    const x = m.x ?? (c.anchor ? c.anchor.x + 40 : c.textX), y = m.y;
    const hand = c.hand;
    const w = advance(hand, m.text, HAND_SIZE);
    const path = glyphPath(hand, m.text, x, y, HAND_SIZE);
    let svg = `<path d="${path}" fill="#000"/>`;
    if (m.number) {
      const r = 15;
      svg += `<circle cx="${fmt(x - r - 10)}" cy="${fmt(y - 12)}" r="${r}" fill="none" stroke="${TOOL}" stroke-width="2"/>`;
      svg += numberIn(c, m.number, x - r - 10, y - 12);
    }
    c.handRight = Math.max(c.handRight ?? 0, x + w);
    return svg;
  },
};

function pen(points, c) {
  if (c) {
    c.maxY = Math.max(c.maxY ?? 0, ...points.map(p => p[1] + PEN));
    c.minY = Math.min(c.minY ?? Infinity, ...points.map(p => p[1] - PEN));
    c.maxX = Math.max(c.maxX ?? 0, ...points.map(p => p[0] + PEN));
    c.minX = Math.min(c.minX ?? Infinity, ...points.map(p => p[0] - PEN));
  }
  return `<path d="${smoothPath(points)}" fill="none" stroke="#000" stroke-width="${PEN}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The plugin's grey ring with the number, just above a point (a vertical's or slash's top). */
function ringAbove(c, n, x, top) {
  if (c.icon) return '';
  const r = 15, cy = top - r - 2;
  return `<circle cx="${fmt(x)}" cy="${fmt(cy)}" r="${r}" fill="none" stroke="${TOOL}" stroke-width="2"/>` + numberIn(c, n, x, cy);
}

/** A number as the plugin places it: small, upright, centred on a point. */
function numberIn(c, n, cx, cy, scale = 0.6) {
  if (c.icon) return '';
  c.hasNumbers = true;
  const size = TEXT_SIZE * scale;
  const t = String(n);
  const w = advance(c.text, t, size);
  return `<path d="${glyphPath(c.text, t, cx - w / 2, cy + size * 0.36, size)}" fill="${TOOL}"/>`;
}

/** Frames for textbox groups: one per run of lines between empty lines. */
function groupFrames(texts, laid, textX) {
  const frames = [];
  let start = 0;
  texts.forEach((t, i) => {
    if (t === '' || i === texts.length - 1) {
      const end = t === '' ? i - 1 : i;
      if (end >= start) {
        const x1 = Math.max(...laid.slice(start, end + 1).map(l => l.x1)) + 14;
        const y0 = laid[start].top, y1 = laid[end].bottom;
        frames.push(`<rect x="${textX - 14}" y="${fmt(y0 - 6)}" width="${fmt(x1 - textX + 14)}" height="${fmt(y1 - y0 + 12)}" rx="4" fill="none" stroke="${FRAME}" stroke-width="1.5" stroke-dasharray="6 5"/>`);
      }
      start = i + 1;
    }
  });
  return frames.join('');
}

/** The marked textbox and the pen marks; handwriting rows below it unless `icon`. */
function drawMarked(spec, fonts, top, textX, icon) {
  const c = {lines: layoutLines(fonts.text, spec.before, textX, top, TEXT_SIZE), rnd: random(spec.id), text: fonts.text, hand: fonts.hand, textX, anchor: null, icon};
  const boxBottom = c.lines[c.lines.length - 1].bottom;
  let handY = boxBottom + 22 + HAND_SIZE * 0.8;
  let handRows = 0;
  const marks = spec.marks
    .map(m => {
      if (m.type === 'write') {
        if (icon) return '';
        const svg = MARKS.write({...m, y: handY, x: m.x ?? textX + 30}, c);
        handY += HAND_SIZE * 1.2;
        handRows++;
        return svg;
      }
      const draw = MARKS[m.type];
      if (!draw) throw new Error(`${spec.id}: unknown mark type "${m.type}"`);
      return draw(m, c);
    })
    .join('');
  const bottom = Math.max(handRows ? handY - HAND_SIZE * 0.4 : boxBottom + 6, c.maxY ?? 0);
  const svg = groupFrames(spec.before, c.lines, textX) + c.lines.map(l => textPaths(fonts.text, l.text, textX, l.baseline, TEXT_SIZE)).join('') + marks;
  return {svg, c, bottom};
}

const LABEL = 20;

/**
 * One picture: `spec` = {id, before: string[], marks: [...], after: string[] (with **bold** for
 * new text)}. "Marked" with the pen marks and tagged handwriting, an arrow, "After Apply". When
 * the plugin puts numbers on the page, a grey key says so. Returns {svg, width, height}.
 */
export function drawMark(spec, fonts) {
  const textX = PAD + 70;
  const label = (t, x, y) => textPaths(fonts.text, t, x, y, LABEL, GREY);
  const labelY = PAD + LABEL;
  const marked = drawMarked(spec, fonts, labelY + 34, textX, false);

  const arrowTop = marked.bottom + 18;
  const arrowX = textX + 20;
  const arrow = `<path d="M${arrowX} ${fmt(arrowTop)} V${fmt(arrowTop + 30)} M${arrowX - 9} ${fmt(arrowTop + 21)} L${arrowX} ${fmt(arrowTop + 31)} L${arrowX + 9} ${fmt(arrowTop + 21)}" fill="none" stroke="${GREY}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const afterLabelY = arrowTop + 30 + LABEL + 12;
  const afterTop = afterLabelY + 34;
  const afterLines = layoutLines(fonts.text, spec.after.map(plain), textX, afterTop, TEXT_SIZE);
  const afterText = spec.after.map((t, i) => textPaths(fonts.text, t, textX, afterLines[i].baseline, TEXT_SIZE)).join('');
  const height = Math.ceil(afterLines[afterLines.length - 1].bottom + PAD);

  // The key for the plugin's numbers, top right: a grey circled 1 and what it means.
  let key = '';
  if (marked.c.hasNumbers) {
    const text = 'placed by Textbox Tools';
    const w = advance(fonts.text, text, LABEL);
    const x = IMAGE_WIDTH - PAD - w;
    key = `<circle cx="${fmt(x - 20)}" cy="${fmt(labelY - 7)}" r="12" fill="none" stroke="${TOOL}" stroke-width="1.8"/>` +
      numberIn({...marked.c, icon: false}, 1, x - 20, labelY - 7, 0.5) + label(text, x, labelY);
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    label('Marked', PAD, labelY),
    key,
    marked.svg,
    arrow,
    label('After Apply', PAD, afterLabelY),
    groupFrames(spec.after, afterLines, textX),
    afterText,
    '</svg>',
  ].join('\n');
  return {svg, width: IMAGE_WIDTH, height};
}

/**
 * The small picture for the overview: only the marked textbox and the pen mark, no handwriting,
 * no numbers, cropped to what is drawn. Returns {svg, width, height} in full-size pixels; the
 * renderer scales it down.
 */
export function drawMarkIcon(spec, fonts) {
  const textX = 70;
  const marked = drawMarked(spec, fonts, 40, textX, true);
  const c = marked.c;
  const right = Math.max(...c.lines.map(l => l.x1)) + 16;
  const x0 = Math.min(textX - 16, c.minX ?? Infinity) - 8;
  const x1 = Math.max(right, c.maxX ?? 0) + 8;
  const y0 = Math.min(c.lines[0].top - 8, c.minY ?? Infinity) - 8;
  const y1 = Math.max(marked.bottom, c.lines[c.lines.length - 1].bottom + 8) + 8;
  const width = Math.ceil(x1 - x0), height = Math.ceil(y1 - y0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${fmt(x0)} ${fmt(y0)} ${width} ${height}"><rect x="${fmt(x0)}" y="${fmt(y0)}" width="100%" height="100%" fill="#fff"/>${marked.svg}</svg>`;
  return {svg, width, height};
}
