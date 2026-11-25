import * as fs from 'fs';
import * as path from 'path';
import {analyzeMarkerPage} from '../../src/actions/markerPageAnalysis';
import type {EditMarkerPreview} from '../../src/domain/markerTypes';
import {NOTE_PATH, servePage} from './golden/host';
import {GOLDEN_PAGES} from './golden/pages';

/**
 * The golden record (technical-design-mark-dialogue.md §3): for every page below, the changes and
 * the To decide items the review gives, recorded in `golden/<page>.json`. Moving the mark logic
 * must give the same lists, except where a step's commit names an intended change.
 *
 * Record again (only for an intended change, listed in the commit):
 *   GOLDEN_UPDATE=1 npx jest __tests__/marks/golden.test.ts
 */

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/supernote/noteElements', () => require('./golden/host').noteElementsMock);
jest.mock('../../src/supernote/textboxMetrics', () => require('./golden/host').textboxMetricsMock);
jest.mock('../../src/storage/penEditStore', () => require('./golden/host').penEditStoreMock);
jest.mock('../../src/storage/ignoredMarks', () => ({readIgnoredMarks: async () => [], rememberIgnored: async () => undefined}));
jest.mock('../../src/utils/editMarkerLog', () => ({logEditMarker: () => undefined, markerDiagnostics: {clear: () => undefined}}));

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.env.GOLDEN_UPDATE === '1';

/** Drops undefined fields, so a record reads the same whatever optional fields the code leaves out. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** What the review shows for a page: its changes, To decide, and the text after Apply. */
function record(preview: EditMarkerPreview) {
  return clean({
    changes: preview.operations.map(operation => ({
      kind: operation.kind,
      summary: operation.summary,
      detail: operation.detail,
      textbox: operation.targetTextboxNumInPage,
      line: operation.lineIndex,
      textStart: operation.textStart,
      words: operation.words,
      strokes: operation.consumedMarkerNums,
      penEdit: operation.penEditNumber,
      insertMode: operation.insertMode,
      uncertain: operation.uncertain,
      punct: operation.punct,
      swap: operation.swap ? {zones: operation.swap.zones} : undefined,
      closeUp: operation.closeUp ? {gapStart: operation.closeUp.gapStart, gapEnd: operation.closeUp.gapEnd} : undefined,
      join: operation.join ? {below: operation.join.belowNumInPage} : undefined,
    })),
    toDecide: preview.toDecide.map(item => ({
      kind: item.kind,
      summary: item.summary,
      reason: item.reason,
      penEdit: item.number ?? undefined,
      strokes: item.strokeNums,
      removable: item.removableNums,
      words: item.words || undefined,
      readings: item.readings.length > 0 ? item.readings.map(reading => reading.kind) : undefined,
      guess: item.guess ? [item.guess.numInPage, item.guess.start, item.guess.end] : undefined,
      canPlaceHere: item.canPlaceHere,
    })),
    after: (preview.applyPlan?.textMutations ?? []).map(mutation => ({textbox: mutation.numInPage, text: mutation.nextText})),
    newParagraphs: (preview.applyPlan?.insertions ?? []).map(insertion => ({
      text: insertion.text,
      left: insertion.left,
      width: insertion.width,
      above: insertion.aboveRect,
      below: insertion.belowRect,
    })),
    fontWarning: preview.fontWarning,
    canApply: preview.canApply,
  });
}

describe('golden record of the review', () => {
  it('has one record per page and no record without a page', () => {
    const names = GOLDEN_PAGES.map(page => page.name);
    expect(new Set(names).size).toBe(names.length);
    if (!UPDATE) {
      const files = fs.readdirSync(GOLDEN_DIR).filter(file => file.endsWith('.json'));
      expect(files.map(file => file.replace(/\.json$/, '')).sort()).toEqual([...names].sort());
    }
  });

  it.each(GOLDEN_PAGES.map(page => [page.name, page] as const))('%s', async (name, page) => {
    servePage(page);
    const actual = {about: page.about, ...record(await analyzeMarkerPage(NOTE_PATH, 0))};
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    if (UPDATE) {
      fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    expect(actual).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
  });
});
