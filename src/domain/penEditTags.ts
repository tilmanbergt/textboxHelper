import type {Point, Rect} from './textboxModel';

/**
 * How pen edits are recognized on the page (technical-design-pen-edits.md §3.1, §3.2): their ids,
 * the `userData` Textbox Tools writes into its own page elements (tag icon, number textboxes), the
 * icon shapes and where icon and numbers go.
 *
 * The page is the truth for which pen edits exist: an entry belongs to a page when its tag icon is
 * found there by `userData`.
 */

export type PenEditKind = 'replacement' | 'insertion';

/** What one of our page elements is for. */
export type PenEditRole = 'snippet' | 'marknum' | 'snippetnum';

const ROLES: readonly PenEditRole[] = ['snippet', 'marknum', 'snippetnum'];

export const PEN_EDIT_USERDATA_PREFIX = 'tbh:pe:';

export const PEN_EDIT_ID_PREFIX = 'pe-';
const PEN_EDIT_ID_RE = /^pe-\d{8}-\d{6}-\d{3}$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'pe-YYYYMMDD-HHmmss-NNN' in local time plus three random digits. */
export function newPenEditId(now: Date, random: () => number = Math.random): string {
  const nnn = String(Math.floor(random() * 1000) % 1000).padStart(3, '0');
  return (
    `${PEN_EDIT_ID_PREFIX}${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}-${nnn}`
  );
}

export function isPenEditId(value: string): boolean {
  return PEN_EDIT_ID_RE.test(value);
}

/** 'tbh:pe:<id>:<role>' */
export function penEditUserData(id: string, role: PenEditRole): string {
  return `${PEN_EDIT_USERDATA_PREFIX}${id}:${role}`;
}

/** 'tbh:pe:<id>:<role>' -> {id, role}; anything else -> null. */
export function parsePenEditUserData(value: unknown): {id: string; role: PenEditRole} | null {
  if (typeof value !== 'string' || !value.startsWith(PEN_EDIT_USERDATA_PREFIX)) {
    return null;
  }
  const rest = value.slice(PEN_EDIT_USERDATA_PREFIX.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) {
    return null;
  }
  const id = rest.slice(0, colon);
  const role = rest.slice(colon + 1) as PenEditRole;
  if (!isPenEditId(id) || !ROLES.includes(role)) {
    return null;
  }
  return {id, role};
}

/** True for every page element Textbox Tools placed for a pen edit. */
export function isPenEditElement(element: {userData?: unknown}): boolean {
  return parsePenEditUserData(element.userData) !== null;
}

// ---------------------------------------------------------------------------
// Numbers

/** Font size of the number textboxes: readable, but clearly not body text. */
export const PEN_EDIT_NUMBER_FONT_SIZE = 20;
/** A one- or two-digit textbox at or below this size counts as a pen-edit number. */
export const PEN_EDIT_NUMBER_MAX_FONT_SIZE = 24;
const NUMBER_BOX_WIDTH = 44;
const NUMBER_BOX_HEIGHT = 32;
const NUMBER_GAP = 6;

/**
 * Second guard next to `userData`: a textbox holding only a one- or two-digit number in a small
 * font is treated as a pen-edit number even if the host dropped its `userData`.
 */
export function looksLikePenEditNumber(text: string | null | undefined, fontSize: number | null | undefined): boolean {
  return (
    typeof text === 'string' &&
    /^\d{1,2}$/.test(text.trim()) &&
    typeof fontSize === 'number' &&
    fontSize > 0 &&
    fontSize <= PEN_EDIT_NUMBER_MAX_FONT_SIZE
  );
}

/** One more than the highest number in use; 1 on a page without pen edits. */
export function nextPenEditNumber(numbersInUse: number[]): number {
  return numbersInUse.reduce((highest, n) => (Number.isFinite(n) && n > highest ? n : highest), 0) + 1;
}

/** The number next to the snippet: right of the tag icon. */
export function snippetNumberRect(iconRect: Rect): Rect {
  const left = Math.round(iconRect.right + NUMBER_GAP);
  const top = Math.round(iconRect.top - 2);
  return {left, top, right: left + NUMBER_BOX_WIDTH, bottom: top + NUMBER_BOX_HEIGHT};
}

/** The number at the replace mark: right of the strike's end, centred on it, kept on the page. */
export function markNumberRect(strikeRect: Rect, pageWidth: number): Rect {
  const centerY = (strikeRect.top + strikeRect.bottom) / 2;
  let left = Math.round(strikeRect.right + NUMBER_GAP);
  if (pageWidth > 0 && left + NUMBER_BOX_WIDTH > pageWidth) {
    left = Math.max(0, Math.round(strikeRect.left - NUMBER_GAP - NUMBER_BOX_WIDTH));
  }
  const top = Math.round(centerY - NUMBER_BOX_HEIGHT / 2);
  return {left, top, right: left + NUMBER_BOX_WIDTH, bottom: top + NUMBER_BOX_HEIGHT};
}

// ---------------------------------------------------------------------------
// Tag icon

export const TAG_ICON_SIZE_PX = 28;
const TAG_ICON_INSET_PX = 4;

/** A square of TAG_ICON_SIZE_PX in the top-left corner inside the lasso rect, clamped when small. */
export function tagIconRect(lasso: Rect, size = TAG_ICON_SIZE_PX): Rect {
  const width = Math.max(1, lasso.right - lasso.left);
  const height = Math.max(1, lasso.bottom - lasso.top);
  const s = Math.min(size, width, height);
  const left = lasso.left + Math.min(TAG_ICON_INSET_PX, Math.max(0, width - s));
  const top = lasso.top + Math.min(TAG_ICON_INSET_PX, Math.max(0, height - s));
  return {left: Math.round(left), top: Math.round(top), right: Math.round(left + s), bottom: Math.round(top + s)};
}

/**
 * The icon as a closed polygon filling `box`: a diamond for a replacement, a plus for an insertion.
 */
export function tagIconPolygon(kind: PenEditKind, box: Rect): Point[] {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const cx = Math.round(box.left + w / 2);
  const cy = Math.round(box.top + h / 2);
  if (kind === 'replacement') {
    return [
      {x: cx, y: box.top},
      {x: box.right, y: cy},
      {x: cx, y: box.bottom},
      {x: box.left, y: cy},
      {x: cx, y: box.top},
    ];
  }
  const arm = Math.max(2, Math.round(Math.min(w, h) * 0.17));
  return [
    {x: cx - arm, y: box.top},
    {x: cx + arm, y: box.top},
    {x: cx + arm, y: cy - arm},
    {x: box.right, y: cy - arm},
    {x: box.right, y: cy + arm},
    {x: cx + arm, y: cy + arm},
    {x: cx + arm, y: box.bottom},
    {x: cx - arm, y: box.bottom},
    {x: cx - arm, y: cy + arm},
    {x: box.left, y: cy + arm},
    {x: box.left, y: cy - arm},
    {x: cx - arm, y: cy - arm},
    {x: cx - arm, y: box.top},
  ];
}
