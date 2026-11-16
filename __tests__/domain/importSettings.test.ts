import {
  DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  IMPORT_FOLDER,
  importPathRelativeToInbox,
  headingsAreBold,
  resolveTextboxImportPath,
  withDefaultLayout,
  withHeadingFontSize,
  withHeadingsBold,
  withParagraphFontSize,
} from '../../src/domain/importSettings';

describe('import file', () => {
  it('reads from the Supernote INBOX folder, spelled as on the device', () => {
    expect(IMPORT_FOLDER).toBe('/storage/emulated/0/INBOX');
    expect(resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filename: ' notes.txt '})).toBe(
      '/storage/emulated/0/INBOX/notes.txt',
    );
    expect(resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filename: 'Obsidian/day.txt'})).toBe(
      '/storage/emulated/0/INBOX/Obsidian/day.txt',
    );
  });

  it('needs a chosen file', () => {
    expect(DEFAULT_TEXTBOX_IMPORT_SETTINGS.filename).toBe('');
    expect(() => resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filename: '  '})).toThrow(
      'Choose a text file first.',
    );
  });

  it('keeps a selector result inside INBOX as a relative path', () => {
    expect(importPathRelativeToInbox('/storage/emulated/0/INBOX/notes.txt')).toBe('notes.txt');
    expect(importPathRelativeToInbox('/storage/emulated/0/INBOX/Obsidian/Day 1.TXT')).toBe('Obsidian/Day 1.TXT');
    expect(importPathRelativeToInbox('/sdcard/Inbox/notes.txt')).toBe('notes.txt');
  });

  it('refuses files outside INBOX and other file types', () => {
    expect(importPathRelativeToInbox('/storage/emulated/0/Document/notes.txt')).toBeNull();
    expect(importPathRelativeToInbox('/storage/emulated/0/INBOX/notes.md')).toBeNull();
    expect(importPathRelativeToInbox('/storage/emulated/0/INBOX/../Note/x.txt')).toBeNull();
    expect(importPathRelativeToInbox('/storage/emulated/0/INBOX/')).toBeNull();
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
    const changed = {...withParagraphFontSize(d, 20), filename: 'a.txt', marginLeft: 5};
    const reset = withDefaultLayout(changed);
    expect(reset.fontSize).toBe(d.fontSize);
    expect(reset.marginLeft).toBe(d.marginLeft);
    expect(reset.filename).toBe('a.txt');
  });
});
