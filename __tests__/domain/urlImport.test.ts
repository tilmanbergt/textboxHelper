import {
  contentTypeProblem,
  copyCandidate,
  decodeUtf8,
  deriveFileName,
  dispositionFileName,
  downloadFailureMessage,
  firstHeading,
  frontmatterTitle,
  normalizeUrl,
  parseContentType,
  pathInFolder,
  safeFileStem,
  serverLine,
  urlFileStem,
} from '../../src/domain/urlImport';
import {MAX_RECENT_URLS, parseRecentUrls, pushRecentUrl, removeRecentUrl} from '../../src/domain/recentUrls';
import {DEFAULT_PLUGIN_SETTINGS, parseSettings, serializeSettings} from '../../src/domain/settingsModel';
import {IMPORT_FOLDER} from '../../src/domain/importSettings';

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('normalizeUrl', () => {
  it('adds http:// when no scheme is given', () => {
    expect(normalizeUrl(' 192.168.1.42:8787/current.md ')).toEqual({
      ok: true,
      url: 'http://192.168.1.42:8787/current.md',
      host: '192.168.1.42:8787',
    });
  });

  it('keeps http and https, lower-cases only the scheme', () => {
    expect(normalizeUrl('HTTPS://example.org/Notes/Draft.TXT')).toEqual({
      ok: true,
      url: 'https://example.org/Notes/Draft.TXT',
      host: 'example.org',
    });
    expect(normalizeUrl('http://phone.local:8787/current.md')).toMatchObject({ok: true, host: 'phone.local:8787'});
  });

  it('refuses other schemes, spaces, empty input and a missing host', () => {
    expect(normalizeUrl('ftp://example.org/a.txt')).toMatchObject({ok: false});
    expect(normalizeUrl('file:///sdcard/a.txt')).toMatchObject({ok: false});
    expect(normalizeUrl('mailto:me@example.org')).toMatchObject({ok: false});
    expect(normalizeUrl('http://exa mple.org')).toMatchObject({ok: false});
    expect(normalizeUrl('   ')).toMatchObject({ok: false});
    expect(normalizeUrl('http:///path')).toMatchObject({ok: false});
  });
});

describe('content type', () => {
  it('parses type and charset', () => {
    expect(parseContentType('text/markdown; charset=UTF-8')).toEqual({type: 'text/markdown', charset: 'utf-8'});
    expect(parseContentType('Text/Plain')).toEqual({type: 'text/plain', charset: null});
    expect(parseContentType(null)).toEqual({type: null, charset: null});
  });

  it('accepts plain text and Markdown in UTF-8', () => {
    expect(contentTypeProblem('text/markdown; charset=utf-8', '# Hi')).toBeNull();
    expect(contentTypeProblem('text/plain', 'Hi')).toBeNull();
    expect(contentTypeProblem('text/x-markdown', 'Hi')).toBeNull();
    expect(contentTypeProblem('text/plain; charset=us-ascii', 'Hi')).toBeNull();
  });

  it('accepts a missing type only for UTF-8 text without NUL', () => {
    expect(contentTypeProblem(null, 'Hi')).toBeNull();
    expect(contentTypeProblem('', 'Hi')).toBeNull();
    expect(contentTypeProblem(null, null)).toMatch(/not UTF-8/);
    expect(contentTypeProblem(null, 'a\u0000b')).toMatch(/not UTF-8/);
  });

  it('refuses web pages, other types and other charsets', () => {
    expect(contentTypeProblem('text/html; charset=utf-8', '<p>')).toMatch(/web page/);
    expect(contentTypeProblem('application/pdf', 'x')).toMatch(/application\/pdf/);
    expect(contentTypeProblem('application/json', '{}')).toMatch(/not text or Markdown/);
    expect(contentTypeProblem('text/plain; charset=iso-8859-1', 'x')).toMatch(/not UTF-8/);
  });
});

describe('decodeUtf8', () => {
  it('decodes text with umlauts, emoji and a BOM', () => {
    expect(decodeUtf8(utf8('Grüße – 👋'))).toBe('Grüße – 👋');
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeUtf8(new Uint8Array([]))).toBe('');
  });

  it('refuses invalid, overlong, surrogate and cut-off sequences', () => {
    expect(decodeUtf8(new Uint8Array([0xff]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xc0, 0x80]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xe0, 0x80, 0x80]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xe2, 0x82]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0x41, 0x80]))).toBeNull();
  });

  it('decodes long bodies', () => {
    const text = 'Absatz mit ä. '.repeat(2000);
    expect(decodeUtf8(utf8(text))).toBe(text);
  });
});

