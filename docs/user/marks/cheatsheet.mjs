// The examples of the cheat sheet (technical-design-release-readiness.md §6.1): drawn by
// scripts/cheatsheet.mjs with the help pictures' drawing (same entry format as marks.mjs). Each
// example's text says what its mark does; `text: true` shows the "+ text" badge.

export const CHEAT_SHEET_TITLE = 'Manuscript · editing marks';

export const CHEAT_SHEET_EXAMPLES = [
  {id: 'cs-delete', before: ['delete unwanted words'], marks: [{type: 'strike', from: 1, to: 1}]},
  {
    id: 'cs-replace',
    text: true,
    before: ['replace a wrong word'],
    marks: [{type: 'strike', from: 2, to: 2}, {type: 'loop'}, {type: 'write', text: 'right'}],
  },
  {
    id: 'cs-insert',
    text: true,
    before: ['insert words'],
    marks: [{type: 'caret', dir: 'up', at: {gap: 1}, size: 34}, {type: 'write', text: 'missing'}],
  },
  {
    id: 'cs-slash',
    text: true,
    before: ['fix a sinqle letter'],
    marks: [{type: 'slash', word: 2, char: 3}, {type: 'write', text: 'g'}],
  },
  {
    id: 'cs-exact',
    before: ['remove extra letterssss'],
    marks: [{type: 'exact', from: {word: 2, char: 7}, to: {word: 2, edge: 'end'}}],
  },
  {
    id: 'cs-space',
    before: ['add a missingspace'],
    marks: [{type: 'caret', dir: 'up', at: {word: 2, char: 7}, cross: true, size: 48}],
  },
  {id: 'cs-close-up', before: ['close up a ga p'], marks: [{type: 'arc', gap: 4}]},
  {id: 'cs-swap', before: ['swap words these'], marks: [{type: 'swap', a: [1, 1], b: [2, 2]}]},
];

export const CHEAT_SHEET_FOOTER = [
  '+ text: make the mark, then write the new words as the very next thing,',
  'anywhere on the page, lasso them and tap Insertion or Replacement.',
  'Then open Manuscript to review and apply. More marks: ? in Manuscript.',
];
