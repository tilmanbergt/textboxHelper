import {buildStrokeStats, isReplaceLoopRect} from '../../src/domain/markerStrokes';
import {
  activePenEditsOnPage,
  parsePenEditIndex,
  penEditText,
  serializePenEditIndex,
  takenStrikeRects,
  updatePenEdit,
  upsertPenEdit,
  WAITING_RECOGNITION,
  type PenEditEntry,
} from '../../src/domain/penEditModel';
import {findReplaceMarkInWindow, lookBackNumbers, strokeStatsFromRect, type WindowStroke} from '../../src/domain/penEditPairing';
import {
  badgeNumberRect,
  boundsOfPoints,
  circlePolygon,
  isPenEditDecoration,
  isPenEditElement,
  looksLikePenEditNumber,
  markBadgeRect,
  newPenEditId,
  nextPenEditNumber,
  parsePenEditUserData,
  penEditUserData,
  snippetBadgePolygon,
  snippetBadgeRect,
} from '../../src/domain/penEditTags';
import {matchByRects, rectShift, rectsMatch} from '../../src/domain/penEditMatching';
import {normalizeRecognizedText} from '../../src/domain/penEditText';
import {isNormalTextElement} from '../../src/domain/textboxEditPlan';
import type {PageElementData, Rect} from '../../src/domain/textboxModel';

const ID = 'pe-20261118-145501-042';

describe('pen edit ids and userData', () => {
  it('builds an id from local time and three random digits', () => {
    expect(newPenEditId(new Date(2026, 10, 18, 14, 55, 1), () => 0.042)).toBe(ID);
  });

  it('round-trips userData for every role', () => {
    for (const role of ['snippet', 'snippetnum', 'markring', 'marknum', 'stroke', 'mark'] as const) {
      expect(parsePenEditUserData(penEditUserData(ID, role))).toEqual({id: ID, role});
    }
  });

  it('rejects foreign or broken userData', () => {
    expect(parsePenEditUserData('gtdpara:mark:m-20261005-104212-351')).toBeNull();
    expect(parsePenEditUserData(`tbh:pe:${ID}:other`)).toBeNull();
    expect(parsePenEditUserData('tbh:pe:not-an-id:snippet')).toBeNull();
    expect(parsePenEditUserData(null)).toBeNull();
    expect(isPenEditElement({userData: penEditUserData(ID, 'snippet')})).toBe(true);
    expect(isPenEditElement({userData: ''})).toBe(false);
    expect(isPenEditDecoration({userData: penEditUserData(ID, 'markring')})).toBe(true);
    expect(isPenEditDecoration({userData: penEditUserData(ID, 'stroke')})).toBe(false);
  });
});

describe('pen edit numbers and icon', () => {
  it('counts on from the highest number in use', () => {
    expect(nextPenEditNumber([])).toBe(1);
    expect(nextPenEditNumber([1, 4, 2])).toBe(5);
  });

  it('recognizes a number textbox by its look', () => {
    expect(looksLikePenEditNumber('3', 20)).toBe(true);
    expect(looksLikePenEditNumber(' 12 ', 24)).toBe(true);
    expect(looksLikePenEditNumber('3', 36)).toBe(false);
    expect(looksLikePenEditNumber('123', 20)).toBe(false);
    expect(looksLikePenEditNumber('3.', 20)).toBe(false);
  });

  it('puts the snippet badge left of the snippet, centred on its height', () => {
    expect(snippetBadgeRect({left: 400, top: 770, right: 650, bottom: 860})).toEqual({left: 344, top: 791, right: 392, bottom: 839});
  });

  it('puts the badge inside the lasso when there is no room on the left', () => {
    expect(snippetBadgeRect({left: 30, top: 200, right: 400, bottom: 300})).toEqual({left: 34, top: 204, right: 82, bottom: 252});
    expect(snippetBadgeRect({left: 0, top: 0, right: 20, bottom: 10})).toEqual({left: 4, top: 0, right: 14, bottom: 10});
  });

  it('closes the badge outlines and keeps them in their box', () => {
    const box = {left: 0, top: 0, right: 48, bottom: 48};
    for (const points of [circlePolygon(box), snippetBadgePolygon(box)]) {
      expect(points[0]).toEqual(points[points.length - 1]);
      expect(boundsOfPoints(points)).toEqual(box);
    }
  });

  it('centres the mark badge over the vertical lines, its bottom on their tops', () => {
    const verticals = [
      {left: 463, top: 189, right: 475, bottom: 234},
      {left: 478, top: 186, right: 492, bottom: 249},
    ];
    const strike = {left: 390, top: 208, right: 564, bottom: 219};
    expect(markBadgeRect(verticals, strike, 1404)).toEqual({left: 453, top: 138, right: 501, bottom: 186});
    expect(markBadgeRect([], strike, 1404)).toEqual({left: 453, top: 160, right: 501, bottom: 208});
    expect(markBadgeRect([{left: 1390, top: 100, right: 1400, bottom: 140}], strike, 1404).right).toBe(1404);
  });

  it('centres the digits, allowing for where NOTE draws a textbox\'s text', () => {
    const badge = {left: 995, top: 111, right: 1043, bottom: 159};
    expect(badgeNumberRect(badge, 6)).toMatchObject({left: 999, top: 119});
    expect(badgeNumberRect(badge, 12).left).toBe(991);
  });
});

