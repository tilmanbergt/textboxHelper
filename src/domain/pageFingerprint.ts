/**
 * A page's fingerprint for the Manuscript cache (technical-design-manuscript-cache.md §2): what the
 * page's analysis depends on, cheap to read (no stroke points). Same fingerprint → the cached
 * analysis still holds; anything else → read the page again. Uuids are left out (they change with
 * every read, host facts §3); element numbers are in (a cached preview's numbers must still be
 * right for Apply and Drop). Pure.
 */

type RectLike = {left?: number; top?: number; right?: number; bottom?: number} | null | undefined;

export type FingerprintElement = {
  type?: number;
  numInPage?: number;
  layerNum?: number;
  userData?: string | null;
  recognizeResult?: {
    predict_name?: string;
    up_left_point_x?: number;
    up_left_point_y?: number;
    down_right_point_x?: number;
    down_right_point_y?: number;
  } | null;
  textBox?: {
    textContentFull?: string | null;
    textRect?: RectLike;
    fontSize?: number;
    textBold?: number;
    textItalics?: number;
    textFrameStyle?: number;
    textAlign?: number;
  } | null;
  geometry?: {type?: string; points?: {x: number; y: number}[] | null} | null;
  title?: {X?: number; Y?: number; width?: number; height?: number} | null;
  picture?: {rect?: RectLike} | null;
};

/** The parts of a pen-edit index entry that change what the page's analysis finds. */
export type FingerprintPenEntry = {
  id: string;
  kind?: string;
  number?: number | null;
  state?: string;
  mark?: unknown;
  strokesTagged?: boolean;
  awaitingMark?: unknown;
  /** A comment's or image's paragraph, place and Done (its row changes with them). */
  note?: unknown;
};

const rect = (value: RectLike) =>
  value ? [value.left, value.top, value.right, value.bottom].map(round) : null;
const round = (value: number | undefined) =>
  typeof value === 'number' ? Math.round(value * 10) / 10 : null;

function elementKey(element: FingerprintElement): unknown[] {
  const recognized = element.recognizeResult;
  const text = element.textBox;
  return [
    element.type ?? null,
    element.numInPage ?? null,
    element.layerNum ?? null,
    element.userData ?? null,
    recognized
      ? [
          recognized.predict_name ?? null,
          round(recognized.up_left_point_x),
          round(recognized.up_left_point_y),
          round(recognized.down_right_point_x),
          round(recognized.down_right_point_y),
        ]
      : null,
    text
      ? [
          text.textContentFull ?? '',
          rect(text.textRect),
          text.fontSize ?? null,
          text.textBold ?? null,
          text.textItalics ?? null,
          text.textFrameStyle ?? null,
          text.textAlign ?? null,
        ]
      : null,
    element.geometry
      ? [element.geometry.type ?? null, (element.geometry.points ?? []).map(point => [round(point.x), round(point.y)])]
      : null,
    element.title
      ? [round(element.title.X), round(element.title.Y), round(element.title.width), round(element.title.height)]
      : null,
    element.picture ? rect(element.picture.rect) : null,
  ];
}

/**
 * The fingerprint: every element in page order, the active pen edits tagged on the page (sorted by
 * id), and the calibration the page was measured with.
 */
export function pageFingerprint(
  elements: FingerprintElement[],
  penEntries: FingerprintPenEntry[],
  calibration: unknown,
): string {
  const pen = [...penEntries]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(entry => [
      entry.id,
      entry.kind ?? null,
      entry.number ?? null,
      entry.state ?? null,
      entry.mark ?? null,
      entry.strokesTagged ?? null,
      entry.awaitingMark ?? null,
      entry.note ?? null,
    ]);
  return JSON.stringify([elements.map(elementKey), pen, calibration ?? null]);
}

/** Ids of the pen edits whose snippet tag is on the page (`snippetIdOf` parses one `userData`). */
export function snippetIdsOnPage(
  elements: FingerprintElement[],
  snippetIdOf: (userData: string | null | undefined) => string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    const id = snippetIdOf(element.userData);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}
