import {buildClipboardSummary, createBackupPayload} from '../../src/domain/backupPayload';
import {
  buildActionPreview,
  buildTextInsert,
  ensureLayoutFitsPage,
  ensureNoCollision,
} from '../../src/domain/textboxEditPlan';
import type {PageElementData, Rect, TextElementData, TextboxData} from '../../src/domain/textboxModel';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({left, top, right, bottom});

function textbox(uuid: string, text: string, textRect: Rect, overrides: Partial<TextboxData> = {}): TextElementData {
  return {
    uuid,
    type: 500,
    layerNum: 0,
    numInPage: 1,
    title: null,
    link: null,
    picture: null,
    textBox: {
      fontSize: 36,
      fontPath: null,
      textContentFull: text,
      textRect,
      textAlign: 0,
      textBold: 0,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
      ...overrides,
    },
  };
}

const picture = (uuid: string, pictureRect: Rect): PageElementData => ({
  uuid,
  type: 200,
  layerNum: 0,
  numInPage: 2,
  textBox: null,
  title: null,
  link: null,
  picture: {rect: pictureRect},
});

describe('action preview', () => {
  it('offers split, clean and remove line breaks for one textbox', () => {
    const preview = buildActionPreview([textbox('a', 'One sentence here. Two sentences here.', rect(0, 0, 500, 100))], 'split');
    expect(preview.availableActions).toEqual({
      split: true,
      join: false,
      clean: true,
      unwrap: true,
      splitParagraphs: false,
      log: true,
    });
    expect(preview.afterBlocks).toEqual(['One sentence here.', 'Two sentences here.']);
    expect(preview.selectionMessage).toBe('1 textbox selected');
  });

  it('offers join for textboxes in one column, in reading order', () => {
    const preview = buildActionPreview(
      [textbox('b', 'second', rect(0, 200, 500, 300)), textbox('a', 'first', rect(0, 0, 500, 100))],
      'join',
    );
    expect(preview.availableActions.join).toBe(true);
    expect(preview.afterBlocks).toEqual(['first second']);
  });

  it('refuses join for textboxes side by side', () => {
    const preview = buildActionPreview(
      [textbox('a', 'left', rect(0, 0, 200, 100)), textbox('b', 'right', rect(300, 0, 500, 100))],
      'join',
    );
    expect(preview.availableActions.join).toBe(false);
    expect(preview.afterBlocks).toEqual([]);
  });

  it('offers nothing when the selection holds more than textboxes', () => {
    const preview = buildActionPreview([textbox('a', 'text', rect(0, 0, 500, 100)), picture('p', rect(0, 200, 100, 300))], 'clean');
    expect(preview.hasOnlyTextboxes).toBe(false);
    expect(preview.availableActions.clean).toBe(false);
  });
});

describe('new textboxes', () => {
  it('copy the style of the source textbox, with defaults for a missing font', () => {
    const source = textbox('a', 'x', rect(0, 0, 10, 10), {fontSize: 0, fontPath: '/fonts/a.ttf', textBold: 1}).textBox;
    expect(buildTextInsert(source, 'new', rect(1, 2, 3, 4))).toEqual({
      textContentFull: 'new',
      textRect: rect(1, 2, 3, 4),
      fontSize: 32,
      fontPath: '/fonts/a.ttf',
      textAlign: 0,
      textBold: 1,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
    });
  });

  it('must fit on the page and be at least 80 px wide', () => {
    expect(() => ensureLayoutFitsPage([rect(0, 0, 500, 1900)], 1404, 1872)).toThrow('Result would not fit on the current page.');
    expect(() => ensureLayoutFitsPage([rect(0, 0, 79, 100)], 1404, 1872)).toThrow('Textbox width is too small');
    expect(() => ensureLayoutFitsPage([rect(0, 0, 80, 100)], 1404, 1872)).not.toThrow();
  });

  describe('collisions', () => {
    const selected = [textbox('a', 'text', rect(0, 0, 500, 100))];
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('may overlap an element only inside the area the selection already covered', () => {
      const overlapping = picture('p', rect(400, 50, 600, 300));
      expect(() => ensureNoCollision([rect(0, 0, 500, 100)], [selected[0], overlapping], selected)).not.toThrow();
      expect(() => ensureNoCollision([rect(0, 0, 500, 200)], [selected[0], overlapping], selected)).toThrow(
        'Not enough free space around the selection.',
      );
    });

    it('ignores elements on other layers', () => {
      const otherLayer = {...picture('p', rect(0, 150, 500, 300)), layerNum: 1};
      expect(() => ensureNoCollision([rect(0, 0, 500, 200)], [otherLayer], selected)).not.toThrow();
    });
  });
});

describe('backup', () => {
  it('records the original textboxes and summarizes them for the clipboard', () => {
    const payload = createBackupPayload('clean', '/note.note', 3, [textbox('a', 'Hello  world', rect(0, 0, 500, 100))]);
    expect(payload.texts[0]).toMatchObject({uuid: 'a', textContentFull: 'Hello  world', fontSize: 36, fontPath: null});
    const summary = buildClipboardSummary({...payload, createdAt: '2026-11-15T12:00:00.000Z'});
    expect(summary).toBe(
      'textboxHelper clean backup\nCreated: 2026-11-15T12:00:00.000Z\nNote: /note.note\nPage: 3\n\n#1\nHello  world\n',
    );
  });
});