describe('isNormalTextElement skips pen-edit numbers', () => {
  const textbox = (text: string, fontSize: number, userData?: string): PageElementData => ({
    uuid: 'u',
    type: 500,
    layerNum: 0,
    numInPage: 1,
    textBox: {
      fontSize,
      fontPath: null,
      textContentFull: text,
      textRect: {left: 0, top: 0, right: 40, bottom: 30},
      textAlign: 0,
      textBold: 0,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
    },
    title: null,
    link: null,
    picture: null,
    geometry: null,
    userData,
  });

  it('by userData and by look', () => {
    expect(isNormalTextElement(textbox('3', 20, penEditUserData(ID, 'marknum')))).toBe(false);
    expect(isNormalTextElement(textbox('3', 20))).toBe(false);
    expect(isNormalTextElement(textbox('3', 36))).toBe(true);
    expect(isNormalTextElement(textbox('A sentence.', 20))).toBe(true);
  });
});

const entry = (overrides: Partial<PenEditEntry> = {}): PenEditEntry => ({
  id: ID,
  kind: 'replacement',
  notePath: '/storage/emulated/0/Note/a.note',
  page: 2,
  number: 1,
  createdAt: '2026-11-18T13:55:01.000Z',
  rect: {left: 1, top: 2, right: 3, bottom: 4},
  strokeRects: [{left: 1, top: 2, right: 3, bottom: 4}],
  iconRect: {left: 1, top: 2, right: 49, bottom: 50},
  strokesTagged: true,
  mark: {kind: 'replace', strikeRect: {left: 10, top: 20, right: 200, bottom: 30}, modifierRects: []},
  hasPicture: true,
  recognition: WAITING_RECOGNITION,
  correctedText: null,
  state: 'active',
  awaitingMark: null,
  edges: null,
  ...overrides,
});

describe('pen edit index', () => {
  it('round-trips', () => {
    const index = upsertPenEdit({version: 1, entries: []}, entry());
    expect(parsePenEditIndex(serializePenEditIndex(index))).toEqual({index, broken: false, dropped: 0});
  });

  it('treats a missing file as empty and junk as broken', () => {
    expect(parsePenEditIndex(null)).toEqual({index: {version: 1, entries: []}, broken: false, dropped: 0});
    expect(parsePenEditIndex('{nope').broken).toBe(true);
    expect(parsePenEditIndex('{"version": 99, "entries": []}').broken).toBe(true);
  });

  it('drops unreadable entries and counts them', () => {
    const json = JSON.stringify({version: 1, entries: [entry(), {id: 'x'}]});
    const parsed = parsePenEditIndex(json);
    expect(parsed.index.entries).toHaveLength(1);
    expect(parsed.dropped).toBe(1);
  });

  it('fills defaults for optional fields', () => {
    const {recognition, state, mark, ...required} = entry();
    void recognition;
    void state;
    void mark;
    const parsed = parsePenEditIndex(JSON.stringify({version: 1, entries: [required]})).index.entries[0];
    expect(parsed.recognition).toEqual(WAITING_RECOGNITION);
    expect(parsed.state).toBe('active');
    expect(parsed.mark).toBeNull();
  });

  it('upserts, updates and filters', () => {
    let index = upsertPenEdit({version: 1, entries: []}, entry());
    index = upsertPenEdit(index, entry({id: 'pe-20261118-145502-001', page: 3}));
    index = upsertPenEdit(index, entry({number: 7}));
    expect(index.entries).toHaveLength(2);
    index = updatePenEdit(index, ID, e => ({...e, state: 'applied'}));
    expect(activePenEditsOnPage(index, entry().notePath, 2)).toHaveLength(0);
    expect(activePenEditsOnPage(index, entry().notePath, 3)).toHaveLength(1);
    expect(takenStrikeRects(index, entry().notePath, 3)).toEqual([{left: 10, top: 20, right: 200, bottom: 30}]);
  });

  it('takes the correction over the recognition', () => {
    expect(penEditText(entry())).toBe('');
    expect(penEditText(entry({recognition: {status: 'done', text: 'new', error: null, ms: 1}}))).toBe('new');
    expect(penEditText(entry({recognition: {status: 'done', text: 'new', error: null, ms: 1}, correctedText: 'fixed'}))).toBe('fixed');
  });
});

