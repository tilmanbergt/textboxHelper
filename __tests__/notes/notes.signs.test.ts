import {
  BADGE_SIZE_PX,
  boundsOfPoints,
  bubbleBody,
  bubblePolygon,
  circlePolygon,
  framePolygon,
  looksLikePenEditNumber,
  snippetBadgeRect,
  snippetSign,
  type PenEditKind,
} from '../../src/domain/penEditTags';
import type {Point, Rect} from '../../src/domain/textboxModel';

/**
 * Are the signs the right shapes and places (technical-design-comments-images.md §3.2)? A comment
 * gets a speech bubble with "C", an image a plain double frame; both sit where the ring of a
 * tagged text sits, at its size, and neither looks like the ring (circles mean a text's number).
 */

const lasso: Rect = {left: 600, top: 300, right: 900, bottom: 380};
const box = snippetBadgeRect(lasso);
const inside = (points: Point[], rect: Rect) =>
  points.every(p => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom);
/** A ring keeps every point at one distance from the middle; a sign with corners doesn't. */
const roundness = (points: Point[]) => {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const d = points.map(p => Math.hypot(p.x - cx, p.y - cy));
  return Math.max(...d) - Math.min(...d);
};
const touchesCorner = (points: Point[], x: number, y: number) => points.some(p => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);

type Case = {name: string; kind: PenEditKind; number: number | null; text: string | null; corners: Array<[number, number]>};

const CASES: Case[] = [
  {name: 'linked text: ring with its number', kind: 'replacement', number: 4, text: '4', corners: []},
  {name: 'text without a mark: ring with "?"', kind: 'unpaired', number: null, text: '?', corners: []},
  {name: 'comment: bubble with "C", its tail at the lower left', kind: 'comment', number: null, text: 'C', corners: [[box.left, box.bottom]]},
  {
    name: 'image: a plain double frame, no text, every corner of the box',
    kind: 'image',
    number: null,
    text: null,
    corners: [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]],
  },
];

describe('notes.signs: the sign at tagged handwriting', () => {
  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const sign = snippetSign(item.kind, box, item.number);
    expect(sign.text).toBe(item.text);
    expect(inside(sign.points, box)).toBe(true);
    item.corners.forEach(([x, y]) => expect(touchesCorner(sign.points, x, y)).toBe(true));
    if (sign.textRect) {
      expect(sign.textRect.top).toBeGreaterThanOrEqual(box.top - 8);
    }
  });

  it('sits where the ring sits, at the badge size', () => {
    expect(boundsOfPoints(bubblePolygon(box))).toEqual(box);
    expect(boundsOfPoints(framePolygon(box))).toEqual(box);
    expect(box.right - box.left).toBe(BADGE_SIZE_PX);
  });

  it('neither sign is round like the ring', () => {
    expect(roundness(circlePolygon(box))).toBeLessThanOrEqual(2);
    expect(roundness(bubblePolygon(box))).toBeGreaterThan(8);
    expect(roundness(framePolygon(box))).toBeGreaterThan(8);
  });

  it('the image frame is double: an inner square inside the outer one', () => {
    const points = framePolygon(box);
    const inner = points.filter(p => p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom);
    expect(inner.length).toBeGreaterThanOrEqual(4);
  });

  it('the "C" stands in the bubble\'s body, above its tail', () => {
    const sign = snippetSign('comment', box, null);
    const body = bubbleBody(box);
    const middle = sign.textRect ? (sign.textRect.top + sign.textRect.bottom) / 2 : 0;
    expect(middle).toBeLessThan(body.bottom);
  });

  it('a lone "C" textbox in a small font counts as a sign, a word does not', () => {
    expect(looksLikePenEditNumber('C', 28)).toBe(true);
    expect(looksLikePenEditNumber('Cat', 28)).toBe(false);
    expect(looksLikePenEditNumber('C', 36)).toBe(false);
  });
});
