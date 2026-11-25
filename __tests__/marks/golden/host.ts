import type {NativeDetailedMeasurement} from '../../../src/domain/textboxLayout';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION, textLeftX} from '../../../src/domain/textboxLayout';
import type {PenEditEntry, PenEditIndex, PenEditMark} from '../../../src/domain/penEditModel';
import type {Drawn, Layout, Pt} from '../build';
import {rectOf} from '../build';

/**
 * A fake plugin host for the golden record (technical-design-mark-dialogue.md §3): a page is
 * given as textboxes and strokes in writing order, with tagged text as the index has it, and
 * served to the review exactly where the device serves it: `readPageContext` (the page's
 * elements), the native text measurement and the pen-edit index. Everything between - stroke
 * reading, shapes, places, pairing, the assembly - is the plugin's own code.
 */

export const NOTE_PATH = '/golden.note';
export const LOCKED_FONT = '/fonts/locked.ttf';

/** A textbox of a page; `locked`: its font can't be read by plugins. */
export type PageTextbox = Layout & {fontSize: number; locked?: boolean};

/** Strokes of one mark or word, in writing order; `name` lets tagged text refer to them as its mark. */
export type PageItem = Drawn | {name?: string; drawn: Drawn; straight?: boolean; nums?: number[]};

export type PenEditSpec = {
  number: number;
  kind: PenEditEntry['kind'];
  /** The recognized text. */
  text: string;
  /** The tagged handwriting, written after the item named `after` (else at the end). */
  handwriting: Drawn;
  after?: string;
  mark?:
    | {kind: 'replace'; item: string; exact?: boolean; slash?: boolean; erased?: boolean}
    | {kind: 'caret'; item: string; tip: Pt; direction: 'down' | 'up' | 'left' | 'right' | 'step'; erased?: boolean};
  /** False when the host didn't let the tag be written onto the strokes (found by place). */
  tagged?: boolean;
  placement?: 'here';
};

export type PageSpec = {
  name: string;
  /** What the page shows and what today's review makes of it. */
  about: string;
  textboxes: PageTextbox[];
  strokes: PageItem[];
  penEdits?: PenEditSpec[];
};

type Accessor<T> = {size: () => Promise<number>; getRange: (start: number, count: number) => Promise<T[]>};

function accessor<T>(items: T[]): Accessor<T> {
  return {
    size: async () => items.length,
    getRange: async (start, count) => items.slice(start, start + count),
  };
}

const USERDATA = (id: string, role: string) => `tbh:pe:${id}:${role}`;

export function penEditId(number: number): string {
  return `pe-20261124-120000-${String(number).padStart(3, '0')}`;
}

type FakeElement = Record<string, unknown> & {uuid: string; numInPage: number};

function recognizeResult(rect: {left: number; top: number; right: number; bottom: number}) {
  return {
    up_left_point_x: rect.left,
    up_left_point_y: rect.top,
    down_right_point_x: rect.right,
    down_right_point_y: rect.bottom,
  };
}

function strokeElement(num: number, points: Pt[], userData: string | null): FakeElement {
  return {
    uuid: `s${num}`,
    numInPage: num,
    type: 0,
    layerNum: 0,
    textBox: null,
    title: null,
    link: null,
    picture: null,
    geometry: null,
    userData,
    recognizeResult: recognizeResult(rectOf(points)),
    stroke: {
      points: accessor(points),
      recognPoints: accessor(points.map(point => ({X: point.x, Y: point.y}))),
    },
    contoursSrc: null,
  };
}

function lineElement(num: number, points: Pt[], userData: string | null): FakeElement {
  return {
    uuid: `s${num}`,
    numInPage: num,
    type: 700,
    layerNum: 0,
    textBox: null,
    title: null,
    link: null,
    picture: null,
    geometry: {type: 'straightLine', points: [points[0], points[points.length - 1]]},
    userData,
    recognizeResult: null,
    stroke: null,
    contoursSrc: null,
  };
}

function textboxElement(box: PageTextbox): FakeElement {
  return {
    uuid: box.uuid,
    numInPage: box.numInPage,
    type: 500,
    layerNum: 0,
    title: null,
    link: null,
    picture: null,
    geometry: null,
    userData: null,
    textBox: {
      textRect: {...box.rect},
      textContentFull: box.text,
      fontSize: box.fontSize,
      fontPath: box.locked ? LOCKED_FONT : null,
      textAlign: 0,
      textBold: 0,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
    },
  };
}

