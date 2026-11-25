import type {PenEditMark} from '../penEditModel';
import type {Rect} from '../textboxModel';
import {unionRect, type MarkStroke} from './markStroke';
import {caretReading, loopReading, slashReading, strikeReading, verticalsReading} from './pass1';
import {rectsWithRole, type Reading} from './reading';
import {analyzeSlash, type SlashShape} from './shapes/slash';

/**
 * A reading as the pen-edit index stores it (technical-design-mark-dialogue.md §2.2): the stored
 * `PenEditMark` stays the format, so no index migration. Only marks that take text are stored: a
 * strike (chosen with Select mark), a strike with a loop, a slash, a caret; null for the others.
 */
export function storedMarkOf(reading: Reading): PenEditMark | null {
  const marks = rectsWithRole(reading, 'mark');
  const number = rectsWithRole(reading, 'number')[0];
  switch (reading.kind) {
    case 'strike':
    case 'replaceLoop':
      return {
        kind: 'replace',
        strikeRect: {...marks[0]},
        modifierRects: rectsWithRole(reading, 'modifier').map(rect => ({...rect})),
      };
    case 'slash':
      return {
        kind: 'replace',
        strikeRect: {...marks[0]},
        modifierRects: [],
        bounds: 'exact',
        slash: true,
        ...(number ? {numberRect: {...number}} : {}),
      };
    case 'caret':
    case 'sideways':
    case 'step': {
      const shape = reading.shape.kind === 'caret' ? reading.shape.caret : null;
      if (!shape) {
        return null;
      }
      return {
        kind: 'caret',
        caretRect: marks.reduce<Rect>((all, rect) => unionRect(all, rect), {...marks[0]}),
        tip: {...shape.tip},
        direction: shape.direction,
      };
    }
    default:
      return null;
  }
}

/** How far apart two rects are: their corners' distance, the size difference counted too. */
function rectDistance(a: Rect, b: Rect): number {
  return Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.right - b.right) + Math.abs(a.bottom - b.bottom);
}

/** The stroke whose rect is nearest `rect` (moved by `shift`), taken out of `left`. */
function takeNearest(left: MarkStroke[], rect: Rect, shift: {dx: number; dy: number}): MarkStroke | null {
  const moved = {left: rect.left + shift.dx, top: rect.top + shift.dy, right: rect.right + shift.dx, bottom: rect.bottom + shift.dy};
  const best = [...left].sort((a, b) => rectDistance(a.rect, moved) - rectDistance(b.rect, moved))[0];
  if (!best) {
    return null;
  }
  left.splice(left.indexOf(best), 1);
  return best;
}

/** A slash's shape from its rect alone, drawn as / (no points read): for an older or moved slash. */
function slashOfRect(rect: Rect): SlashShape {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return {
    rect: {...rect},
    top: {x: rect.right, y: rect.top},
    bottom: {x: rect.left, y: rect.bottom},
    angleDeg: (Math.atan2(height, width) * 180) / Math.PI,
    length: Math.hypot(width, height),
  };
}

/**
 * The reading of a linked mark (technical-design-mark-dialogue.md §2.2, §5.1 step 4): its stored
 * mark, the reverse of `storedMarkOf`, on the strokes it has on the page now (they may have
 * moved: each stored rect is matched to the nearest stroke, moved like the strike). A strike with
 * two verticals stored by an earlier build stays a replacement of exactly what is between them
 * (§13.1 Q2). Null when none of its strokes is on the page any more.
 */
export function readingOfStoredMark(mark: PenEditMark, strokes: MarkStroke[]): Reading | null {
  if (strokes.length === 0) {
    return null;
  }
  const left = [...strokes];
  if (mark.kind === 'caret') {
    const rect = strokes.map(stroke => stroke.rect).reduce((all, item) => unionRect(all, item));
    const dx = rect.left - mark.caretRect.left;
    const dy = rect.top - mark.caretRect.top;
    const tip = {x: mark.tip.x + dx, y: mark.tip.y + dy};
    return caretReading(strokes, {
      tip,
      direction: mark.direction,
      rect,
      ends: [
        {x: rect.left, y: mark.direction === 'down' ? rect.top : rect.bottom},
        {x: rect.right, y: mark.direction === 'down' ? rect.top : rect.bottom},
      ],
    });
  }
  const strike = takeNearest(left, mark.strikeRect, {dx: 0, dy: 0}) as MarkStroke;
  const shift = {dx: strike.rect.left - mark.strikeRect.left, dy: strike.rect.top - mark.strikeRect.top};
  const modifiers = mark.modifierRects.map(rect => takeNearest(left, rect, shift)).filter((stroke): stroke is MarkStroke => !!stroke);
  const circle = mark.numberRect ? takeNearest(left, mark.numberRect, shift) : null;
  if (mark.slash) {
    const shape = (strike.points ? analyzeSlash(strike.points) : null) ?? slashOfRect(strike.rect);
    return slashReading(strike, shape, circle);
  }
  if (modifiers.length === 2) {
    return verticalsReading(strike, modifiers);
  }
  if (modifiers.length === 1) {
    return loopReading(strike, modifiers[0]);
  }
  return strikeReading(strike);
}
