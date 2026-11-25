import type {Point, Rect} from './textboxModel';

/**
 * How pen edits are recognized on the page (technical-design-pen-edits.md §3.1, §3.2): their ids,
 * the `userData` Textbox Tools writes into its own page elements (tag icon, number textboxes), the
 * icon shapes and where icon and numbers go.
 *
 * The page is the truth for which pen edits exist: an entry belongs to a page when its tag icon is
 * found there by `userData`.
 */

/**
 * What a tagged snippet is, decided by the mark written just before it: a replace mark makes a
 * replacement, a caret an insertion. 'unpaired' until a mark is found or selected.
 */
export type PenEditKind = 'replacement' | 'insertion' | 'unpaired';

/**
 * What a tagged page element is: the badge at the snippet (its shape is the entry's anchor on the
 * page) and its number, the badge at the mark and its number, and the user's own strokes the tag
 * marked: the snippet's handwriting and the replace mark.
 */
export type PenEditRole = 'snippet' | 'snippetnum' | 'markring' | 'marknum' | 'stroke' | 'mark';

const ROLES: readonly PenEditRole[] = ['snippet', 'snippetnum', 'markring', 'marknum', 'stroke', 'mark'];

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

/** True for every page element that carries a pen-edit tag, including the user's tagged strokes. */
export function isPenEditElement(element: {userData?: unknown}): boolean {
  return parsePenEditUserData(element.userData) !== null;
}

/** True for the badges and numbers Textbox Tools placed itself (not the user's strokes). */
export function isPenEditDecoration(element: {userData?: unknown}): boolean {
  const role = parsePenEditUserData(element.userData)?.role;
  return role === 'snippet' || role === 'snippetnum' || role === 'markring' || role === 'marknum';
}

// ---------------------------------------------------------------------------
// Badges: a number inside a circle (replacement, at the snippet and at the mark) or a diamond
// (insertion)

/** Font size of the numbers: readable next to body text, but clearly a mark. */
export const PEN_EDIT_NUMBER_FONT_SIZE = 28;
/** A one- or two-digit textbox at or below this size counts as a pen-edit number. */
export const PEN_EDIT_NUMBER_MAX_FONT_SIZE = 30;
export const BADGE_SIZE_PX = 48;
const BADGE_INSET_PX = 4;

/** Rough width of one digit at the number font size, to centre the number in its badge. */
const DIGIT_WIDTH_PX = 16;

/**
 * Second guard next to `userData`: a textbox holding only a one- or two-digit number, or the "?"
 * of text without a mark, in a small font is treated as a pen-edit number even if the host
 * dropped its `userData`.
 */
export function looksLikePenEditNumber(text: string | null | undefined, fontSize: number | null | undefined): boolean {
  return (
    typeof text === 'string' &&
    /^(\d{1,2}|\?)$/.test(text.trim()) &&
    typeof fontSize === 'number' &&
    fontSize > 0 &&
    fontSize <= PEN_EDIT_NUMBER_MAX_FONT_SIZE
  );
}

/** What the number textbox shows: the number, or "?" for text without a mark. */
export function penEditNumberText(number: number | null): string {
  return number === null ? '?' : String(number);
}

/** One more than the highest number in use; 1 on a page without pen edits. */
export function nextPenEditNumber(numbersInUse: number[]): number {
  return numbersInUse.reduce((highest, n) => (Number.isFinite(n) && n > highest ? n : highest), 0) + 1;
}

const SNIPPET_BADGE_GAP_PX = 8;

/**
 * The snippet's badge: right to the left of the snippet, centred on its height. Without room on
 * the left it goes top left inside the lasso rect.
 */
export function snippetBadgeRect(lasso: Rect, size = BADGE_SIZE_PX): Rect {
  const centerY = (lasso.top + lasso.bottom) / 2;
  const right = Math.round(lasso.left - SNIPPET_BADGE_GAP_PX);
  if (right - size >= 0) {
    const top = Math.max(0, Math.round(centerY - size / 2));
    return {left: right - size, top, right, bottom: top + size};
  }
  const width = Math.max(1, lasso.right - lasso.left);
  const height = Math.max(1, lasso.bottom - lasso.top);
  const s = Math.min(size, width, height);
  const left = lasso.left + Math.min(BADGE_INSET_PX, Math.max(0, width - s));
  const top = lasso.top + Math.min(BADGE_INSET_PX, Math.max(0, height - s));
  return {left: Math.round(left), top: Math.round(top), right: Math.round(left + s), bottom: Math.round(top + s)};
}

/**
 * The mark's badge: centred over the two vertical lines (over the strike when there are none),
 * its bottom touching their tops, kept on the page.
 */
export function markBadgeRect(verticals: Rect[], strike: Rect, pageWidth: number, size = BADGE_SIZE_PX): Rect {
  const anchors = verticals.length > 0 ? verticals : [strike];
  const cx = anchors.reduce((sum, rect) => sum + (rect.left + rect.right) / 2, 0) / anchors.length;
  const bottom = Math.min(...anchors.map(rect => rect.top));
  let left = Math.round(cx - size / 2);
  if (pageWidth > 0) {
    left = Math.min(left, pageWidth - size);
  }
  left = Math.max(0, left);
  const top = Math.max(0, Math.round(bottom - size));
  return {left, top, right: left + size, bottom: top + size};
}

/**
 * NOTE draws a textbox's text a little right of and above its rect's corner; measured on the A5 X
 * from the first circled numbers (digit 12 px right of and 2 px above the circle's centre).
 */
const NUMBER_TEXT_OFFSET_X = 12;
const NUMBER_TEXT_OFFSET_Y = 4;
const NUMBER_BOX_HEIGHT = 40;

/** The number textbox centred in a badge or in the loop the user drew. */
export function badgeNumberRect(badge: Rect, number: number | null): Rect {
  const digits = penEditNumberText(number).length;
  const cx = (badge.left + badge.right) / 2;
  const cy = (badge.top + badge.bottom) / 2;
  const left = Math.max(0, Math.round(cx - (digits * DIGIT_WIDTH_PX) / 2 - NUMBER_TEXT_OFFSET_X));
  const top = Math.max(0, Math.round(cy - NUMBER_BOX_HEIGHT / 2 + NUMBER_TEXT_OFFSET_Y));
  return {left, top, right: left + digits * DIGIT_WIDTH_PX + 2 * NUMBER_TEXT_OFFSET_X + 8, bottom: top + NUMBER_BOX_HEIGHT};
}

/** A closed circle (24 points) filling `box`. */
export function circlePolygon(box: Rect): Point[] {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const r = Math.min(box.right - box.left, box.bottom - box.top) / 2;
  const points: Point[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const angle = (i / 24) * 2 * Math.PI;
    points.push({x: Math.round(cx + r * Math.cos(angle)), y: Math.round(cy + r * Math.sin(angle))});
  }
  return points;
}

/**
 * The snippet badge's outline: one circle for every snippet. The mark beside the text (loop or
 * caret) already says what kind it is, and a snippet whose mark is selected later keeps its badge.
 * Diamonds from earlier builds are still found: badges are recognized by `userData`, not shape.
 */
export function snippetBadgePolygon(box: Rect): Point[] {
  return circlePolygon(box);
}

/** Bounds of a polygon's points (a badge's current place on the page). */
export function boundsOfPoints(points: Point[]): Rect | null {
  if (points.length === 0) {
    return null;
  }
  return {
    left: Math.min(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)),
    bottom: Math.max(...points.map(p => p.y)),
  };
}
