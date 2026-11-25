import {
  cachedOutline,
  cachedPage,
  clearCacheForTests,
  forgetPages,
  openCachedNote,
  rememberOutline,
  rememberPage,
} from '../../src/actions/manuscriptCache';
import type {ScannedTextBox} from '../../src/domain/exportClassification';
import {checkOrder, listChanged} from '../../src/domain/manuscriptPages';
import type {EditMarkerPreview} from '../../src/domain/markerTypes';
import {pageFingerprint, snippetIdsOnPage, type FingerprintElement} from '../../src/domain/pageFingerprint';
import {countEvents, createPerfLog, summarizePerf} from '../../src/domain/perfLog';


const textbox = (text: string, num = 1, left = 100): FingerprintElement => ({
  type: 500,
  numInPage: num,
  layerNum: 0,
  userData: null,
  textBox: {
    textContentFull: text,
    textRect: {left, top: 200, right: left + 500, bottom: 260},
    fontSize: 40,
    textBold: 0,
    textItalics: 0,
    textFrameStyle: 0,
    textAlign: 0,
  },
});
const stroke = (num: number, userData: string | null = null): FingerprintElement & {uuid: string} => ({
  uuid: `u-${Math.random()}`,
  type: 0,
  numInPage: num,
  layerNum: 0,
  userData,
  recognizeResult: {
    predict_name: 'line',
    up_left_point_x: 10,
    up_left_point_y: 20,
    down_right_point_x: 300,
    down_right_point_y: 24,
  },
});
const calibration = {offsetX: 0, widthAdjustment: 0};

describe('page fingerprint', () => {
  const page = [textbox('One two three.'), stroke(2)];
  const fingerprint = pageFingerprint(page, [], calibration);

  it('is the same for the same page, whatever the uuids', () => {
    expect(pageFingerprint([textbox('One two three.'), stroke(2)], [], calibration)).toBe(fingerprint);
  });

  it('changes with the text, a rect, a number, userData, a new element or the calibration', () => {
    expect(pageFingerprint([textbox('One two four.'), stroke(2)], [], calibration)).not.toBe(fingerprint);
    expect(pageFingerprint([textbox('One two three.', 1, 120), stroke(2)], [], calibration)).not.toBe(fingerprint);
    expect(pageFingerprint([textbox('One two three.', 3), stroke(2)], [], calibration)).not.toBe(fingerprint);
    expect(pageFingerprint([textbox('One two three.'), stroke(2, 'tag')], [], calibration)).not.toBe(fingerprint);
    expect(pageFingerprint([...page, stroke(3)], [], calibration)).not.toBe(fingerprint);
    expect(pageFingerprint(page, [], {offsetX: 5, widthAdjustment: 0})).not.toBe(fingerprint);
  });

  it('keeps the element order', () => {
    expect(pageFingerprint([stroke(2), textbox('One two three.')], [], calibration)).not.toBe(fingerprint);
  });

  it('changes with a pen edit state or mark, not with the order of entries', () => {
    const a = {id: 'a', state: 'active', number: 1, mark: null};
    const b = {id: 'b', state: 'active', number: 2, mark: {kind: 'caret'}};
    const both = pageFingerprint(page, [a, b], calibration);
    expect(pageFingerprint(page, [b, a], calibration)).toBe(both);
    expect(pageFingerprint(page, [a, {...b, state: 'applied'}], calibration)).not.toBe(both);
    expect(pageFingerprint(page, [a, {...b, mark: {kind: 'replace'}}], calibration)).not.toBe(both);
  });

  it('finds the snippet ids on a page', () => {
    const ids = snippetIdsOnPage([stroke(1, 'x:a'), stroke(2, 'x:b'), stroke(3)], data =>
      data?.startsWith('x:') ? data.slice(2) : null,
    );
    expect([...ids]).toEqual(['a', 'b']);
  });
});

