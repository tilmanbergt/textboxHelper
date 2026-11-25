import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION, textLeftX} from '../../src/domain/textboxLayout';

/**
 * Test builders for marks and textboxes (technical-design-mark-dialogue.md §3): every case reads
 * like the mark it draws. Strokes are page pixels, sampled every few pixels in drawing order, as
 * the host gives them. Every mark builder returns its strokes as a list (most marks are one
 * stroke; verticals, a step with its second upright or a circle with its contents are more).
 */

export type Pt = {x: number; y: number};
/** The strokes one builder draws, in writing order. */
export type Drawn = Pt[][];

/** Points every `every` pixels along straight segments between the corners. */
export function path(corners: Array<[number, number]>, every = 3): Pt[] {
  const points: Pt[] = [];
  for (let index = 0; index < corners.length - 1; index += 1) {
    const [x1, y1] = corners[index];
    const [x2, y2] = corners[index + 1];
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / every));
    for (let part = 0; part < steps; part += 1) {
      points.push({x: x1 + ((x2 - x1) * part) / steps, y: y1 + ((y2 - y1) * part) / steps});
    }
  }
  const [x, y] = corners[corners.length - 1];
  points.push({x, y});
  return points;
}

export function rectOf(points: Pt[]): {left: number; top: number; right: number; bottom: number} {
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}

function round(points: Pt[]): Pt[] {
  return points.map(point => ({x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10}));
}

// ---------------------------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------------------------

/** A strike from x1 to x2 at height y, drawn left to right with a slight slope. */
export function strike(x1: number, x2: number, y: number): Drawn {
  return [path([[x1, y], [x2, y + 2]])];
}

/** The two short verticals of a replace mark, crossing a strike at height y. */
export function verticals(xLeft: number, xRight: number, y: number, height = 40): Drawn {
  return [
    path([[xLeft, y - height / 2], [xLeft + 1, y + height / 2]]),
    path([[xRight, y - height / 2], [xRight + 1, y + height / 2]]),
  ];
}

/** A small round loop centred at (cx, cy), drawn once around. */
export function loop(cx: number, cy: number, r = 14): Drawn {
  return circle(cx, cy, r);
}

/**
 * A straight slash through (cx, cy), `angleDeg` to the horizontal, `len` long: drawn from its
 * lower left end up to its upper right end.
 */
export function slash(cx: number, cy: number, angleDeg: number, len: number): Drawn {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = (Math.cos(rad) * len) / 2;
  const dy = (Math.sin(rad) * len) / 2;
  return [round(path([[cx - dx, cy + dy], [cx + dx, cy - dy]], 2))];
}

/** A V ('down', tip at the bottom) or a ∧ ('up', tip at the top), `size` wide and tall. */
export function caret(direction: 'down' | 'up', tip: Pt, size = 40): Drawn {
  const dy = direction === 'down' ? -size : size;
  return [path([[tip.x - size / 2, tip.y + dy], [tip.x, tip.y], [tip.x + size / 2, tip.y + dy]])];
}

/** The same caret drawn as two strokes, one per leg, both drawn towards the tip. */
export function caretInTwo(direction: 'down' | 'up', tip: Pt, size = 40): Drawn {
  const dy = direction === 'down' ? -size : size;
  return [
    path([[tip.x - size / 2, tip.y + dy], [tip.x, tip.y]]),
    path([[tip.x + size / 2, tip.y + dy], [tip.x + 1, tip.y]]),
  ];
}

/** A < ('left', tip at the left) or a > ('right'), `size` wide and tall. */
export function sideways(direction: 'left' | 'right', tip: Pt, size = 40): Drawn {
  const dx = direction === 'left' ? size : -size;
  return [path([[tip.x + dx, tip.y - size / 2], [tip.x, tip.y], [tip.x + dx, tip.y + size / 2]])];
}

/**
 * A rising step (_|‾) with its upright at x, centred on y, `height` tall and `width` wide;
 * `second`: with the second upright beside it that makes it a paragraph break (_||‾).
 */
export function step(x: number, y: number, options: {height?: number; width?: number; second?: boolean} = {}): Drawn {
  const height = options.height ?? 48;
  const half = (options.width ?? 80) / 2;
  const drawn = [path([[x - half, y + height / 2], [x, y + height / 2], [x, y - height / 2], [x + half, y - height / 2]])];
  if (options.second) {
    drawn.push(path([[x + 10, y - height / 2 + 4], [x + 10, y + height / 2 - 4]]));
  }
  return drawn;
}

/**
 * A one-line swap mark on a line whose letters span `xTop`–`base` (page y): part A from a[0] to
 * a[1] marked by a line above it, part B from b[0] to b[1] by a line below, joined by the upright
 * at the boundary; both outer uprights drawn.
 */