describe('look-back pairing', () => {
  const stroke = (uuid: string, numInPage: number, points: Array<[number, number]>, isStraightLine = false): WindowStroke => ({
    uuid,
    numInPage,
    isStraightLine,
    stats: buildStrokeStats(points.map(([x, y]) => ({x, y})))!,
  });
  const strike = (uuid: string, num: number, line = false) => stroke(uuid, num, [[300, 500], [420, 502], [520, 501]], line);
  const vertical = (uuid: string, num: number, x: number) => stroke(uuid, num, [[x, 480], [x + 2, 522]]);

  it('reads the numbers just before the snippet', () => {
    expect(lookBackNumbers(20)).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    expect(lookBackNumbers(3)).toEqual([2, 1]);
    expect(lookBackNumbers(1)).toEqual([]);
  });

  it('finds a strike with two crossing verticals', () => {
    const window = [strike('k', 7), vertical('v1', 8, 400), vertical('v2', 9, 430)];
    expect(findReplaceMarkInWindow(window, [])).toMatchObject({strike: {uuid: 'k'}, modifiers: [{uuid: 'v1'}, {uuid: 'v2'}]});
  });

  it('accepts a straight-line strike', () => {
    const window = [strike('k', 7, true), vertical('v1', 8, 400), vertical('v2', 9, 430)];
    expect(findReplaceMarkInWindow(window, [])?.strike.uuid).toBe('k');
  });

  it('takes the newest mark and skips strikes already paired', () => {
    const older = [strike('old', 2), vertical('o1', 3, 400), vertical('o2', 4, 430)];
    const newer = [strike('new', 5), vertical('n1', 6, 400), vertical('n2', 7, 430)];
    expect(findReplaceMarkInWindow([...older, ...newer], [])?.strike.uuid).toBe('new');
    // The newer strike lies where an earlier tag already paired one.
    const newerAt = newer[0].stats.rect;
    expect(findReplaceMarkInWindow(newer, [newerAt])).toBeNull();
  });

  it('needs two verticals that cross the strike and are close together', () => {
    expect(findReplaceMarkInWindow([strike('k', 7), vertical('v1', 8, 400)], [])).toBeNull();
    const notCrossing = stroke('v2', 9, [[430, 540], [432, 580]]);
    expect(findReplaceMarkInWindow([strike('k', 7), vertical('v1', 8, 400), notCrossing], [])).toBeNull();
    expect(findReplaceMarkInWindow([strike('k', 7), vertical('v1', 8, 320), vertical('v2', 9, 500)], [])).toBeNull();
  });

  it('pairs from recognize rects alone (the device test page)', () => {
    const fromRect = (uuid: string, num: number, rect: Rect): WindowStroke => ({
      uuid,
      numInPage: num,
      isStraightLine: false,
      stats: strokeStatsFromRect(rect)!,
    });
    const window = [
      fromRect('strike', 29, {left: 600, top: 808, right: 972, bottom: 820}),
      fromRect('v1', 30, {left: 790, top: 789, right: 807, bottom: 833}),
      fromRect('v2', 31, {left: 800, top: 786, right: 817, bottom: 827}),
      fromRect('n', 25, {left: 594, top: 1279, right: 605, bottom: 1286}),
    ];
    expect(findReplaceMarkInWindow(window, [])).toMatchObject({strike: {uuid: 'strike'}, modifiers: [{uuid: 'v1'}, {uuid: 'v2'}]});
  });

  it('ignores a plain delete stroke and handwriting', () => {
    const word = stroke('w', 6, [[300, 480], [310, 520], [320, 480], [330, 520]]);
    expect(findReplaceMarkInWindow([strike('k', 7), word], [])).toBeNull();
  });
});

