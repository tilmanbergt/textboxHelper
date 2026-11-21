import {
  DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  IMPORT_FOLDER,
  chosenTextFilePath,
  headingsAreBold,
  importStartFolder,
  isLinkedImport,
  pathFromInboxRelative,
  resolveTextboxImportPath,
  withDefaultLayout,
  withHeadingFontSize,
  withHeadingsBold,
  withParagraphFontSize,
} from '../../src/domain/importSettings';

describe('import file', () => {
  it('reads the chosen file from wherever it is', () => {
    expect(resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filePath: ' /storage/emulated/0/Document/a.txt '})).toBe(
      '/storage/emulated/0/Document/a.txt',
    );
  });

  it('needs a chosen file', () => {
    expect(DEFAULT_TEXTBOX_IMPORT_SETTINGS.filePath).toBe('');
    expect(() => resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filePath: '  '})).toThrow(
      'Choose a text file first.',
    );
  });

  it('takes .txt paths from the file selector and refuses others', () => {
    expect(chosenTextFilePath('/storage/emulated/0/INBOX//Obsidian/Day 1.TXT')).toBe('/storage/emulated/0/INBOX/Obsidian/Day 1.TXT');
    expect(chosenTextFilePath('/storage/emulated/0/Document/notes.txt')).toBe('/storage/emulated/0/Document/notes.txt');
    expect(chosenTextFilePath('/storage/emulated/0/INBOX/notes.md')).toBeNull();
    expect(chosenTextFilePath('/storage/emulated/0/INBOX/../Note/x.txt')).toBeNull();
    expect(chosenTextFilePath('notes.txt')).toBeNull();
    expect(chosenTextFilePath('/storage/emulated/0/INBOX/.txt')).toBeNull();
  });

  it('opens the selector in the last file\'s folder, else INBOX', () => {
    expect(IMPORT_FOLDER).toBe('/storage/emulated/0/INBOX');
    expect(importStartFolder('/storage/emulated/0/Document/x/a.txt')).toBe('/storage/emulated/0/Document/x');
    expect(importStartFolder('')).toBe(IMPORT_FOLDER);
  });

  it('reads an older INBOX-relative path', () => {
    expect(pathFromInboxRelative('Obsidian/day.txt')).toBe('/storage/emulated/0/INBOX/Obsidian/day.txt');
    expect(pathFromInboxRelative('  ')).toBe('');
  });

  it('links only paragraph boxes', () => {
    const d = DEFAULT_TEXTBOX_IMPORT_SETTINGS;
    const boxes = {...d, structure: {...d.structure, layoutMode: 'paragraphTextboxes' as const}};
    expect(d.linkToFile).toBe(true);
    expect(isLinkedImport(d)).toBe(false);
    expect(isLinkedImport(boxes)).toBe(true);
    expect(isLinkedImport({...boxes, linkToFile: false})).toBe(false);
  });
});

describe('import setting changes', () => {
  const d = DEFAULT_TEXTBOX_IMPORT_SETTINGS;

  it('keeps both paragraph font sizes in step', () => {
    const next = withParagraphFontSize(d, 30);
    expect(next.fontSize).toBe(30);
    expect(next.structure.paragraph.fontSize).toBe(30);
  });

  it('sets one heading size and all heading weights', () => {
    expect(withHeadingFontSize(d, 'heading2', 44).structure.heading2.fontSize).toBe(44);
    expect(headingsAreBold(d)).toBe(true);
    expect(headingsAreBold(withHeadingsBold(d, false))).toBe(false);
  });

  it('resets font size and margins but keeps the file', () => {
    const changed = {...withParagraphFontSize(d, 20), filePath: '/x/a.txt', marginLeft: 5};
    const reset = withDefaultLayout(changed);
    expect(reset.fontSize).toBe(d.fontSize);
    expect(reset.marginLeft).toBe(d.marginLeft);
    expect(reset.filePath).toBe('/x/a.txt');
  });
});
