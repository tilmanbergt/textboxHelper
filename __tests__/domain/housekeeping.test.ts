import {
  backupsToRemove,
  donePenEditIds,
  HOUSEKEEPING_LIMITS,
  housekeepingResultText,
  penEditFilesToRemove,
  storageSummaryText,
  tmpPicturesToRemove,
  withoutPenEdits,
  type StoredFile,
} from '../../src/domain/housekeeping';
import {WAITING_RECOGNITION, type PenEditEntry, type PenEditIndex} from '../../src/domain/penEditModel';

const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const entry = (id: string, overrides: Partial<PenEditEntry> = {}): PenEditEntry => ({
  id,
  kind: 'replacement',
  notePath: '/storage/emulated/0/Note/a.note',
  page: 0,
  number: 1,
  createdAt: iso(10 * DAY),
  rect: {left: 0, top: 0, right: 1, bottom: 1},
  strokeRects: [],
  iconRect: {left: 0, top: 0, right: 1, bottom: 1},
  strokesTagged: true,
  mark: null,
  hasPicture: true,
  recognition: WAITING_RECOGNITION,
  correctedText: null,
  state: 'active',
  doneAt: null,
  awaitingMark: null,
  edges: null,
  ...overrides,
});

const index = (...entries: PenEditEntry[]): PenEditIndex => ({version: 1, entries});

const file = (name: string, msAgo: number, isDirectory = false): StoredFile => ({
  name,
  isDirectory,
  mtimeMs: NOW - msAgo,
  size: 100,
});

describe('done pen edits', () => {
  it('go 3 days after they were applied or dropped', () => {
    const ids = donePenEditIds(
      index(
        entry('old-applied', {state: 'applied', doneAt: iso(4 * DAY)}),
        entry('old-dropped', {state: 'dropped', doneAt: iso(3 * DAY + HOUR)}),
        entry('fresh-applied', {state: 'applied', doneAt: iso(2 * DAY)}),
      ),
      NOW,
    );
    expect(ids).toEqual(['old-applied', 'old-dropped']);
  });

  it('never include an active entry, however old', () => {
    expect(donePenEditIds(index(entry('a', {createdAt: iso(100 * DAY)})), NOW)).toEqual([]);
  });

  it('use createdAt for entries done before doneAt existed, and count no time as old', () => {
    const ids = donePenEditIds(
      index(
        entry('old', {state: 'applied', createdAt: iso(5 * DAY)}),
        entry('recent', {state: 'applied', createdAt: iso(DAY)}),
        entry('unknown', {state: 'dropped', createdAt: ''}),
      ),
      NOW,
    );
    expect(ids).toEqual(['old', 'unknown']);
  });

  it('are taken out of the index', () => {
    const before = index(entry('a'), entry('b', {state: 'applied'}));
    expect(withoutPenEdits(before, ['b']).entries.map(e => e.id)).toEqual(['a']);
    expect(withoutPenEdits(before, [])).toBe(before);
  });
});

describe('pen-edit folder', () => {
  it('removes old folders without an entry and old broken indexes, keeps the rest', () => {
    const listing = [
      file('kept', 10 * DAY, true),
      file('stray-old', 4 * DAY, true),
      file('stray-new', HOUR, true),
      file('tmp', 10 * DAY, true),
      file('index.json', 10 * DAY),
      file('index.json.tmp', 10 * DAY),
      file('index.broken-2026-11-01.json', 10 * DAY),
      file('index.broken-2026-11-21.json', HOUR),
    ];
    expect(penEditFilesToRemove(listing, new Set(['kept']), NOW)).toEqual([
      'stray-old',
      'index.broken-2026-11-01.json',
    ]);
  });

  it('removes lasso pictures left for more than a day', () => {
    expect(tmpPicturesToRemove([file('a.png', 2 * DAY), file('b.png', HOUR)], NOW)).toEqual(['a.png']);
  });
});

describe('backups', () => {
  it('keep the 3 newest', () => {
    const listing = [1, 2, 3, 4, 5].map(n => file(`b${n}.json`, n * HOUR));
    expect(backupsToRemove(listing, NOW)).toEqual(['b4.json', 'b5.json']);
    expect(HOUSEKEEPING_LIMITS.backupKeep).toBe(3);
  });

  it('none older than 14 days', () => {
    const listing = [file('new.json', HOUR), file('old.json', 15 * DAY), file('older.json', 20 * DAY)];
    expect(backupsToRemove(listing, NOW)).toEqual(['old.json', 'older.json']);
    expect(backupsToRemove([file('old.json', 15 * DAY)], NOW)).toEqual(['old.json']);
  });

  it('only JSON files', () => {
    expect(backupsToRemove([file('notes.txt', 30 * DAY), file('dir', 30 * DAY, true)], NOW)).toEqual([]);
  });
});

describe('texts', () => {
  it('storage summary', () => {
    expect(storageSummaryText({files: 214, bytes: 31.2 * 1024 * 1024, orphanRecords: 0})).toBe(
      'Plugin files: 214, 31.2 MB.',
    );
    expect(storageSummaryText({files: 3, bytes: 2048, orphanRecords: 2})).toBe(
      'Plugin files: 3, 2.0 KB. 2 link records belong to notes that no longer exist.',
    );
  });

  it('result', () => {
    expect(housekeepingResultText({files: 0, bytes: 0, penEdits: 0, backups: 0})).toBe('Nothing to remove.');
    expect(housekeepingResultText({files: 37, bytes: 13_002_342, penEdits: 12, backups: 2})).toBe(
      'Removed 37 files (12.4 MB).',
    );
  });
});
