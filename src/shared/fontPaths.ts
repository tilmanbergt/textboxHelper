/**
 * Where the measurement finds a readable copy of a textbox font, and the warning shown when it
 * finds none.
 *
 * Textboxes name their font by a path in the NOTE app's own folder
 * (`/storage/emulated/0/.data/fonts/<name>`), which plugins may not open
 * (`docs/dev/supernote-host-facts.md` §4). Fonts the user installed also sit in `MyStyle/fonts/`;
 * for the fonts Ratta ships, a copy can be put in `MyStyle/TextboxHelper/fonts/`, which the NOTE
 * app does not load. Without any readable copy, text is measured in Android's default typeface,
 * so word positions and textbox sizes can be wrong.
 */

export const USER_FONT_DIR = '/storage/emulated/0/MyStyle/fonts';
export const PLUGIN_FONT_DIR = '/storage/emulated/0/MyStyle/TextboxHelper/fonts';
export const PLUGIN_FONT_DIR_LABEL = 'MyStyle/TextboxHelper/fonts';

/** The file name of a font path, e.g. "851tegakizatsu.ttf". */
export function fontFileName(fontPath: string): string {
  return fontPath.split('/').pop() || '';
}

/** Readable places to try, in order, when the textbox's own font path can't be loaded. */
export function buildFontFallbackPaths(fontPath: string): string[] {
  const name = fontFileName(fontPath);
  if (!name) {
    return [];
  }
  return [`${USER_FONT_DIR}/${name}`, `${PLUGIN_FONT_DIR}/${name}`].filter(
    candidate => candidate !== fontPath,
  );
}

/** True when the native measurement fell back to Android's default typeface. */
export function isDefaultTypefaceStatus(typefaceStatus: string | null | undefined): boolean {
  return typeof typefaceStatus === 'string' && typefaceStatus.startsWith('default');
}

/** The user-facing warning for fonts that couldn't be read, or null when there are none. */
export function buildFontWarning(fontPaths: string[]): string | null {
  const names = [...new Set(fontPaths.map(fontFileName).filter(name => name.length > 0))].sort();
  if (names.length === 0) {
    return null;
  }
  const list = names.join(', ');
  const fontWord = names.length === 1 ? 'font' : 'fonts';
  return (
    `Warning: the ${fontWord} ${list} can't be read by plugins, so the text was measured in ` +
    'a standard font. Word positions and textbox sizes may be wrong - check the result. ' +
    `To fix this, copy ${names.length === 1 ? 'the font file' : 'the font files'} to ` +
    `${PLUGIN_FONT_DIR_LABEL} (your own fonts are found in MyStyle/fonts).`
  );
}

/** A message with the font warning appended as its own paragraph, if there is one. */
export function appendFontWarning(message: string, warning: string | null): string {
  return warning ? `${message}\n\n${warning}` : message;
}
