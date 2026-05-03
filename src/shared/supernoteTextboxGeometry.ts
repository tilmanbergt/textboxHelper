import type {Rect} from 'sn-plugin-lib';

/**
 * Shared geometry helpers for Supernote textbox-aware plugins.
 *
 * These utilities deliberately stay close to the NOTE plugin data model:
 * page-space rectangles, textbox frame rectangles, and reading-order sorting.
 * They are intended to be copied or reused across sibling Supernote plugins.
 */

export type TextboxRectCarrier = {
  textBox: {
    textRect: Rect;
  };
};

export function cloneRect(rect: Rect): Rect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function rectWidth(rect: Rect): number {
  return Math.max(0, rect.right - rect.left);
}

export function rectHeight(rect: Rect): number {
  return Math.max(0, rect.bottom - rect.top);
}

export function rectCenter(rect: Rect): {x: number; y: number} {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

export function rectOverlapWidth(left: Rect, right: Rect): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
}

export function rectOverlapHeight(left: Rect, right: Rect): number {
  return Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

export function horizontalOverlapRatio(left: Rect, right: Rect): number {
  const overlap = rectOverlapWidth(left, right);
  const minimumWidth = Math.max(1, Math.min(rectWidth(left), rectWidth(right)));
  return overlap / minimumWidth;
}

export function pointInRect(point: {x: number; y: number}, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

export function intersectionRect(left: Rect, right: Rect): Rect | null {
  const rect: Rect = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };

  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    return null;
  }

  return rect;
}

/**
 * Sort textbox-like elements in visual reading order: top-to-bottom, then left-to-right.
 */
export function sortTextElementsByReadingOrder<T extends TextboxRectCarrier>(elements: T[]): T[] {
  return [...elements].sort((left, right) => {
    const topDiff = left.textBox.textRect.top - right.textBox.textRect.top;
    if (Math.abs(topDiff) > 1) {
      return topDiff;
    }

    const leftDiff = left.textBox.textRect.left - right.textBox.textRect.left;
    if (Math.abs(leftDiff) > 1) {
      return leftDiff;
    }

    return left.textBox.textRect.bottom - right.textBox.textRect.bottom;
  });
}

