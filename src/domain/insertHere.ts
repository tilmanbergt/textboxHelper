import type {Rect} from './textboxModel';

/**
 * "Insert right here" (technical-design-fine-marks.md §8): tagged text without a usable mark goes
 * in as a new paragraph where its handwriting starts - its top-left corner. A little overlap with
 * the paragraph above is tolerated; handwriting over a paragraph's text or beside it is not placed;
 * with no paragraph near, a new textbox goes at the handwriting's place. Pure.
 */

export type HereTextbox = {uuid: string; numInPage: number; rect: Rect; lineHeight: number};

export type HerePlace =
  | {kind: 'gap'; above: string | null; below: string | null}
  | {kind: 'newBox'; left: number; top: number; width: number; styleFrom: string | null}
  | {kind: 'unclear'; reason: string};

/** How far beside a textbox handwriting still counts as "beside it" (not "no paragraph near"). */
export const BESIDE_REACH_PX = 300;
/** Line height assumed when no textbox gives one. */
const DEFAULT_LINE_HEIGHT = 40;
/** A new textbox's right margin and least width. */
const NEW_BOX_MARGIN_PX = 60;
const NEW_BOX_MIN_WIDTH = 300;

function overlapX(a: Rect, b: Rect): number {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left);
}

function distance(rect: Rect, x: number, y: number): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

export function locateHere(
  snippet: Rect,
  textboxes: HereTextbox[],
  pageWidth: number,
  number: number,
): HerePlace {
  const left = snippet.left;
  const top = snippet.top;
  const nearest = [...textboxes].sort((a, b) => distance(a.rect, left, top) - distance(b.rect, left, top))[0];
  const lineHeight = nearest?.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const tolerance = Math.min(0.5 * lineHeight, 0.25 * (snippet.bottom - snippet.top));
  const probeY = top + tolerance;

  const snippetWidth = Math.max(1, snippet.right - snippet.left);
  const column = textboxes.filter(box => {
    const narrower = Math.min(snippetWidth, box.rect.right - box.rect.left);
    return overlapX(snippet, box.rect) >= 0.3 * narrower;
  });

  if (column.length > 0) {
    const inside = column.find(box => probeY >= box.rect.top && probeY <= box.rect.bottom);
    if (inside) {
      const firstLineMiddle = inside.rect.top + 0.5 * inside.lineHeight;
      if (top < inside.rect.top && probeY <= firstLineMiddle) {
        const above = [...column]
          .filter(box => box.rect.bottom <= inside.rect.top)
          .sort((a, b) => b.rect.bottom - a.rect.bottom)[0];
        return {kind: 'gap', above: above?.uuid ?? null, below: inside.uuid};
      }
      return {
        kind: 'unclear',
        reason: `Text ${number} lies over the text of textbox ${inside.numInPage}. Move it between paragraphs, or select a mark.`,
      };
    }
    const above = [...column]
      .filter(box => box.rect.bottom < probeY)
      .sort((a, b) => b.rect.bottom - a.rect.bottom)[0];
    const below = [...column]
      .filter(box => box.rect.top > probeY)
      .sort((a, b) => a.rect.top - b.rect.top)[0];
    return {kind: 'gap', above: above?.uuid ?? null, below: below?.uuid ?? null};
  }

  const beside = textboxes.find(
    box =>
      probeY >= box.rect.top &&
      probeY <= box.rect.bottom &&
      (Math.abs(snippet.left - box.rect.right) <= BESIDE_REACH_PX ||
        Math.abs(box.rect.left - snippet.right) <= BESIDE_REACH_PX),
  );
  if (beside) {
    return {
      kind: 'unclear',
      reason: `Text ${number} is beside textbox ${beside.numInPage}. Move it between paragraphs, or select a mark.`,
    };
  }

  const styleBox = nearest ?? null;
  const maxWidth = pageWidth > 0 ? pageWidth - NEW_BOX_MARGIN_PX - left : NEW_BOX_MIN_WIDTH;
  const wanted = styleBox ? styleBox.rect.right - styleBox.rect.left : maxWidth;
  const width = Math.max(Math.min(NEW_BOX_MIN_WIDTH, Math.max(1, maxWidth)), Math.min(wanted, maxWidth));
  return {kind: 'newBox', left: Math.round(left), top: Math.round(top), width: Math.round(width), styleFrom: styleBox?.uuid ?? null};
}