export function swap(a: [number, number], b: [number, number], zone: {xTop: number; base: number}): Drawn {
  const above = zone.xTop - 12;
  const below = zone.base + 12;
  const split = (a[1] + b[0]) / 2;
  return [
    path([
      [a[0], below],
      [a[0], above],
      [split, above],
      [split, below],
      [b[1], below],
      [b[1], above],
    ]),
  ];
}

/** A + (two strokes) centred at (cx, cy), `size` across: with a ∧ or V it marks a space. */
export function cross(cx: number, cy: number, size = 20): Drawn {
  return [
    path([[cx - size / 2, cy], [cx + size / 2, cy]], 2),
    path([[cx, cy - size / 2], [cx, cy + size / 2]], 2),
  ];
}

/** A round arc from x1 to x2 at height y, its middle 10 px below ('down', a ◡) or above ('up'). */
export function arc(x1: number, x2: number, y: number, bulge: 'down' | 'up', sag = 10): Drawn {
  const steps = 24;
  const sign = bulge === 'down' ? 1 : -1;
  const points: Pt[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    points.push({x: x1 + (x2 - x1) * t, y: y + sign * sag * 4 * t * (1 - t)});
  }
  return [round(points)];
}

/**
 * A circle at (cx, cy) with radius r, drawn once around; `fill` adds what is written inside it:
 * a dot ('.'), a comma (','), two dots (':').
 */
export function circle(cx: number, cy: number, r: number, fill?: '.' | ',' | ':'): Drawn {
  const steps = 32;
  const ring: Pt[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (2 * Math.PI * index) / steps;
    ring.push({x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)});
  }
  const dot = (x: number, y: number) => path([[x - 1.5, y - 1.5], [x + 1.5, y - 1.5], [x + 1.5, y + 1.5], [x - 1.5, y + 1.5]], 1);
  const contents: Drawn =
    fill === '.'
      ? [dot(cx, cy)]
      : fill === ':'
      ? [dot(cx, cy - r * 0.35), dot(cx, cy + r * 0.35)]
      : fill === ','
      ? [path([[cx, cy - r * 0.3], [cx + 1, cy + r * 0.1], [cx - 2, cy + r * 0.5]], 1)]
      : [];
  return [round(ring), ...contents];
}

/**
 * Handwriting that is no mark: one curved, looping stroke per letter, about 22 px wide and 34 px
 * high, starting at (x, y) (the letters' top left).
 */
export function hand(word: string, x: number, y: number): Drawn {
  return [...word].map((_, index) => {
    const left = x + index * 26;
    const points: Pt[] = [];
    for (let sample = 0; sample <= 40; sample += 1) {
      const t = sample / 40;
      points.push({
        x: left + 11 + 10 * Math.sin(t * 4 * Math.PI) * (0.6 + 0.4 * t),
        y: y + 34 * t + 6 * Math.cos(t * 6 * Math.PI),
      });
    }
    return round(points);
  });
}

// ---------------------------------------------------------------------------------------------
// Textboxes
// ---------------------------------------------------------------------------------------------

/** A textbox's measured lines and words in page pixels (the shape of `CaretTextbox`). */
export type Layout = {
  uuid: string;
  numInPage: number;
  rect: {left: number; top: number; right: number; bottom: number};
  text: string;
  lines: Array<{index: number; start: number; end: number; top: number; bottom: number; baseline?: number}>;
  words: Array<{start: number; end: number; lineIndex: number; left: number; right: number; edges?: number[]}>;
  xHeight?: number;
};

export type TextboxSpec = Layout & {fontSize: number};

/** Character advance and line height of the fixed-advance test font, per font size. */
export const ADVANCE_PER_FONT_SIZE = 0.5;
export const LINE_HEIGHT_PER_FONT_SIZE = 4 / 3;

/**
 * A textbox laid out with a fixed advance per character (half the font size: 18 px at 36) and
 * lines 4/3 of the font size high (48 px at 36), as NOTE draws it with the default calibration:
 * the text starts 15 px right of the textbox's left edge. Words wrap at the width; `\n` starts a
 * new line. Expected offsets are easy to read: character i of a line starts at x0 + 18·i.
 */
