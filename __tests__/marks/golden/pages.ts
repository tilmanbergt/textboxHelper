import {
  arc,
  at,
  caret,
  caretInTwo,
  circle,
  cross,
  fixture,
  hand,
  loop,
  sideways,
  slash,
  step,
  strike,
  swap,
  textbox,
  verticals,
  type Drawn,
} from '../build';
import type {PageSpec, PageTextbox} from './host';

/**
 * The pages of the golden record: one page per mark family as today's scenario tests draw it
 * (fine marks, swap and space marks, paragraph marks, carets, replace marks), the device page of
 * 2026-11-20, and one page with every kind at once. A page's `about` says what it shows.
 */

// "the big red car and more words here" on one line: character i starts at x 115 + 18·i;
// line 200–248, small letters 219–238 (middle 228.5).
const A = textbox('the big red car and more words here', {left: 100, top: 200, width: 1000});
const x = (offset: number, box: PageTextbox = A) => at(box, offset).x;
const MID = at(A, 0).mid;

/** Handwriting written below the text, where tagged text usually is. */
const below = (word: string, column: number, row = 0): Drawn => hand(word, 150 + column * 260, 700 + row * 80);

const strikes: PageSpec = {
  name: 'strike-words',
  about: 'Strikes over one word and two words; a strike too short to read; a line far from any text.',
  textboxes: [A],
  strokes: [
    strike(x(4) + 3, x(7) - 3, MID),
    strike(x(20) + 3, x(30) - 3, MID),
    strike(x(0) + 2, x(0) + 24, MID),
    strike(200, 420, 600),
  ],
};

// A paragraph wrapping over four lines of 20 characters (left 100, width 400).
const W = textbox('one two three four five six seven eight nine ten eleven twelve thirteen', {
  left: 100,
  top: 200,
  width: 400,
});

const strikeLines: PageSpec = {
  name: 'strike-lines',
  about: 'A slanted strike from one line into the next; a strike on the second line; a tall stroke over a word.',
  textboxes: [W],
  strokes: [
    strike(x(0, W) + 3, x(13, W), at(W, 0).mid).map(points => points.map(point => ({x: point.x, y: point.y + ((point.x - x(0, W)) / 240) * 48}))),
    strike(x(24, W) + 3, x(28, W) - 3, at(W, 24).mid),
    [[{x: x(41, W), y: at(W, 41).mid - 20}, {x: x(41, W) + 20, y: at(W, 41).mid + 18}, {x: x(41, W) + 40, y: at(W, 41).mid - 20}]],
  ],
};

const BIGGER = textbox('a bigger word', {left: 100, top: 400, width: 1000, uuid: 'tb2', numInPage: 2});

const replaceVerticals: PageSpec = {
  name: 'replace-verticals',
  about: 'Strike with two verticals and no text: exactly what is between them goes, a whole word and letters inside a word.',
  textboxes: [A, BIGGER],
  strokes: [
    strike(x(8) - 6, x(11) + 6, MID),
    verticals(x(8) + 2, x(11) - 2, MID),
    strike(x(2, BIGGER) + 2, x(8, BIGGER) - 2, at(BIGGER, 2).mid),
    verticals(x(4, BIGGER) + 1, x(6, BIGGER) - 1, at(BIGGER, 2).mid),
  ],
};

const replaceLinked: PageSpec = {
  name: 'replace-linked',
  about:
    'Replace marks with tagged text: verticals, a loop, a strike chosen with Select mark; a loop without text; a replacement whose mark was erased.',
  textboxes: [A],
  strokes: [
    {name: 'r1', drawn: [...strike(x(4) - 4, x(7) + 4, MID), ...verticals(x(4) + 2, x(7) - 2, MID)]},
    {name: 'r2', drawn: [...strike(x(12) + 2, x(15) - 2, MID), ...loop(x(15) + 20, MID)]},
    {name: 'r3', drawn: [...strike(x(25) + 2, x(30) - 2, MID), ...loop(x(30) + 20, MID)]},
    {name: 'r5', drawn: strike(x(20) + 2, x(24) - 2, MID)},
  ],
  penEdits: [
    {number: 1, kind: 'replacement', text: 'small', handwriting: below('small', 0), after: 'r1', mark: {kind: 'replace', item: 'r1', exact: true}},
    {number: 2, kind: 'replacement', text: 'bus', handwriting: below('bus', 1), after: 'r2', mark: {kind: 'replace', item: 'r2'}},
    {number: 4, kind: 'replacement', text: 'gone', handwriting: below('gone', 2), mark: {kind: 'replace', item: 'none', erased: true}},
    {number: 5, kind: 'replacement', text: 'less', handwriting: below('less', 0, 1), after: 'r5', mark: {kind: 'replace', item: 'r5'}},
  ],
};

const slashes: PageSpec = {
  name: 'slashes',
  about:
    'Slashes through one letter at about 60°, 50° and 35°, and one through a space. A slash from 30° on is one; the 35° one is wider than two letters: check the letter.',
  textboxes: [A],
  strokes: [
    slash(x(4) + 9, MID, 60, 40),
    slash(x(9) + 9, MID, 50, 40),
    slash(x(26) + 9, MID, 35, 46),
    slash(x(19) + 9, MID, 60, 40),
  ],
};