/** The native measurement that gives this layout: lines and words relative to where the text starts. */
export function measurementOf(box: PageTextbox): NativeDetailedMeasurement {
  const x0 = textLeftX(box.rect.left, DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION);
  const y0 = box.rect.top + DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION.offsetY;
  const lines = box.lines.map(line => {
    const words = box.words.filter(word => word.lineIndex === line.index);
    const left = words.length > 0 ? Math.min(...words.map(word => word.left)) - x0 : 0;
    const right = words.length > 0 ? Math.max(...words.map(word => word.right)) - x0 : 0;
    return {
      index: line.index,
      start: line.start,
      end: line.end,
      left,
      right,
      top: line.top - y0,
      bottom: line.bottom - y0,
      baseline: (line.baseline ?? line.top + (line.bottom - line.top) * 0.8) - y0,
      width: right - left,
    };
  });
  const words = box.words.map(word => {
    const line = box.lines.find(item => item.index === word.lineIndex) ?? box.lines[0];
    const left = word.left - x0;
    const right = word.right - x0;
    const top = line.top - y0;
    const bottom = line.bottom - y0;
    return {
      start: word.start,
      end: word.end,
      tokenStart: word.start,
      tokenEnd: word.end,
      lineIndex: word.lineIndex,
      text: box.text.slice(word.start, word.end),
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
      ...(word.edges ? {charEdges: word.edges.map(edge => edge - x0)} : {}),
    };
  });
  return {
    text: box.text,
    requestedWidth: box.rect.right - box.rect.left,
    requestedFontSize: box.fontSize,
    includePad: false,
    fontPath: box.locked ? LOCKED_FONT : null,
    typefaceStatus: box.locked ? 'default: font file not readable' : 'loaded',
    layoutHeight: box.rect.bottom - box.rect.top,
    lineCount: box.lines.length,
    maxLineWidth: Math.max(0, ...lines.map(line => line.width)),
    ...(box.xHeight ? {xHeight: box.xHeight} : {}),
    lines,
    words,
  };
}

/** The page the fake host serves now, and the pen-edit index it holds. */
export const host: {
  elements: FakeElement[];
  measurements: Map<string, NativeDetailedMeasurement>;
  index: PenEditIndex;
} = {elements: [], measurements: new Map(), index: {version: 1, entries: []}};

const measureKey = (text: string, width: number, fontPath: string | null | undefined) => `${width}|${fontPath ?? ''}|${text}`;