export function textbox(
  text: string,
  options: {left: number; top: number; width: number; fontSize?: number; uuid?: string; numInPage?: number},
): TextboxSpec {
  const fontSize = options.fontSize ?? 36;
  const advance = fontSize * ADVANCE_PER_FONT_SIZE;
  const lineHeight = Math.round(fontSize * LINE_HEIGHT_PER_FONT_SIZE);
  const x0 = textLeftX(options.left, DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION);
  const usable = options.width - DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION.widthAdjustment;
  const perLine = Math.max(1, Math.floor(usable / advance));

  // Lines: [start, end) offsets, a line ending after its trailing space or at its '\n'.
  const lineRanges: Array<[number, number]> = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const paragraphEnd = newline < 0 ? text.length : newline;
    let end = start;
    // Fill the line word by word.
    while (end < paragraphEnd) {
      let wordEnd = end;
      while (wordEnd < paragraphEnd && text.charAt(wordEnd) !== ' ') {
        wordEnd += 1;
      }
      if (wordEnd - start > perLine && end > start) {
        break;
      }
      end = wordEnd;
      while (end < paragraphEnd && text.charAt(end) === ' ') {
        end += 1;
      }
    }
    if (end >= paragraphEnd) {
      lineRanges.push([start, newline < 0 ? text.length : newline + 1]);
      if (newline < 0) {
        break;
      }
      start = newline + 1;
    } else {
      lineRanges.push([start, end]);
      start = end;
    }
  }

  const lines: Layout['lines'] = [];
  const words: Layout['words'] = [];
  lineRanges.forEach(([from, to], index) => {
    const top = options.top + index * lineHeight;
    lines.push({index, start: from, end: to, top, bottom: top + lineHeight, baseline: top + Math.round(lineHeight * 0.8)});
    const pattern = /[^\s]+/g;
    const lineText = text.slice(from, to);
    let match: RegExpExecArray | null = pattern.exec(lineText);
    while (match) {
      const wordStart = from + match.index;
      const length = match[0].length;
      const left = x0 + match.index * advance;
      words.push({
        start: wordStart,
        end: wordStart + length,
        lineIndex: index,
        left,
        right: left + length * advance,
        edges: Array.from({length: length + 1}, (_, char) => left + char * advance),
      });
      match = pattern.exec(lineText);
    }
  });
  return {
    uuid: options.uuid ?? 'tb1',
    numInPage: options.numInPage ?? 1,
    rect: {left: options.left, top: options.top, right: options.left + options.width, bottom: options.top + lines.length * lineHeight},
    text,
    lines,
    words,
    xHeight: Math.round(fontSize * 0.53),
    fontSize,
  };
}

/** Where character `offset` of a laid-out textbox starts (x) and its line's letters (y). */
export function at(box: Layout, offset: number): {x: number; line: number; mid: number; xTop: number; base: number} {
  const line = box.lines.find(item => offset >= item.start && offset < item.end) ?? box.lines[box.lines.length - 1];
  const word = box.words.find(item => item.lineIndex === line.index && offset >= item.start && offset <= item.end);
  const lineWords = box.words.filter(item => item.lineIndex === line.index);
  const advance = word?.edges && word.edges.length > 1 ? word.edges[1] - word.edges[0] : 18;
  const x = word ? word.left + (offset - word.start) * advance : (lineWords[0]?.left ?? box.rect.left) + (offset - line.start) * advance;
  const base = line.baseline ?? line.top + (line.bottom - line.top) * 0.8;
  const xHeight = box.xHeight ?? (line.bottom - line.top) * 0.4;
  return {x, line: line.index, mid: base - xHeight / 2, xTop: base - xHeight, base};
}

/** A device-recorded page (diagnostics JSON) from `__tests__/fixtures/<name>.json`. */
export function fixture(name: string): {note: string; boxes: Layout[]; strokes: Record<string, Pt[]>} {
  return require(`../fixtures/${name}.json`);
}

/**
 * The strokes of several builders as pass 1 reads them, in writing order: ids `s1`, `s2`, … and
 * page numbers 1, 2, … in the order given; rects are the points' bounds.
 */
export function marks(...drawn: Drawn[]): Array<{id: string; numInPage: number; rect: ReturnType<typeof rectOf>; points: Pt[] | null; straightLine: boolean}> {
  return drawn.flat().map((points, index) => ({
    id: `s${index + 1}`,
    numInPage: index + 1,
    rect: rectOf(points),
    points,
    straightLine: false,
  }));
}

/**
 * A textbox as pass 2 sees it (`TextboxView`): measured with the builder's layout; `locked`: its
 * font can't be read; `measured: false`: not measured yet (pass 2 asks for it).
 */
export function view(box: TextboxSpec, options: {locked?: boolean; measured?: boolean} = {}) {
  const measured = options.measured ?? true;
  return {
    uuid: box.uuid,
    numInPage: box.numInPage,
    rect: {...box.rect},
    text: box.text,
    measured,
    layout: measured ? box : null,
    fontReadable: !options.locked,
    ...(options.locked ? {lockedReason: 'The font locked.ttf can\'t be read by plugins.'} : {}),
  };
}

/** The strokes of several builders as a page gives them to pass 2, in writing order. */
export function page(...drawn: Drawn[]) {
  return marks(...drawn).map(stroke => ({id: stroke.id, numInPage: stroke.numInPage, stroke}));
}
