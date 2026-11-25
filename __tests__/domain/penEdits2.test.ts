import {
  AWAIT_MARK_MS,
  awaitingEntry,
  kindOfMark,
  linkedNumbersOnPage,
  linkPenEdit,
  parsePenEditEntry,
  setAwaitingMark,
  WAITING_RECOGNITION,
  type PenEditEntry,
  type PenEditIndex,
} from '../../src/domain/penEditModel';
import {badgeNumberRect, looksLikePenEditNumber, nextPenEditNumber, penEditNumberText} from '../../src/domain/penEditTags';
describe('Select mark state', () => {
  const NOTE = '/storage/emulated/0/Note/a.note';
  const entry = (id: string, overrides: Partial<PenEditEntry> = {}): PenEditEntry => ({
    id,
    kind: 'unpaired',
    notePath: NOTE,
    page: 2,
    number: 1,
    createdAt: '2026-11-19T10:00:00.000Z',
    rect: {left: 1, top: 2, right: 3, bottom: 4},
    strokeRects: [],
    iconRect: {left: 1, top: 2, right: 49, bottom: 50},
    strokesTagged: true,
    mark: null,
    hasPicture: false,
    recognition: WAITING_RECOGNITION,
    correctedText: null,
      state: 'active',
    awaitingMark: null,
    edges: null,
    ...overrides,
  });
  const index = (...entries: PenEditEntry[]): PenEditIndex => ({version: 1, entries});
  const now = new Date('2026-11-19T10:00:00.000Z');

  it('lets one snippet wait at a time', () => {
    const first = setAwaitingMark(index(entry('pe-a'), entry('pe-b')), 'pe-a', 'tag', now);
    const second = setAwaitingMark(first, 'pe-b', 'review', now);
    expect(second.entries.map(item => item.awaitingMark?.from ?? null)).toEqual([null, 'review']);
  });

  it('finds the waiting snippet on its page until the wait runs out', () => {
    const waiting = setAwaitingMark(index(entry('pe-a')), 'pe-a', 'tag', now);
    expect(awaitingEntry(waiting, NOTE, 2, new Date(now.getTime() + 60_000))?.id).toBe('pe-a');
    expect(awaitingEntry(waiting, NOTE, 2, new Date(now.getTime() + AWAIT_MARK_MS + 1))).toBeNull();
    expect(awaitingEntry(waiting, NOTE, 3, now)).toBeNull();
    expect(awaitingEntry(waiting, '/other.note', 2, now)).toBeNull();
    const dropped = {...waiting, entries: waiting.entries.map(item => ({...item, state: 'dropped' as const}))};
    expect(awaitingEntry(dropped, NOTE, 2, now)).toBeNull();
  });

  it('takes the kind from the mark', () => {
    expect(kindOfMark(null)).toBe('unpaired');
    expect(kindOfMark({kind: 'replace', strikeRect: {left: 0, top: 0, right: 1, bottom: 1}, modifierRects: []})).toBe(
      'replacement',
    );
    expect(
      kindOfMark({kind: 'caret', caretRect: {left: 0, top: 0, right: 1, bottom: 1}, tip: {x: 0, y: 0}, direction: 'left'}),
    ).toBe('insertion');
  });

  it('reads entries stored before Select mark, and keeps a wait', () => {
    const old: Record<string, unknown> = {...entry('pe-20261119-100000-001', {kind: 'insertion'})};
    delete old.awaitingMark;
    expect(parsePenEditEntry(old)?.awaitingMark).toBeNull();
    expect(parsePenEditEntry({...old, kind: 'unpaired'})?.kind).toBe('unpaired');
    const since = '2026-11-19T10:00:00.000Z';
    expect(parsePenEditEntry({...old, awaitingMark: {since, from: 'review'}})?.awaitingMark).toEqual({since, from: 'review'});
    expect(parsePenEditEntry({...old, awaitingMark: {since, from: 'elsewhere'}})?.awaitingMark).toBeNull();
  });

  describe('numbers and "?" (technical-design-mark-dialogue.md §4.4)', () => {
    const replace = {kind: 'replace' as const, strikeRect: {left: 0, top: 0, right: 90, bottom: 4}, modifierRects: []};

    it('reads text without a mark as "?", also when it was stored with a number', () => {
      expect(parsePenEditEntry(entry('pe-20261119-100000-002', {kind: 'unpaired', number: 4}))?.number).toBeNull();
      expect(parsePenEditEntry({...entry('pe-20261119-100000-003', {kind: 'unpaired'}), number: null})?.number).toBeNull();
      expect(parsePenEditEntry(entry('pe-20261119-100000-004', {kind: 'replacement', mark: replace, number: 3}))?.number).toBe(3);
    });

    it('numbers count only the linked texts of the page; gaps after Drop stay', () => {
      const page = index(
        entry('pe-a', {kind: 'replacement', mark: replace, number: 1}),
        entry('pe-b', {number: null}),
        entry('pe-c', {kind: 'replacement', mark: replace, number: 4}),
        entry('pe-d', {kind: 'replacement', mark: replace, number: 9, page: 3}),
      );
      expect(linkedNumbersOnPage(page, NOTE, 2)).toEqual([1, 4]);
      expect(nextPenEditNumber(linkedNumbersOnPage(page, NOTE, 2))).toBe(5);
    });

    it('links a text: its mark, kind and number, and it stops waiting', () => {
      const waiting = index(entry('pe-b', {number: null, awaitingMark: {since: now.toISOString(), from: 'tag'}, placement: 'here'}));
      expect(linkPenEdit(waiting, 'pe-b', replace, 2).entries[0]).toMatchObject({
        kind: 'replacement',
        mark: replace,
        number: 2,
        awaitingMark: null,
        placement: undefined,
      });
    });

    it('shows "?" on the page and takes it for a pen-edit number', () => {
      expect(penEditNumberText(null)).toBe('?');
      expect(penEditNumberText(12)).toBe('12');
      expect(looksLikePenEditNumber('?', 28)).toBe(true);
      expect(looksLikePenEditNumber('??', 28)).toBe(false);
      const badge = {left: 100, top: 100, right: 148, bottom: 148};
      expect(badgeNumberRect(badge, null)).toEqual(badgeNumberRect(badge, 7));
    });
  });
});