/** Puts a page on the fake host: its elements, their measurements and the tagged text's entries. */
export function servePage(spec: PageSpec): void {
  const elements: FakeElement[] = spec.textboxes.map(textboxElement);
  const measurements = new Map<string, NativeDetailedMeasurement>();
  spec.textboxes.forEach(box => {
    measurements.set(measureKey(box.text, box.rect.right - box.rect.left, box.locked ? LOCKED_FONT : null), measurementOf(box));
  });

  let next = Math.max(0, ...spec.textboxes.map(box => box.numInPage)) + 1;
  const items = new Map<string, Array<{num: number; points: Pt[]; element: FakeElement}>>();
  const entries: PenEditEntry[] = [];
  const markOwner = new Map<string, PenEditSpec>();
  (spec.penEdits ?? []).forEach(edit => {
    if (edit.mark && edit.tagged !== false && !edit.mark.erased) {
      markOwner.set(edit.mark.item, edit);
    }
  });

  const addStrokes = (drawn: Drawn, options: {straight?: boolean; nums?: number[]; userData?: string | null}) =>
    drawn.map((points, index) => {
      const num = options.nums?.[index] ?? next;
      next = Math.max(next, num) + 1;
      const element = options.straight
        ? lineElement(num, points, options.userData ?? null)
        : strokeElement(num, points, options.userData ?? null);
      elements.push(element);
      return {num, points, element};
    });

  const writeHandwriting = (edit: PenEditSpec) => {
    const id = penEditId(edit.number);
    const strokes = addStrokes(edit.handwriting, {userData: edit.tagged === false ? null : USERDATA(id, 'stroke')});
    const strokeRects = strokes.map(item => rectOf(item.points));
    const all = strokes.flatMap(item => item.points);
    const rect = rectOf(all);
    const icon = {left: rect.right + 8, top: rect.top - 30, right: rect.right + 38, bottom: rect.top};
    elements.push({
      uuid: `badge-${edit.number}`,
      numInPage: 1000 + edit.number,
      type: 700,
      layerNum: 0,
      textBox: null,
      title: null,
      link: null,
      picture: null,
      geometry: {
        type: 'GEO_polygon',
        points: [
          {x: icon.left, y: icon.top},
          {x: icon.right, y: icon.top},
          {x: icon.right, y: icon.bottom},
          {x: icon.left, y: icon.bottom},
        ],
      },
      userData: USERDATA(id, 'snippet'),
      recognizeResult: null,
      stroke: null,
    });
    let mark: PenEditMark | null = null;
    if (edit.mark) {
      const drawn = items.get(edit.mark.item) ?? [];
      const rects = drawn.map(item => rectOf(item.points));
      if (edit.mark.kind === 'replace') {
        const strike = edit.mark.erased ? {left: 2000, top: 2000, right: 2100, bottom: 2004} : rects[0];
        // A slash's second stroke is the user's own circle for the number; so is the fourth of a
        // strike with two verticals and a circle (technical-design-mark-dialogue.md §13.4).
        const circled = edit.mark.exact && rects.length === 4;
        const numberRect = edit.mark.erased ? undefined : edit.mark.slash ? rects[1] : circled ? rects[3] : undefined;
        mark = {
          kind: 'replace',
          strikeRect: strike,
          modifierRects: edit.mark.erased || edit.mark.slash ? [] : rects.slice(1, circled ? 3 : undefined),
          ...(numberRect ? {numberRect} : {}),
          ...(edit.mark.exact || edit.mark.slash ? {bounds: 'exact' as const} : {}),
          ...(edit.mark.slash ? {slash: true} : {}),
        };
      } else {
        const union = edit.mark.erased ? {left: 2000, top: 2000, right: 2040, bottom: 2040} : rectOf(drawn.flatMap(item => item.points));
        mark = {kind: 'caret', caretRect: union, tip: {...edit.mark.tip}, direction: edit.mark.direction};
      }
    }
    entries.push({
      id,
      kind: edit.kind,
      notePath: NOTE_PATH,
      page: 0,
      number: edit.number,
      createdAt: '2026-11-24T12:00:00.000Z',
      rect,
      strokeRects,
      iconRect: icon,
      strokesTagged: edit.tagged !== false,
      mark,
      hasPicture: false,
      recognition: {status: 'done', text: edit.text, error: null, ms: 1},
      correctedText: null,
      state: 'active',
      awaitingMark: null,
      edges: null,
      ...(edit.placement ? {placement: edit.placement} : {}),
    });
  };

  const written = new Set<PenEditSpec>();
  spec.strokes.forEach(item => {
    const named = Array.isArray(item) ? {drawn: item} : item;
    const name = 'name' in named ? named.name : undefined;
    const owner = name ? markOwner.get(name) : undefined;
    const strokes = addStrokes(named.drawn, {
      straight: 'straight' in named ? named.straight : undefined,
      nums: 'nums' in named ? named.nums : undefined,
      userData: owner ? USERDATA(penEditId(owner.number), 'mark') : null,
    });
    if (name) {
      items.set(name, strokes);
      (spec.penEdits ?? [])
        .filter(edit => edit.after === name && !written.has(edit))
        .forEach(edit => {
          written.add(edit);
          writeHandwriting(edit);
        });
    }
  });
  (spec.penEdits ?? []).filter(edit => !written.has(edit)).forEach(writeHandwriting);

  host.elements = elements;
  host.measurements = measurements;
  host.index = {version: 1, entries};
}

export const noteElementsMock = {
  readPageContext: async (notePath: string, page: number) => ({notePath, page, pageElements: host.elements}),
  recycleElements: async () => undefined,
  readPageSizeForDiagnostics: async () => ({width: 1404, height: 1872}),
};

export const textboxMetricsMock = {
  resetFontWarnings: () => undefined,
  measureDetailedTextLayout: async (text: string, width: number, _fontSize: number, fontPath?: string) =>
    host.measurements.get(measureKey(text, width, fontPath ?? null)) ?? null,
};

export const penEditStoreMock = {
  readPenEditIndex: async () => ({index: host.index, warning: null}),
  changePenEditIndex: async (change: (index: PenEditIndex) => PenEditIndex) => {
    host.index = change(host.index);
    return host.index;
  },
  penEditPictureUri: async () => '',
  readPenEditStrokes: async () => null,
};
