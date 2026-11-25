import type {PenEditMark} from '../penEditModel';
import type {Rect} from '../textboxModel';
import {unionRect} from './markStroke';
import {rectsWithRole, type Reading} from './reading';

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