const slashLinked: PageSpec = {
  name: 'slash-linked',
  about: 'A slash through the r of "red" with tagged text after it: the letter is replaced; its own circle for the number goes with it.',
  textboxes: [A],
  strokes: [{name: 's1', drawn: slash(x(8) + 9, MID, 65, 40)}, circle(x(8) + 20, MID - 40, 12)],
  penEdits: [{number: 1, kind: 'replacement', text: 'b', handwriting: below('b', 0), after: 's1', mark: {kind: 'replace', item: 's1', slash: true}}],
};

// A second paragraph below A, with room between them for a new paragraph.
const C = textbox('second paragraph here', {left: 100, top: 400, width: 1000, uuid: 'tb2', numInPage: 2});

const carets: PageSpec = {
  name: 'carets',
  about:
    'Insertions: a ∧ in a word gap, a V inside a word, a caret in two strokes, a caret between two paragraphs; one whose caret was erased; tagged text without a mark; text put right here.',
  textboxes: [A, C],
  strokes: [
    {name: 'c1', drawn: caret('up', {x: x(7) + 9, y: 246})},
    {name: 'c2', drawn: caret('down', {x: x(22), y: 206})},
    {name: 'c3', drawn: caretInTwo('up', {x: x(15) + 9, y: 246})},
    {name: 'c7', drawn: caret('down', {x: x(5), y: 330})},
  ],
  penEdits: [
    {number: 1, kind: 'insertion', text: 'very', handwriting: below('very', 0), after: 'c1', mark: {kind: 'caret', item: 'c1', tip: {x: x(7) + 9, y: 246}, direction: 'up'}},
    {number: 2, kind: 'insertion', text: 'X', handwriting: below('x', 1), after: 'c2', mark: {kind: 'caret', item: 'c2', tip: {x: x(22), y: 206}, direction: 'down'}},
    {number: 3, kind: 'insertion', text: 'old', handwriting: below('old', 2), after: 'c3', mark: {kind: 'caret', item: 'c3', tip: {x: x(15) + 10, y: 246}, direction: 'up'}},
    {number: 4, kind: 'insertion', text: 'lost', handwriting: below('lost', 0, 1), mark: {kind: 'caret', item: 'none', tip: {x: 2020, y: 2040}, direction: 'up', erased: true}},
    {number: 5, kind: 'unpaired', text: 'loose', handwriting: below('loose', 1, 1)},
    {number: 6, kind: 'insertion', text: 'Here it goes.', handwriting: hand('here', 140, 1100), placement: 'here'},
    {number: 7, kind: 'insertion', text: 'Between.', handwriting: below('between', 2, 1), after: 'c7', mark: {kind: 'caret', item: 'c7', tip: {x: x(5), y: 330}, direction: 'down'}},
  ],
};

const paragraphMarks: PageSpec = {
  name: 'paragraph-marks',
  about:
    'A < between two lines splits there; a step with its second upright splits at a word gap; a bare step is ignored; a > before the first line is already a break.',
  textboxes: [W],
  strokes: [
    sideways('left', {x: W.rect.right + 6, y: W.lines[1].top}),
    step(x(43, W) - 9, at(W, 43).mid, {second: true}),
    step(x(65, W) - 9, at(W, 65).mid),
    sideways('right', {x: W.rect.left - 6, y: W.lines[0].top - 2}),
  ],
};

const SP = textbox('the bigred car and more words here', {left: 100, top: 200, width: 1000});

const spacePunct: PageSpec = {
  name: 'space-punct',
  about:
    'A ∧ with a cross puts a space into "bigred"; a ∧ with a comma in its circle puts a comma after "car"; a ∧ with an empty circle is a caret waiting for text.',
  textboxes: [SP],
  strokes: [
    caret('up', {x: x(7, SP), y: 246}),
    cross(x(7, SP), 300),
    caret('up', {x: x(14, SP) + 2, y: 246}, 44),
    circle(x(14, SP) + 2, 274, 9, ','),
    caret('up', {x: x(23, SP) + 9, y: 246}, 44),
    circle(x(23, SP) + 9, 274, 9),
  ],
};

const swapOneLine: PageSpec = {
  name: 'swap-one-line',
  about: 'A one-line swap mark: "big" and "red" change places.',
  textboxes: [A],
  strokes: [swap([x(4) - 3, x(7) + 2], [x(8) - 2, x(11) + 3], at(A, 4))],
};

const device = fixture('swap-page-2026-11-20');
const swapDevice: PageSpec = {
  name: 'swap-device-2026-11-20',
  about: 'The device page of 2026-11-20: three swaps, two across lines, one in two textboxes.',
  textboxes: device.boxes.map(box => ({...box, fontSize: 36})),
  strokes: Object.entries(device.strokes).map(([num, points]) => ({drawn: [points], nums: [Number(num)]})),
};

