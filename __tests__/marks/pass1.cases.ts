import type {MarkKind} from '../../src/domain/marks/reading';
import {BARE_STEP_REASON} from '../../src/domain/paragraphMarks';
import {
  arc,
  caret,
  caretInTwo,
  circle,
  cross,
  hand,
  loop,
  sideways,
  slash,
  step,
  strike,
  swap,
  verticals,
  type Drawn,
} from './build';

/**
 * The cases of pass 1 (technical-design-mark-dialogue.md §3), one table per mark family: a case
 * draws its strokes in writing order (`s1`, `s2`, … in the order of the builders' strokes) and
 * says which groups the review's `readMarks` finds: per group its readings' kinds (ranked), the
 * strokes of the first reading, and its anchors (to the pixel). `none`: no group at all -
 * handwriting, or a shape pass 1 doesn't read. Used by `pass1.read.test.ts` and, for the marks
 * that take text, by `pass1.sameJudge.test.ts`.
 */

export type Expected = {kinds: MarkKind[]; strokes: string[]; anchors?: Array<[number, number]>; direction?: string; char?: string | null};
export type Case = {name: string; strokes: Drawn[]; expect: Expected[] | 'none'; reason?: string};

// A line of text from y 200 to 248, its letters' middle at 228.
export const Y = 228;

