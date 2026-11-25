import {DUPLICATE_STRIKE, resolvePage, type PageMark, type PageResult} from '../../src/domain/marks/pass2';
import type {TextboxView} from '../../src/domain/marks/textboxView';
import {arc, at, caret, circle, cross, loop, page, slash, strike, swap, textbox, verticals, view, type Drawn} from './build';

/**
 * Passes 1 and 2 together on a page (technical-design-mark-dialogue.md §2.6, §13.1 Q3): which
 * reading wins when strokes could be more than one mark, and what happens to the strokes of a
 * reading that doesn't place - they stay free for the later families, in the review's order.
 * One table per need. A case draws strokes (`s1`, `s2`, … in writing order) over textboxes and
 * expects the marks (kind, strokes, place) and the ignored rows (stroke, reason, removable). A
 * stroke a mark took along (a vertical, a loop) still has its own row from the strike family; the
 * review's assembly drops the rows of strokes a change consumed.
 */

// "the big red car and more words here": character i starts at x 115 + 18·i; line 200–248.
const A = textbox('the big red car and more words here', {left: 100, top: 200, width: 1000});
const x = (offset: number) => at(A, offset).x;
const MID = at(A, 0).mid;
const vertical = (cx: number): Drawn => [[{x: cx, y: MID - 20}, {x: cx + 1, y: MID + 20}]];

/** A mark as the table writes it: its kind, its strokes' numbers, and [start, end) in the text. */
function summary(mark: PageMark): string {
  switch (mark.kind) {
    case 'line':
      return `${mark.owner ? 'replace' : 'delete'} ${mark.consumed.join('+')} [${mark.span.start}, ${mark.span.end})`;
    case 'slash':
      return `slash ${mark.strokes.map(ref => ref.numInPage).join('+')} [${mark.offset}, ${mark.offset + 1})`;
    case 'join':
      return `join ${mark.strokes.map(ref => ref.numInPage).join('+')}`;
    case 'closeUp':
      return `closeUp ${mark.strokes.map(ref => ref.numInPage).join('+')} [${mark.start}, ${mark.end})`;
    case 'swap':
      return `swap ${mark.strokes.map(ref => ref.numInPage).join('+')} [${mark.zones.a0}, ${mark.zones.b1})`;
    default:
      return `${mark.kind} ${mark.strokes.map(ref => ref.numInPage).join('+')} @${mark.offset}`;
  }
}

const refusals = (result: PageResult) =>
  result.refused.map(item => `${item.first.numInPage}: ${item.reason.split(/[.:(]/)[0]}${item.removable ? ` (remove ${item.removable.join('+')})` : ''}`);

type Case = {
  name: string;
  strokes: Drawn[];
  boxes?: TextboxView[];
  marks: string[];
  refused: string[];
};