describe('normalizeRecognizedText', () => {
  it('joins handwritten lines with spaces', () => {
    expect(normalizeRecognizedText('a new\nsentence  here\n')).toBe('a new sentence here');
  });

  it('joins a word split at the line end', () => {
    expect(normalizeRecognizedText('the replace-\nment text')).toBe('the replacement text');
    expect(normalizeRecognizedText('well-\nKnown')).toBe('well- Known');
  });

  it('handles empty input', () => {
    expect(normalizeRecognizedText(' \n ')).toBe('');
  });
});

describe('finding pen edits again by place', () => {
  it('matches rects within the tolerance', () => {
    expect(rectsMatch({left: 0, top: 0, right: 10, bottom: 10}, {left: 6, top: -6, right: 16, bottom: 4})).toBe(true);
    expect(rectsMatch({left: 0, top: 0, right: 10, bottom: 10}, {left: 9, top: 0, right: 19, bottom: 10})).toBe(false);
  });

  it('follows a snippet moved with its badge, each stroke once', () => {
    const shift = rectShift({left: 100, top: 100, right: 148, bottom: 148}, {left: 130, top: 400, right: 178, bottom: 448});
    expect(shift).toEqual({dx: 30, dy: 300});
    const items = [
      {key: 'a', rect: {left: 130, top: 410, right: 160, bottom: 450}},
      {key: 'b', rect: {left: 165, top: 412, right: 200, bottom: 452}},
      {key: 'far', rect: {left: 600, top: 410, right: 630, bottom: 450}},
      {key: 'none', rect: null},
    ];
    const stored = [
      {left: 100, top: 110, right: 130, bottom: 150},
      {left: 135, top: 112, right: 170, bottom: 152},
    ];
    expect(matchByRects(stored, items, shift).map(item => item.key)).toEqual(['a', 'b']);
    expect(matchByRects(stored, items).map(item => item.key)).toEqual([]);
  });
});

describe('the loop after a strike', () => {
  const strike = {left: 600, top: 808, right: 972, bottom: 820};

  it('counts a small round loop right after the strike end', () => {
    expect(isReplaceLoopRect(strike, {left: 975, top: 790, right: 1015, bottom: 832})).toBe(true);
    expect(isReplaceLoopRect(strike, {left: 955, top: 795, right: 990, bottom: 830})).toBe(true);
  });

  it('counts a loop above the line along the strike', () => {
    expect(isReplaceLoopRect(strike, {left: 760, top: 740, right: 800, bottom: 780})).toBe(true);
    expect(isReplaceLoopRect(strike, {left: 980, top: 750, right: 1020, bottom: 790})).toBe(true);
  });

  it('ignores loops elsewhere, too big, too flat or too small', () => {
    expect(isReplaceLoopRect(strike, {left: 700, top: 815, right: 740, bottom: 855})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 500, top: 740, right: 540, bottom: 780})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 760, top: 620, right: 800, bottom: 660})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 975, top: 900, right: 1015, bottom: 940})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 975, top: 760, right: 1135, bottom: 900})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 975, top: 805, right: 1035, bottom: 815})).toBe(false);
    expect(isReplaceLoopRect(strike, {left: 975, top: 810, right: 985, bottom: 818})).toBe(false);
  });

  it('pairs a strike with the loop drawn after it in the look-back', () => {
    const stroke = (uuid: string, numInPage: number, rect: Rect): WindowStroke => ({
      uuid,
      numInPage,
      isStraightLine: false,
      stats: strokeStatsFromRect(rect)!,
    });
    const found = findReplaceMarkInWindow(
      [stroke('strike', 10, strike), stroke('loop', 11, {left: 975, top: 790, right: 1015, bottom: 832})],
      [],
    );
    expect(found?.strike.uuid).toBe('strike');
    expect(found?.loop?.uuid).toBe('loop');
    // A loop drawn before the strike is not its mark.
    expect(
      findReplaceMarkInWindow([stroke('strike', 10, strike), stroke('loop', 9, {left: 975, top: 790, right: 1015, bottom: 832})], []),
    ).toBeNull();
  });
});
