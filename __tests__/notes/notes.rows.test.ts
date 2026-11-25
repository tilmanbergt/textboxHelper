import type {Element} from 'sn-plugin-lib';
import {pageParagraphs} from '../../src/actions/notesRead';
import {formatBlockTag} from '../../src/domain/blockTag';
import {movedNote, noteRowTitle, paragraphAt, type NoteRow, type PageParagraph} from '../../src/domain/notes/noteRows';
import {parsePenEditEntry, type PenEditEntry} from '../../src/domain/penEditModel';
import {MAIN_LAYER, TEXT_TYPE_NORMAL} from '../../src/domain/textboxModel';
import {box} from './build';

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/storage/penEditStore', () => ({}));
jest.mock('../../src/supernote/noteElements', () => ({}));

/**
 * What does a note's row say, which section does a page's textbox read as, and where is a moved
 * note now (technical-design-comments-images.md §5.1, §5.2, §6)?
 */

const paragraph = (uuid: string, top: number, page = 0, text = 'One two three four five six seven eight nine ten'): PageParagraph => ({
  ...box(uuid, top, top + 100, {page}),
  numInPage: top,
  text,
});

describe('notes.rows: a row\'s title', () => {
  const p = [paragraph('p1', 100), paragraph('p2', 300), paragraph('q1', 100, 1)];
  const at = (uuid: string) => paragraphAt({uuid, blockId: null, by: 'nearest'}, p);
  it.each([
    ['comment on the second paragraph', {kind: 'comment', page: 0, at: at('p2'), note: {}}, 'Comment · ¶ 2'],
    ['image after its paragraph (default)', {kind: 'image', page: 0, at: at('p1'), note: {}}, 'Image · after ¶ 1'],
    ['image before its paragraph', {kind: 'image', page: 0, at: at('p1'), note: {place: 'before'}}, 'Image · before ¶ 1'],
    ['paragraph on another page', {kind: 'comment', page: 0, at: at('q1'), note: {}}, 'Comment · ¶ 1 on p.2'],
    ['no paragraph', {kind: 'comment', page: 0, at: null, note: {}}, 'Comment · no paragraph'],
  ] as const)('%s', (_name, row, expected) => {
    expect(noteRowTitle(row as unknown as NoteRow)).toBe(expected);
  });

  it('shows the paragraph\'s first words', () => {
    expect(at('p1')?.words).toBe('One two three four five six seven eight …');
  });
});

describe('notes.rows: sections of a page read alone', () => {
  let num = 0;
  const textbox = (top: number, tag: object | null): Element => {
    num += 1;
    return {
      uuid: `t${num}`,
      numInPage: num,
      type: TEXT_TYPE_NORMAL,
      layerNum: MAIN_LAYER,
      userData: tag ? formatBlockTag({v: 1, id: `b${num}`, ...tag}) : null,
      textBox: {textContentFull: `text ${num}`, textRect: {left: 100, top, right: 1100, bottom: top + 80}},
    } as unknown as Element;
  };

  it.each([
    ['untagged text: the text, no file', [textbox(100, null), textbox(300, null)], ['text:', 'text:']],
    ['an imported block names its file for the page', [textbox(100, {s: 'A', i: 3}), textbox(300, null)], ['text:A', 'text:A']],
    ['a divider on the page starts its file', [textbox(100, null), textbox(300, {k: 'f', s: 'B'}), textbox(500, null)], ['text:', 'text:B', 'text:B']],
    ['the aside divider starts the aside area', [textbox(100, null), textbox(300, {k: 'a'}), textbox(500, null)], ['text:', 'aside:', 'aside:']],
  ] as const)('%s', (_name, elements, expected) => {
    const {paragraphs} = pageParagraphs(0, [...elements]);
    expect(paragraphs.map(item => `${item.region}:${item.file ?? ''}`)).toEqual(expected);
    expect(paragraphs.every(item => item.blockId !== undefined)).toBe(true);
  });
});

describe('notes.rows: a note moved with the lasso', () => {
  const entry = parsePenEditEntry({
    id: 'pe-20261125-100000-001',
    kind: 'comment',
    notePath: '/n.note',
    page: 0,
    rect: {left: 600, top: 300, right: 900, bottom: 360},
    strokeRects: [{left: 610, top: 305, right: 700, bottom: 350}, {left: 720, top: 310, right: 890, bottom: 355}],
  }) as PenEditEntry;

  it.each([
    ['where it was tagged: no change', {left: 610, top: 305, right: 890, bottom: 355}, null],
    ['within two pixels: no change', {left: 612, top: 303, right: 892, bottom: 353}, null],
    ['moved down 200: rect and strokes move along', {left: 610, top: 505, right: 890, bottom: 555}, {top: 500, firstStrokeTop: 505}],
  ] as const)('%s', (_name, now, expected) => {
    const moved = movedNote(entry, now);
    if (expected === null) {
      expect(moved).toBeNull();
    } else {
      expect(moved?.rect.top).toBe(expected.top);
      expect(moved?.strokeRects[0].top).toBe(expected.firstStrokeTop);
    }
  });
});
