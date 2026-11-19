import {buildStrokeStats} from '../../src/domain/markerStrokes';
import {
  AWAIT_MARK_MS,
  awaitingEntry,
  kindOfMark,
  parsePenEditEntry,
  setAwaitingMark,
  WAITING_RECOGNITION,
  type PenEditEntry,
  type PenEditIndex,
} from '../../src/domain/penEditModel';
import {
  pickNewestMark,
  readDeclaredMark,
  type DeclaredStroke,
  type WindowMark,
  type WindowStroke,
} from '../../src/domain/penEditPairing';

type XY = [number, number];

/** A stroke through the corners, with points every few pixels (as the pen writes). */
function path(...corners: XY[]): Array<{x: number; y: number}> {
  const points: Array<{x: number; y: number}> = [];
  for (let i = 0; i < corners.length - 1; i += 1) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    for (let step = i === 0 ? 0 : 1; step <= 8; step += 1) {
      points.push({x: ax + ((bx - ax) * step) / 8, y: ay + ((by - ay) * step) / 8});
    }
  }
  return points;
}

function declared(uuid: string, numInPage: number, ...corners: XY[]): DeclaredStroke {
  const points = path(...corners);
  return {uuid, numInPage, isStraightLine: false, stats: buildStrokeStats(points)!, points};
}

const strikeStroke = (uuid: string, num: number) => declared(uuid, num, [300, 500], [420, 502], [520, 501]);
const verticalStroke = (uuid: string, num: number, x: number) => declared(uuid, num, [x, 480], [x + 2, 522]);
const loopStroke = (uuid: string, num: number) =>
  declared(uuid, num, [530, 480], [560, 480], [560, 510], [530, 510], [530, 482]);

describe('pickNewestMark', () => {
  const ws = (uuid: string, numInPage: number): WindowStroke => ({
    uuid,
    numInPage,
    isStraightLine: false,
    stats: buildStrokeStats([{x: 0, y: 0}, {x: 10, y: 10}])!,
  });
  const replace = (strikeNum: number, modifierNum: number): WindowMark => ({
    strike: ws('strike', strikeNum),
    modifiers: [ws('loop', modifierNum)],
    loop: ws('loop', modifierNum),
  });

  it('takes the only mark found, or none', () => {
    expect(pickNewestMark(null, null)).toBeNull();
    expect(pickNewestMark(null, [])).toBeNull();
    expect(pickNewestMark(replace(3, 4), null)).toBe('replace');
    expect(pickNewestMark(null, [ws('v', 5)])).toBe('caret');
  });

  it('takes the mark written last before the snippet', () => {
    expect(pickNewestMark(replace(3, 4), [ws('v', 6)])).toBe('caret');
    expect(pickNewestMark(replace(5, 6), [ws('v', 2)])).toBe('replace');
    expect(pickNewestMark(replace(5, 6), [ws('a', 3), ws('b', 4)])).toBe('replace');
  });

  it('keeps a replace mark whose loop was also read as a caret', () => {
    expect(pickNewestMark(replace(3, 8), [ws('loop', 8)])).toBe('replace');
  });
});

describe('readDeclaredMark', () => {
  it('reads a strike with its loop', () => {
    const mark = readDeclaredMark([strikeStroke('s', 1), loopStroke('l', 2)]);
    expect(mark?.kind).toBe('replace');
    expect(mark?.kind === 'replace' && mark.mark).toMatchObject({strike: {uuid: 's'}, loop: {uuid: 'l'}});
  });

  it('reads a strike with two crossing lines', () => {
    const mark = readDeclaredMark([strikeStroke('s', 1), verticalStroke('a', 2, 400), verticalStroke('b', 3, 430)]);
    expect(mark?.kind === 'replace' && mark.mark.modifiers.map(item => item.uuid)).toEqual(['a', 'b']);
  });

  it('accepts a strike alone: the user said it is a mark', () => {
    const mark = readDeclaredMark([strikeStroke('s', 1)]);
    expect(mark?.kind === 'replace' && mark.mark).toMatchObject({strike: {uuid: 's'}, modifiers: [], loop: null});
  });

  it('reads a V and a two-stroke < as carets', () => {
    expect(readDeclaredMark([declared('v', 1, [100, 100], [120, 140], [140, 100])])).toMatchObject({
      kind: 'caret',
      shape: {direction: 'down'},
    });
    const twoStroke = readDeclaredMark([
      declared('a', 4, [260, 100], [100, 150]),
      declared('b', 5, [100, 150], [260, 200]),
    ]);
    expect(twoStroke).toMatchObject({kind: 'caret', shape: {direction: 'left'}});
    expect(twoStroke?.kind === 'caret' && twoStroke.strokes.map(item => item.uuid)).toEqual(['a', 'b']);
  });

  it('leaves out strokes that belong to no mark, and finds none in a scribble', () => {
    const mark = readDeclaredMark([strikeStroke('s', 1), declared('x', 2, [100, 900], [104, 902])]);
    expect(mark?.kind === 'replace' && [mark.mark.strike, ...mark.mark.modifiers].map(item => item.uuid)).toEqual(['s']);
    expect(readDeclaredMark([declared('dot', 1, [100, 100], [103, 101])])).toBeNull();
    expect(readDeclaredMark([])).toBeNull();
  });
});

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
    review: 'open',
    state: 'active',
    awaitingMark: null,
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
});