describe('file name', () => {
  it('reads filename* first, then filename', () => {
    expect(dispositionFileName(`attachment; filename="Walk notes.md"; filename*=UTF-8''Spaziergang%20Gr%C3%BC%C3%9Fe.md`)).toBe(
      'Spaziergang Grüße.md',
    );
    expect(dispositionFileName('attachment; filename="Walk \\"notes\\".md"')).toBe('Walk "notes".md');
    expect(dispositionFileName('attachment; filename=plain.md')).toBe('plain.md');
    expect(dispositionFileName('inline')).toBeNull();
    expect(dispositionFileName(null)).toBeNull();
  });

  it('reads the frontmatter title, quoted or plain', () => {
    expect(frontmatterTitle('---\ntitle: "Walk: \\"notes\\""\ncreated: x\n---\n# Other')).toBe('Walk: "notes"');
    expect(frontmatterTitle("---\ntitle: 'It''s here'\n---")).toBe("It's here");
    expect(frontmatterTitle('---\ntitle: Plain title\n---')).toBe('Plain title');
    expect(frontmatterTitle('---\ncreated: x\n---\ntitle: not this')).toBeNull();
    expect(frontmatterTitle('title: no frontmatter')).toBeNull();
  });

  it('reads the first # heading and the address stem', () => {
    expect(firstHeading('Intro\n## Sub\n# Main title #\n# Second')).toBe('Main title');
    expect(firstHeading('no heading')).toBeNull();
    expect(urlFileStem('http://h:8787/a/current.md?x=1')).toBe('current');
    expect(urlFileStem('http://h/Gr%C3%BC%C3%9Fe.txt')).toBe('Grüße');
    expect(urlFileStem('http://h/')).toBeNull();
  });

  it('makes names safe and short, keeping letters of any script', () => {
    expect(safeFileStem('a/b\\c: d*?"<>|')).toBe('a-b-c d');
    expect(safeFileStem('  ..Grüße  aus\tKöln..  ')).toBe('Grüße aus Köln');
    expect(safeFileStem('x'.repeat(80))).toHaveLength(60);
    expect(safeFileStem('???')).toBe('');
  });

  it('derives in order: header, frontmatter, heading, address, "download"', () => {
    const body = '---\ntitle: "Front"\n---\n# Heading\n';
    expect(deriveFileName('attachment; filename="Header.md"', body, 'http://h/x.md')).toBe('Header.txt');
    expect(deriveFileName(null, body, 'http://h/x.md')).toBe('Front.txt');
    expect(deriveFileName(null, '# Heading\n', 'http://h/x.md')).toBe('Heading.txt');
    expect(deriveFileName(null, 'text', 'http://h/notes.md')).toBe('notes.txt');
    expect(deriveFileName('attachment; filename="???"', 'text', 'http://h/')).toBe('download.txt');
  });
});

describe('messages and paths', () => {
  it('shows the server status and its first line', () => {
    expect(downloadFailureMessage({kind: 'http', status: 404, text: 'No session is shared right now.\n'})).toBe(
      '404 · No session is shared right now.',
    );
    expect(downloadFailureMessage({kind: 'http', status: 500, text: null})).toMatch(/500/);
    expect(downloadFailureMessage({kind: 'timeout'})).toMatch(/15 s.*same Wi-Fi/);
    expect(downloadFailureMessage({kind: 'tooLarge'})).toMatch(/2 MB/);
    expect(serverLine('x'.repeat(200))).toHaveLength(120);
  });

  it('names copies so nothing is overwritten', () => {
    const now = new Date(2026, 10, 27, 10, 12);
    const path = '/storage/emulated/0/INBOX/Walk notes.txt';
    expect(copyCandidate(path, now, 0)).toBe(path);
    expect(copyCandidate(path, now, 1)).toBe('/storage/emulated/0/INBOX/Walk notes (Supernote 2026-11-27 1012).txt');
    expect(copyCandidate(path, now, 3)).toBe('/storage/emulated/0/INBOX/Walk notes (Supernote 2026-11-27 1012 3).txt');
  });

  it('joins folder and name with one slash', () => {
    expect(pathInFolder('/storage/emulated/0/INBOX/', 'a.txt')).toBe('/storage/emulated/0/INBOX/a.txt');
    expect(pathInFolder('/storage/emulated/0/INBOX', 'a.txt')).toBe('/storage/emulated/0/INBOX/a.txt');
  });
});

describe('recent URLs', () => {
  it('keeps newest first, each once, at most five', () => {
    let list: string[] = [];
    for (const url of ['a', 'b', 'c', 'd', 'e', 'f']) {
      list = pushRecentUrl(list, url);
    }
    expect(list).toEqual(['f', 'e', 'd', 'c', 'b']);
    expect(pushRecentUrl(list, 'c')).toEqual(['c', 'f', 'e', 'd', 'b']);
    expect(removeRecentUrl(list, 'e')).toEqual(['f', 'd', 'c', 'b']);
    expect(MAX_RECENT_URLS).toBe(5);
  });

  it('reads only usable stored entries', () => {
    expect(parseRecentUrls(['a', 3, ' ', 'a', ' b '])).toEqual(['a', 'b']);
    expect(parseRecentUrls('a')).toEqual([]);
    expect(parseRecentUrls(['1', '2', '3', '4', '5', '6'])).toHaveLength(5);
  });

  it('is stored in the settings, field by field', () => {
    expect(parseSettings(null).urlImport).toEqual({recentUrls: [], targetFolder: IMPORT_FOLDER});
    const saved = {...DEFAULT_PLUGIN_SETTINGS, urlImport: {recentUrls: ['http://h/a.md'], targetFolder: '/storage/emulated/0/Document'}};
    expect(parseSettings(serializeSettings(saved)).urlImport).toEqual(saved.urlImport);
    expect(parseSettings('{"urlImport":{"recentUrls":["x"],"targetFolder":"relative"}}').urlImport).toEqual({
      recentUrls: ['x'],
      targetFolder: IMPORT_FOLDER,
    });
  });
});