const TABLES: Record<string, Case[]> = {
  point: [
    {
      name: 'a ∧ and a cross away from every textbox are handwriting: read as strokes',
      strokes: [caret('up', {x: 300, y: 900}), cross(300, 950)],
      marks: [],
      refused: [
        '1: The marker does not land clearly inside exactly one main-layer textbox',
        '2: The marker does not land clearly inside exactly one main-layer textbox',
        '3: The marker does not land clearly inside exactly one main-layer textbox',
      ],
    },
    {
      name: "a ∧ with an empty circle is a caret's number place: no mark without text",
      strokes: [caret('up', {x: x(7) + 9, y: 246}, 44), circle(x(7) + 9, 274, 9)],
      marks: [],
      refused: [
        '1: The marker does not land clearly inside exactly one main-layer textbox',
        '2: The marker does not land clearly inside exactly one main-layer textbox',
      ],
    },
    {
      name: 'a space mark on a space is refused and keeps its strokes',
      strokes: [caret('up', {x: x(7) + 9, y: 246}), cross(x(7) + 9, 300)],
      marks: [],
      refused: ['1: There is already a space here (remove 1+2+3)'],
    },
  ],
  part: [
    {
      name: 'verticals inside the strike, away from its ends, mark nothing: the strike takes whole words (§13.4)',
      strokes: [strike(x(4), x(15), MID), [[{x: x(8) + 1, y: MID - 20}, {x: x(8) + 2, y: MID + 20}]], [[{x: x(10), y: MID - 20}, {x: x(10) + 1, y: MID + 20}]], [[{x: x(11) - 1, y: MID - 20}, {x: x(11), y: MID + 20}]]],
      marks: ['delete 1 [4, 15)'],
      refused: [
        '2: The marker is too short to classify reliably (remove 2)',
        '3: The marker is too short to classify reliably (remove 3)',
        '4: The marker is too short to classify reliably (remove 4)',
      ],
    },
    {
      name: 'a line at each end of a strike over less than half a word: exactly that part ("wo|rds|")',
      strokes: [vertical(x(28)), strike(x(28) + 1, x(30) - 1, MID), vertical(x(30))],
      marks: ['delete 2+1+3 [28, 30)'],
      refused: [
        '1: The marker is too short to classify reliably (remove 1)',
        '3: The marker is too short to classify reliably (remove 3)',
      ],
    },
    {
      name: 'lines at the ends far apart (seven letters, over two words): exactly between them',
      strokes: [strike(x(26) - 3, x(33) + 3, MID), verticals(x(26) + 1, x(33) - 1, MID)],
      marks: ['delete 1+2+3 [26, 33)'],
      refused: [
        '2: The marker is too short to classify reliably (remove 2)',
        '3: The marker is too short to classify reliably (remove 3)',
      ],
    },
    {
      name: 'one letter: a short strike between two lines',
      strokes: [strike(x(9) + 2, x(10) - 2, MID), verticals(x(9) + 1, x(10) - 1, MID)],
      marks: ['delete 1+2+3 [9, 10)'],
      refused: [
        '2: The marker is too short to classify reliably (remove 2)',
        '3: The marker is too short to classify reliably (remove 3)',
      ],
    },
    {
      name: 'lines at the ends and a circle without tagged text: a replace mark without new text',
      strokes: [strike(x(4) - 3, x(7) + 3, MID), verticals(x(4) + 1, x(7) - 1, MID), loop(x(7) + 24, MID)],
      marks: [],
      refused: [
        '2: The marker is too short to classify reliably (remove 2)',
        '3: The marker is too short to classify reliably (remove 3)',
        '4: The marker is too short to classify reliably (remove 4)',
        '1: Replace mark without new text (remove 1+2+3+4)',
      ],
    },
    {
      name: 'one vertical is no pair: the strike takes whole words',
      strokes: [strike(x(4), x(15), MID), [[{x: x(8) + 1, y: MID - 20}, {x: x(8) + 2, y: MID + 20}]]],
      marks: ['delete 1 [4, 15)'],
      refused: ['2: The marker is too short to classify reliably (remove 2)'],
    },
    {
      name: "verticals reaching far off the strike's line are no pair",
      strokes: [strike(x(4), x(15), MID), [[{x: x(8) + 1, y: MID - 90}, {x: x(8) + 2, y: MID + 20}]], [[{x: x(11) - 1, y: MID - 90}, {x: x(11), y: MID + 20}]]],
      marks: ['delete 1 [4, 15)'],
      refused: [
        '2: The marker does not land clearly inside exactly one main-layer textbox',
        '3: The marker does not land clearly inside exactly one main-layer textbox',
      ],
    },
    {
      name: 'two strikes near one loop: the first in text order takes it',
      strokes: [strike(x(8) + 2, x(11) - 2, MID), strike(x(12) + 2, x(15) - 2, MID), loop(x(12), MID - 34)],
      marks: ['delete 2 [12, 15)'],
      refused: ['3: The marker does not land clearly inside exactly one main-layer textbox', '1: Replace mark without new text (remove 1+3)'],
    },
    {
      name: 'a second strike over the same word takes nothing',
      strokes: [strike(x(4) + 3, x(7) - 3, MID), strike(x(4) + 5, x(7) - 1, MID + 3)],
      marks: ['delete 1 [4, 7)'],
      refused: [`2: ${DUPLICATE_STRIKE.split('.')[0]} (remove 2)`],
    },
    {
      name: 'an arc through the letters is no close-up: it falls through to a strike',
      strokes: [arc(x(4) + 3, x(7) - 3, MID - 4, 'down')],
      marks: ['delete 1 [4, 7)'],
      refused: [],
    },
    {
      name: 'a slash away from the text stays free: handwriting, never offered for removal',
      strokes: [slash(300, 600, 60, 40)],
      marks: [],
      refused: ['1: The marker does not land clearly inside exactly one main-layer textbox'],
    },
    {
      name: 'a short slash at 35° through a letter (flat: long, not tall)',
      strokes: [slash(x(8) + 9, MID, 35, 40)],
      marks: ['slash 1 [8, 9)'],
      refused: [],
    },
    {
      name: 'a long slash at 45° reaching above and below the letters is no swap piece',
      strokes: [slash(x(8) + 9, MID, 45, 60)],
      marks: ['slash 1 [8, 9)'],
      refused: [],
    },
    {
      name: 'a long slash just steeper than 30°',
      strokes: [slash(x(8) + 9, MID, 32, 60)],
      marks: ['slash 1 [8, 9)'],
      refused: [],
    },
    {
      name: 'a slash through a letter wins over the strike family',
      strokes: [slash(x(4) + 9, MID, 60, 40), strike(x(20) + 3, x(30) - 3, MID)],
      marks: ['delete 2 [20, 30)', 'slash 1 [4, 5)'],
      refused: [],
    },
  ],
  twoParts: [
    {
      name: 'a one-line swap mark',
      strokes: [swap([x(4) - 3, x(7) + 2], [x(8) - 2, x(11) + 3], at(A, 4))],
      marks: ['swap 1 [4, 11)'],
      refused: [],
    },
  ],
};

describe.each(Object.entries(TABLES))('passes 1 and 2 on a page: %s', (_need, cases) => {
  it.each(cases.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const result = resolvePage(page(...item.strokes), item.boxes ?? [view(A)]);
    expect(result.marks.map(summary)).toEqual(item.marks);
    expect(refusals(result)).toEqual(item.refused);
    expect(result.wanted).toEqual([]);
  });
});

describe('measuring only what a mark needs', () => {
  it('asks for the textbox a mark lands on, and places it once that is measured', () => {
    const strokes = page(strike(x(4) + 3, x(7) - 3, MID));
    const first = resolvePage(strokes, [view(A, {measured: false})]);
    expect(first.wanted).toEqual(['tb1']);
    const second = resolvePage(strokes, [view(A)]);
    expect(second.wanted).toEqual([]);
    expect(second.marks.map(summary)).toEqual(['delete 1 [4, 7)']);
  });

  it('asks for nothing when no mark is near a textbox', () => {
    expect(resolvePage(page(strike(200, 420, 900)), [view(A, {measured: false})]).wanted).toEqual([]);
  });

  it('notes the textbox whose font kept a strike from being placed', () => {
    const result = resolvePage(page(strike(x(4) + 3, x(7) - 3, MID)), [view(A, {locked: true})]);
    expect(result.lockedViews).toEqual(['tb1']);
  });
});
