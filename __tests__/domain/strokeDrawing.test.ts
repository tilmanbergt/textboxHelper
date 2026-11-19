import {MAX_SEGMENTS, strokeSegments} from '../../src/domain/strokeDrawing';

describe('strokeSegments', () => {
  it('fits a stroke into the box keeping its aspect, centred', () => {
    // A horizontal line 100 px long, drawn into a 220 x 120 box with 10 px padding.
    const segments = strokeSegments([[1000, 500, 1050, 500, 1100, 500]], {width: 220, height: 120}, 10);
    expect(segments).toHaveLength(2);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(total).toBeCloseTo(200);
    expect(segments[0].left).toBeCloseTo(10);
    expect(segments[0].top).toBeCloseTo(60);
    expect(segments[0].angle).toBeCloseTo(0);
  });

  it('draws a vertical stroke with a quarter turn', () => {
    const segments = strokeSegments([[0, 0, 0, 100]], {width: 100, height: 100}, 0);
    expect(segments).toHaveLength(1);
    expect(segments[0].angle).toBeCloseTo(Math.PI / 2);
  });

  it('merges points closer than a few pixels but keeps the stroke end', () => {
    const points: number[] = [];
    for (let x = 0; x <= 100; x += 0.5) {
      points.push(x, 0);
    }
    const segments = strokeSegments([points], {width: 100, height: 40}, 0);
    expect(segments.length).toBeLessThan(40);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(total).toBeCloseTo(100);
  });

  it('keeps long handwriting under the segment cap', () => {
    const points: number[] = [];
    for (let i = 0; i < 20000; i += 1) {
      points.push(i % 2000, Math.floor(i / 2000) * 30 + (i % 7));
    }
    const segments = strokeSegments([points], {width: 400, height: 200});
    expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS * 1.2);
  });

  it('returns nothing for empty strokes', () => {
    expect(strokeSegments([[], [5]], {width: 100, height: 100})).toEqual([]);
  });
});
