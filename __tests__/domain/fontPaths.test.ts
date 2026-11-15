import {
  appendFontWarning,
  buildFontFallbackPaths,
  buildFontWarning,
  fontFileName,
  isDefaultTypefaceStatus,
} from '../../src/domain/fontPaths';

const NOTE_FONT = '/storage/emulated/0/.data/fonts/851tegakizatsu.ttf';

describe('font paths', () => {
  it('takes the file name from a font path', () => {
    expect(fontFileName(NOTE_FONT)).toBe('851tegakizatsu.ttf');
    expect(fontFileName('')).toBe('');
  });

  it('looks in MyStyle/fonts first, then MyStyle/TextboxHelper/fonts', () => {
    expect(buildFontFallbackPaths(NOTE_FONT)).toEqual([
      '/storage/emulated/0/MyStyle/fonts/851tegakizatsu.ttf',
      '/storage/emulated/0/MyStyle/TextboxHelper/fonts/851tegakizatsu.ttf',
    ]);
  });

  it('does not repeat the original path', () => {
    expect(buildFontFallbackPaths('/storage/emulated/0/MyStyle/fonts/A.ttf')).toEqual([
      '/storage/emulated/0/MyStyle/TextboxHelper/fonts/A.ttf',
    ]);
  });

  it('has no fallbacks for a path without a file name', () => {
    expect(buildFontFallbackPaths('/storage/emulated/0/.data/fonts/')).toEqual([]);
  });

  it('recognizes the default-typeface status', () => {
    expect(isDefaultTypefaceStatus('default: font file missing')).toBe(true);
    expect(isDefaultTypefaceStatus('loaded')).toBe(false);
    expect(isDefaultTypefaceStatus('loaded from /storage/emulated/0/MyStyle/fonts/A.ttf')).toBe(false);
    expect(isDefaultTypefaceStatus(undefined)).toBe(false);
  });
});

describe('font warning', () => {
  it('is null without unreadable fonts', () => {
    expect(buildFontWarning([])).toBeNull();
  });

  it('names one font once, even when it failed several times', () => {
    const warning = buildFontWarning([NOTE_FONT, NOTE_FONT]);
    expect(warning).toContain('the font 851tegakizatsu.ttf can');
    expect(warning).toContain('MyStyle/TextboxHelper/fonts');
    expect(warning?.match(/851tegakizatsu/g)).toHaveLength(1);
  });

  it('names several fonts sorted', () => {
    expect(buildFontWarning(['/x/B.ttf', '/x/A.ttf'])).toContain('the fonts A.ttf, B.ttf can');
  });

  it('is appended as its own paragraph', () => {
    expect(appendFontWarning('Done.', 'Warning: x')).toBe('Done.\n\nWarning: x');
    expect(appendFontWarning('Done.', null)).toBe('Done.');
  });
});
