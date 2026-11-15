import {
  DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  resolveTextboxImportFolder,
  resolveTextboxImportPath,
} from '../../src/domain/importSettings';

describe('import folders', () => {
  it('reads from the Supernote INBOX folder, spelled as on the device', () => {
    expect(resolveTextboxImportFolder('inbox')).toBe('/storage/emulated/0/INBOX');
    expect(resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, sourceFolder: 'inbox', filename: ' notes.txt '})).toBe(
      '/storage/emulated/0/INBOX/notes.txt',
    );
  });

  it('can read from the plugin folder in MyStyle', () => {
    expect(resolveTextboxImportFolder('myStyle')).toBe('/storage/emulated/0/MyStyle/TextboxHelper/inbox');
  });

  it('needs a file name', () => {
    expect(() => resolveTextboxImportPath({...DEFAULT_TEXTBOX_IMPORT_SETTINGS, filename: '  '})).toThrow('Enter a filename');
  });
});
