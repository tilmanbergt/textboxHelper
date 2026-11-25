import type {Element} from 'sn-plugin-lib';
import {penEditElementNums} from '../../src/actions/penEditReview';
import {parsePenEditEntry, type PenEditEntry} from '../../src/domain/penEditModel';
import {penEditUserData, type PenEditRole} from '../../src/domain/penEditTags';

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/storage/penEditStore', () => ({}));
jest.mock('../../src/supernote/strokeRecognition', () => ({}));

/**
 * Apply never touches notes or their signs (technical-design-comments-images.md §3.2): what it
 * removes of tagged text is chosen by the applied entries' ids.
 */

const TEXT_ID = 'pe-20261125-100000-001';
const COMMENT_ID = 'pe-20261125-100000-002';

function entry(id: string, kind: string): PenEditEntry {
  return parsePenEditEntry({id, kind, notePath: '/n.note', page: 0, rect: {left: 600, top: 300, right: 900, bottom: 360}}) as PenEditEntry;
}

let num = 0;
function tagged(id: string, role: PenEditRole): Element {
  num += 1;
  return {uuid: `u${num}`, numInPage: num, userData: penEditUserData(id, role), type: 0} as unknown as Element;
}

describe('notes.apply: Apply removes only what belongs to the applied entries', () => {
  const page = [
    tagged(TEXT_ID, 'snippet'),
    tagged(TEXT_ID, 'snippetnum'),
    tagged(TEXT_ID, 'stroke'),
    tagged(COMMENT_ID, 'snippet'),
    tagged(COMMENT_ID, 'snippetnum'),
    tagged(COMMENT_ID, 'stroke'),
  ];
  const entries = [entry(TEXT_ID, 'insertion'), entry(COMMENT_ID, 'comment')];

  it('the applied text\'s sign and handwriting go; the comment\'s stay', () => {
    expect(penEditElementNums([TEXT_ID], entries, page)).toEqual([1, 2, 3]);
  });

  it('nothing goes when only a note is on the page', () => {
    expect(penEditElementNums([], entries, page)).toEqual([]);
  });
});