const NB = textbox('a note book here', {left: 100, top: 200, width: 1000});
const WRAP = textbox('some long text that wraps over here', {left: 100, top: 400, width: 400, uuid: 'tb2', numInPage: 2});
const UPPER = textbox('the upper paragraph ends', {left: 100, top: 700, width: 1000, uuid: 'tb3', numInPage: 3});
const LOWER = textbox('the lower one starts', {left: 100, top: 760, width: 1000, uuid: 'tb4', numInPage: 4});

const closeUp: PageSpec = {
  name: 'close-up',
  about:
    'A close-up arc under one gap; two arcs across a line wrap; two arcs joining two paragraphs; a deep arc over two gaps is no close-up.',
  textboxes: [NB, WRAP, UPPER, LOWER],
  strokes: [
    arc(x(4, NB) - 4, x(7, NB) + 4, at(NB, 0).base + 8, 'down'),
    arc(x(19, WRAP) - 30, x(19, WRAP) + 40, at(WRAP, 0).base + 8, 'down'),
    arc(x(20, WRAP) - 40, x(20, WRAP) + 30, at(WRAP, 20).base + 8, 'down'),
    arc(x(24, UPPER) - 30, x(24, UPPER) + 40, at(UPPER, 0).base + 8, 'down'),
    arc(x(0, LOWER) - 40, x(0, LOWER) + 30, at(LOWER, 0).base + 8, 'down'),
    arc(x(6, NB), x(14, NB), at(NB, 0).base + 4, 'down', 16),
  ],
};

const handwriting: PageSpec = {
  name: 'handwriting',
  about: 'Handwriting in the margin and below the text, and a word written over the text: none of it is a mark.',
  textboxes: [A],
  strokes: [hand('note', 20, 120), hand('later', 300, 500), hand('ok', x(12), 214)],
};

const LOCKED = {...textbox('a paragraph in a locked font', {left: 100, top: 400, width: 1000, uuid: 'tb2', numInPage: 2}), locked: true};

const lockedFont: PageSpec = {
  name: 'locked-font',
  about: "Marks on a textbox whose font plugins can't read: a strike, a tagged insertion; a strike on a readable textbox still works.",
  textboxes: [A, LOCKED],
  strokes: [
    strike(x(2, LOCKED) + 2, x(11, LOCKED) - 2, at(LOCKED, 2).mid),
    {name: 'c1', drawn: caret('up', {x: x(16, LOCKED) + 9, y: 446})},
    strike(x(4) + 3, x(7) - 3, MID),
  ],
  penEdits: [
    {number: 1, kind: 'insertion', text: 'new', handwriting: below('new', 0), after: 'c1', mark: {kind: 'caret', item: 'c1', tip: {x: x(16, LOCKED) + 9, y: 446}, direction: 'up'}},
  ],
};

// Every kind on one page: a paragraph of four lines and one of one line.
const P = textbox('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho', {
  left: 100,
  top: 200,
  width: 600,
});
const Q = textbox('the bigred car and more words here', {left: 100, top: 500, width: 1000, uuid: 'tb2', numInPage: 2});

const everyKind: PageSpec = {
  name: 'every-kind',
  about: 'Every mark kind on one page, close to each other: what each takes from the others.',
  textboxes: [P, Q],
  strokes: [
    strike(x(0, P) + 2, x(5, P) - 2, at(P, 0).mid),
    {name: 'r1', drawn: [...strike(x(6, P) - 4, x(10, P) + 4, at(P, 6).mid), ...verticals(x(7, P) + 1, x(9, P) - 1, at(P, 6).mid)]},
    slash(x(12, P) + 9, at(P, 12).mid, 60, 40),
    sideways('left', {x: P.rect.right + 6, y: P.lines[1].top}),
    {name: 'c1', drawn: caret('up', {x: x(10, P) + 9, y: P.lines[0].bottom - 2})},
    swap([x(36, P) - 3, x(39, P) + 2], [x(40, P) - 2, x(45, P) + 3], at(P, 36)),
    caret('up', {x: x(7, Q), y: 546}),
    cross(x(7, Q), 600),
    arc(x(14, Q) - 4, x(17, Q) + 4, at(Q, 14).base + 8, 'down'),
    caret('up', {x: x(29, Q) + 2, y: 546}, 44),
    circle(x(29, Q) + 2, 574, 9, '.'),
    hand('margin', 760, 220),
  ],
  penEdits: [
    {number: 1, kind: 'replacement', text: 'BETA', handwriting: below('beta', 0), after: 'r1', mark: {kind: 'replace', item: 'r1', exact: true}},
    {number: 2, kind: 'insertion', text: 'new', handwriting: below('new', 1), after: 'c1', mark: {kind: 'caret', item: 'c1', tip: {x: x(10, P) + 9, y: P.lines[0].bottom - 2}, direction: 'up'}},
  ],
};

export const GOLDEN_PAGES: PageSpec[] = [
  strikes,
  strikeLines,
  replaceVerticals,
  replaceLinked,
  slashes,
  slashLinked,
  carets,
  paragraphMarks,
  spacePunct,
  swapOneLine,
  swapDevice,
  closeUp,
  handwriting,
  lockedFont,
  everyKind,
];
