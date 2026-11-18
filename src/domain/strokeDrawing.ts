/**
 * Drawing stored handwriting in a box (technical-design-pen-edits.md As built): the strokes'
 * points (page pixels, flat x,y lists) are fitted into the box keeping their aspect, thinned to
 * a few pixels per segment, and turned into straight segments the UI draws as thin rotated
 * views. Pure, so it is tested without a device.
 */

export type DrawBox = {width: number; height: number};

/** One straight piece of a stroke, placed for a view rotated about its centre. */
export type DrawSegment = {left: number; top: number; length: number; angle: number};

/** Points closer than this on screen are merged; keeps the view count low on e-ink. */
export const MIN_SEGMENT_PX = 3;
/** Above this many segments the step grows, so a long snippet still draws quickly. */
export const MAX_SEGMENTS = 900;

export function strokeSegments(strokes: number[][], box: DrawBox, padding = 8): DrawSegment[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let pointCount = 0;
  for (const points of strokes) {
    for (let i = 0; i + 1 < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
      pointCount += 1;
    }
  }
  if (pointCount === 0) {
    return [];
  }
  const innerWidth = Math.max(1, box.width - 2 * padding);
  const innerHeight = Math.max(1, box.height - 2 * padding);
  const scale = Math.min(innerWidth / Math.max(1, maxX - minX), innerHeight / Math.max(1, maxY - minY));
  const offsetX = padding + (innerWidth - (maxX - minX) * scale) / 2;
  const offsetY = padding + (innerHeight - (maxY - minY) * scale) / 2;
  const step = Math.max(MIN_SEGMENT_PX, pointCount > MAX_SEGMENTS ? MIN_SEGMENT_PX * (pointCount / MAX_SEGMENTS) : 0);

  const segments: DrawSegment[] = [];
  for (const points of strokes) {
    let lastX: number | null = null;
    let lastY = 0;
    for (let i = 0; i + 1 < points.length; i += 2) {
      const x = offsetX + (points[i] - minX) * scale;
      const y = offsetY + (points[i + 1] - minY) * scale;
      if (lastX === null) {
        lastX = x;
        lastY = y;
        continue;
      }
      const isLast = i + 3 >= points.length;
      const length = Math.hypot(x - lastX, y - lastY);
      if (length < step && !isLast) {
        continue;
      }
      segments.push({
        left: (lastX + x) / 2 - length / 2,
        top: (lastY + y) / 2,
        length: Math.max(1, length),
        angle: Math.atan2(y - lastY, x - lastX),
      });
      lastX = x;
      lastY = y;
    }
  }
  return segments;
}
