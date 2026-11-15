import {
  horizontalOverlapRatio,
  intersectionRect,
  pointInRect,
  rectCenter,
  rectHeight,
  rectWidth,
  sortTextElementsByReadingOrder,
} from '../../src/domain/geometry';

const rect = (left: number, top: number, right: number, bottom: number) => ({left, top, right, bottom});

describe('geometry', () => {
  it('measures and centers a rectangle', () => {
    expect(rectWidth(rect(10, 20, 110, 70))).toBe(100);
    expect(rectHeight(rect(10, 20, 110, 70))).toBe(50);
    expect(rectCenter(rect(10, 20, 110, 70))).toEqual({x: 60, y: 45});
  });

  it('finds the intersection, or null when the rectangles only touch', () => {
    expect(intersectionRect(rect(0, 0, 100, 100), rect(50, 60, 200, 200))).toEqual(rect(50, 60, 100, 100));
    expect(intersectionRect(rect(0, 0, 100, 100), rect(100, 0, 200, 100))).toBeNull();
  });

  it('relates the horizontal overlap to the narrower rectangle', () => {
    expect(horizontalOverlapRatio(rect(0, 0, 100, 10), rect(50, 0, 75, 10))).toBe(1);
    expect(horizontalOverlapRatio(rect(0, 0, 100, 10), rect(80, 0, 180, 10))).toBe(0.2);
  });

  it('counts points on the border as inside', () => {
    expect(pointInRect({x: 100, y: 50}, rect(0, 0, 100, 100))).toBe(true);
    expect(pointInRect({x: 101, y: 50}, rect(0, 0, 100, 100))).toBe(false);
  });

  it('sorts textboxes top to bottom, then left to right, ignoring 1 px differences', () => {
    const box = (name: string, left: number, top: number) => ({name, textBox: {textRect: rect(left, top, left + 50, top + 20)}});
    const sorted = sortTextElementsByReadingOrder([box('c', 0, 200), box('b', 300, 101), box('a', 10, 100)]);
    expect(sorted.map(item => item.name)).toEqual(['a', 'b', 'c']);
  });
});