export const TABLES: Record<string, Case[]> = {
  strike: [
    {name: 'a strike over a word', strokes: [strike(187, 241, Y)], expect: [{kinds: ['strike'], strokes: ['s1'], anchors: [[187, Y + 1], [241, Y + 1]]}]},
    {name: 'a long strike over words', strokes: [strike(115, 600, Y)], expect: [{kinds: ['strike'], strokes: ['s1']}]},
    {name: 'a 25° stroke is a strike, not a slash', strokes: [slash(200, Y, 25, 40)], expect: [{kinds: ['strike'], strokes: ['s1']}]},
    {name: 'too short', strokes: [strike(187, 207, Y)], expect: 'none'},
  ],
  replace: [
    {
      name: 'two verticals across a strike: exact bounds',
      strokes: [strike(180, 250, Y), verticals(190, 240, Y)],
      expect: [{kinds: ['strikeVerticals'], strokes: ['s1', 's2', 's3'], anchors: [[190.5, Y + 1], [240.5, Y + 1]]}],
    },
    {
      name: 'verticals at the ends of a long strike, far apart: exact bounds (§13.4)',
      strokes: [strike(180, 400, Y), verticals(186, 392, Y)],
      expect: [{kinds: ['strikeVerticals'], strokes: ['s1', 's2', 's3'], anchors: [[186.5, Y + 1], [392.5, Y + 1]]}],
    },
    {
      name: 'verticals inside a strike, away from its ends, are no pair: the strike alone',
      strokes: [strike(180, 400, Y), verticals(260, 320, Y)],
      expect: [{kinds: ['strike'], strokes: ['s1']}],
    },
    {
      name: 'a short strike between two verticals: one letter',
      strokes: [strike(196, 212, Y), verticals(195, 213, Y)],
      expect: [{kinds: ['strikeVerticals'], strokes: ['s1', 's2', 's3']}],
    },
    {
      name: 'a loop after the strike: a replace mark',
      strokes: [strike(180, 250, Y), loop(270, Y)],
      expect: [{kinds: ['replaceLoop'], strokes: ['s1', 's2'], anchors: [[180, Y + 1], [250, Y + 1]]}],
    },
    {
      name: 'a loop above the line along the strike',
      strokes: [strike(180, 250, Y), loop(215, Y - 40)],
      expect: [{kinds: ['replaceLoop'], strokes: ['s1', 's2']}],
    },
    {
      name: 'verticals and a loop: an exact replace mark, the loop holds the number',
      strokes: [strike(180, 250, Y), verticals(190, 240, Y), loop(270, Y)],
      expect: [{kinds: ['replaceVerticals'], strokes: ['s1', 's2', 's3', 's4'], anchors: [[190.5, Y + 1], [240.5, Y + 1]]}],
    },
  ],
  slash: [
    {name: '60° through a letter', strokes: [slash(196, Y, 60, 40)], expect: [{kinds: ['slash'], strokes: ['s1'], anchors: [[196, Y]]}]},
    {name: '45°', strokes: [slash(196, Y, 45, 40)], expect: [{kinds: ['slash'], strokes: ['s1']}]},
    {name: '35°: from 30° on a slash', strokes: [slash(196, Y, 35, 46)], expect: [{kinds: ['slash'], strokes: ['s1']}]},
    {name: 'too long (and taller than a step)', strokes: [slash(196, Y, 80, 200)], expect: 'none'},
    {
      name: 'with its own circle for the number at its top',
      strokes: [slash(196, Y, 65, 40), circle(208, Y - 40, 12)],
      expect: [{kinds: ['slash'], strokes: ['s1', 's2']}],
    },
    {
      name: 'a vertical across a strike is no slash',
      strokes: [strike(180, 300, Y), slash(240, Y, 85, 40)],
      expect: [{kinds: ['strike'], strokes: ['s1']}],
    },
  ],
  caret: [
    {name: 'a ∧', strokes: [caret('up', {x: 250, y: 246})], expect: [{kinds: ['caret'], strokes: ['s1'], anchors: [[250, 246]], direction: 'up'}]},
    {name: 'a V', strokes: [caret('down', {x: 250, y: 206})], expect: [{kinds: ['caret'], strokes: ['s1'], anchors: [[250, 206]], direction: 'down'}]},
    {name: 'a ∧ in two strokes', strokes: [caretInTwo('up', {x: 250, y: 246})], expect: [{kinds: ['caret'], strokes: ['s1', 's2'], direction: 'up'}]},
    {
      name: 'with an empty circle for its number',
      strokes: [caret('up', {x: 250, y: 246}, 44), circle(250, 274, 9)],
      expect: [{kinds: ['caret'], strokes: ['s1', 's2']}],
    },
  ],
  sideways: [
    {name: 'a < beside the text', strokes: [sideways('left', {x: 1106, y: 248})], expect: [{kinds: ['sideways'], strokes: ['s1'], anchors: [[1106, 248]], direction: 'left'}]},
    {name: 'a >', strokes: [sideways('right', {x: 94, y: 198})], expect: [{kinds: ['sideways'], strokes: ['s1'], direction: 'right'}]},
  ],
  step: [
    {name: 'a step with its second upright (_||‾)', strokes: [step(300, Y, {second: true})], expect: [{kinds: ['step'], strokes: ['s1', 's2'], anchors: [[300, Y]], direction: 'step'}]},
    {name: 'a step alone', strokes: [step(300, Y)], expect: [{kinds: [], strokes: ['s1']}], reason: BARE_STEP_REASON},
  ],
  space: [
    {
      name: 'a ∧ with a + near its tip',
      strokes: [caret('up', {x: 250, y: 246}), cross(250, 300)],
      expect: [{kinds: ['space'], strokes: ['s1', 's2', 's3'], anchors: [[250, 246]]}],
    },
    {
      name: 'a V with a + above it',
      strokes: [caret('down', {x: 250, y: 206}), cross(250, 160)],
      expect: [{kinds: ['space'], strokes: ['s1', 's2', 's3']}],
    },
  ],
  punct: [
    {
      name: 'a ∧ with a comma in its circle',
      strokes: [caret('up', {x: 250, y: 246}, 44), circle(250, 274, 9, ',')],
      expect: [{kinds: ['punct'], strokes: ['s1', 's2', 's3'], anchors: [[250, 246]], char: ','}],
    },
    {
      name: 'a ∧ with a dot',
      strokes: [caret('up', {x: 250, y: 246}, 44), circle(250, 274, 9, '.')],
      expect: [{kinds: ['punct'], strokes: ['s1', 's2', 's3'], char: '.'}],
    },
    {
      name: 'a ∧ with a colon',
      strokes: [caret('up', {x: 250, y: 246}, 44), circle(250, 274, 9, ':')],
      expect: [{kinds: ['punct'], strokes: ['s1', 's2', 's3', 's4'], char: ':'}],
    },
  ],
  closeUp: [
    {
      name: 'an arc under a gap (also flat enough for a strike)',
      strokes: [arc(220, 290, 246, 'down')],
      expect: [{kinds: ['closeUp', 'strike'], strokes: ['s1'], anchors: [[220, 246], [290, 246]]}],
    },
    {name: 'an arc over a gap', strokes: [arc(220, 290, 210, 'up')], expect: [{kinds: ['closeUp', 'strike'], strokes: ['s1']}]},
  ],
  swap: [
    {
      name: 'a one-line swap mark is read against the line in pass 2; alone it is flat like a strike',
      strokes: [swap([184, 243], [257, 316], {xTop: 219, base: 238})],
      expect: [{kinds: ['strike'], strokes: ['s1']}],
    },
  ],
  handwriting: [
    {name: 'a word', strokes: [hand('word', 200, 600)], expect: 'none'},
    {name: 'a dot', strokes: [[[{x: 300, y: 300}, {x: 302, y: 301}]]], expect: 'none'},
  ],
  'several marks': [
    {
      name: 'a strike, a slash and a caret side by side, each its own',
      strokes: [strike(115, 160, Y), slash(196, Y, 60, 40), caret('up', {x: 260, y: 246})],
      expect: [
        {kinds: ['caret'], strokes: ['s3']},
        {kinds: ['slash'], strokes: ['s2']},
        {kinds: ['strike'], strokes: ['s1']},
      ],
    },
  ],
};