describe('check order and list changes', () => {
  it('checks the current page first, then the nearest', () => {
    expect(checkOrder(4, [0, 2, 4, 5, 9, 3])).toEqual([4, 3, 5, 2, 0, 9]);
    expect(checkOrder(0, [3, 3, 1])).toEqual([1, 3]);
  });

  const preview = (labels: string[]): EditMarkerPreview =>
    ({
      hunks: labels.map(label => ({operationId: label, label, before: 'a', segments: [], after: 'b', meta: ''})),
      toDecide: [],
    } as unknown as EditMarkerPreview);

  it('tells when a page shows a different list', () => {
    const before = {state: 'read' as const, preview: preview(['Delete'])};
    expect(listChanged(before, preview(['Delete']))).toBe(false);
    expect(listChanged(before, preview(['Delete', 'Insert 2']))).toBe(true);
    expect(listChanged(undefined, preview([]))).toBe(true);
  });
});

describe('manuscript cache', () => {
  beforeEach(clearCacheForTests);
  const preview = {hunks: []} as unknown as EditMarkerPreview;

  it('keeps pages per note and forgets them when the page count changes', () => {
    expect(openCachedNote('/n.note', 5).size).toBe(0);
    rememberPage('/n.note', 2, 'fp', preview);
    rememberPage('/n.note', 0, 'fp0', preview);
    expect([...openCachedNote('/n.note', 5).keys()]).toEqual([0, 2]);
    expect(cachedPage('/n.note', 2)?.fingerprint).toBe('fp');
    expect(openCachedNote('/n.note', 6).size).toBe(0);
    expect(cachedPage('/n.note', 2)).toBeNull();
  });

  it('forgets written pages and the outline with them', () => {
    openCachedNote('/n.note', 3);
    rememberPage('/n.note', 1, 'fp', preview);
    rememberPage('/n.note', 2, 'fp', preview);
    rememberOutline('/n.note', 3, [] as ScannedTextBox[]);
    forgetPages('/n.note', [1]);
    expect(cachedPage('/n.note', 1)).toBeNull();
    expect(cachedPage('/n.note', 2)).not.toBeNull();
    expect(cachedOutline('/n.note', 3)).toBeNull();
  });

  it('keeps the outline only for the same page count', () => {
    rememberOutline('/m.note', 4, [] as ScannedTextBox[]);
    expect(cachedOutline('/m.note', 4)).toEqual([]);
    expect(cachedOutline('/m.note', 5)).toBeNull();
  });
});

describe('timings log', () => {
  it('is bounded and counts what it drops', () => {
    let clock = 0;
    const log = createPerfLog(2, () => clock);
    clock = 5;
    log.add({stage: 'a', ms: 1});
    log.add({stage: 'b', ms: 2, page: 3});
    log.add({stage: 'c', ms: 3});
    expect(log.entries()).toEqual([
      {atMs: 5, stage: 'a', ms: 1},
      {atMs: 5, stage: 'b', ms: 2, page: 3},
    ]);
    expect(log.droppedCount()).toBe(1);
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(log.droppedCount()).toBe(0);
  });

  it('sums up each stage and counts events', () => {
    const entries = [
      {atMs: 0, stage: 'page.read', ms: 100},
      {atMs: 1, stage: 'page.cacheHit', ms: null},
      {atMs: 2, stage: 'page.read', ms: 300},
      {atMs: 3, stage: 'page.read', ms: 200},
      {atMs: 4, stage: 'pen.recognize', ms: 40},
      {atMs: 5, stage: 'page.cacheHit', ms: null},
    ];
    expect(summarizePerf(entries)).toEqual([
      {stage: 'page.read', count: 3, totalMs: 600, medianMs: 200, maxMs: 300},
      {stage: 'pen.recognize', count: 1, totalMs: 40, medianMs: 40, maxMs: 40},
    ]);
    expect(countEvents(entries)).toEqual({'page.cacheHit': 2});
  });
});
