// The help pictures of the edit marks: one entry per picture, drawn by scripts/marks.mjs into
// docs/user/images/marks/<id>.png and <id>-icon.png. Edit a sample text or a mark here and run
// `npm run marks`. The words shown next to each picture are in src/domain/markHelp.ts (same id).
//
// before: the textbox lines as they are on the page ('' between lines = two textboxes).
// marks:  what the pen adds, in order. Positions name words by index on their line (0 = first):
//   strike    {line, from, to}                    a line through words from..to
//   loop      {number}                            the replace loop after the last strike
//   verticals {line, from, to}                    the two short lines that also make a replace
//   caret     {dir: 'up'|'down', at, number?, cross?, size?}  ∧ or V; at = {line, gap} (before
//                                                 word gap) or {line, word, char} (inside a word)
//   sideways  {dir: 'left'|'right', after, number?}  < or > beside the text, tip below line `after`
//   step      {line, gap, second?}                the step mark _|‾ before word `gap`; second: the
//                                                 short line beside its upright (_||‾)
//   swap      {line, a: [from, to], b: [from, to]}  the transpose mark
//   write     {text, number?}                     tagged handwriting below the textbox
// after:  the textbox lines after Apply, **bold** for new text ('' between lines = two textboxes).

export const MARKS = [
  {
    id: 'delete',
    before: ['the big old red car'],
    marks: [{type: 'strike', from: 2, to: 2}],
    after: ['the big red car'],
  },
  {
    id: 'replace',
    before: ['the big red car'],
    marks: [
      {type: 'strike', from: 1, to: 1},
      {type: 'loop', number: 1},
      {type: 'write', text: 'huge', number: 1},
    ],
    after: ['the **huge** red car'],
  },
  {
    id: 'insert',
    before: ['the red car'],
    marks: [
      {type: 'caret', dir: 'up', at: {gap: 1}, number: 1, size: 34},
      {type: 'write', text: 'shiny', number: 1},
    ],
    after: ['the **shiny** red car'],
  },
  {
    id: 'space',
    before: ['the redcar is fast'],
    marks: [{type: 'caret', dir: 'up', at: {word: 1, char: 3}, cross: true, size: 48}],
    after: ['the red car is fast'],
  },
  {
    id: 'swap',
    before: ['the red big car'],
    marks: [{type: 'swap', a: [1, 1], b: [2, 2]}],
    after: ['the big red car'],
  },
  {
    id: 'paragraph-step',
    before: ['The first idea ends. The second one'],
    marks: [{type: 'step', gap: 4, second: true}],
    after: ['The first idea ends.', '', 'The second one'],
  },
  {
    id: 'paragraph-sideways',
    before: ['The first idea ends here,', 'with a full stop.', 'A new thought starts', 'on this line.'],
    marks: [{type: 'sideways', dir: 'left', after: 1}],
    after: ['The first idea ends here,', 'with a full stop.', '', 'A new thought starts', 'on this line.'],
  },
  {
    id: 'insert-paragraph',
    before: ['The first paragraph.', '', 'The last paragraph.'],
    marks: [
      {type: 'sideways', dir: 'right', after: 0, number: 1},
      {type: 'write', text: 'A new one.', number: 1},
    ],
    after: ['The first paragraph.', '', '**A new one.**', '', 'The last paragraph.'],
  },
];
