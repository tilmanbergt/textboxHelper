/**
 * The rules of Import from URL (technical-design-import-from-url.md §4): which addresses are
 * accepted, which answers count as text, how the downloaded file is named and what an error says.
 * Pure: the download itself is `supernote/httpFetch.ts`, the flow `actions/urlImport.ts`.
 */

export const URL_IMPORT_TIMEOUT_MS = 15000;
export const URL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** File names are cut here: long enough for a title, short enough for the file list. */
export const MAX_FILE_NAME_LENGTH = 60;
const FALLBACK_NAME = 'download';
const SERVER_TEXT_LENGTH = 120;

export type NormalizedUrl = {ok: true; url: string; host: string} | {ok: false; message: string};

const URL_EXAMPLE = 'http://192.168.1.42:8787/current.md';

/**
 * The address as it will be requested: trimmed, `http://` added when no scheme is given; only
 * http and https, and a host is needed. The rest is kept as typed (a path is case-sensitive).
 */
export function normalizeUrl(raw: string): NormalizedUrl {
  const typed = raw.trim();
  if (!typed) {
    return {ok: false, message: `Enter an address like ${URL_EXAMPLE}.`};
  }
  if (/\s/.test(typed)) {
    return {ok: false, message: 'The address contains a space.'};
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(typed);
  if (!scheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(typed)) {
    return {ok: false, message: 'Only http:// and https:// addresses can be downloaded.'};
  }
  if (scheme && !['http', 'https'].includes(scheme[1].toLowerCase())) {
    return {ok: false, message: 'Only http:// and https:// addresses can be downloaded.'};
  }
  const url = scheme ? `${scheme[1].toLowerCase()}${typed.slice(scheme[1].length)}` : `http://${typed}`;
  const authority = /^https?:\/\/([^/?#]*)/.exec(url)?.[1] ?? '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const host = hostPort.startsWith('[') ? hostPort.slice(0, hostPort.indexOf(']') + 1) : hostPort.split(':')[0];
  if (!host) {
    return {ok: false, message: `Enter an address like ${URL_EXAMPLE}.`};
  }
  return {ok: true, url, host: hostPort};
}

/** The media type (lower case, no parameters) and the charset of a Content-Type header. */
export function parseContentType(header: string | null): {type: string | null; charset: string | null} {
  if (!header || !header.trim()) {
    return {type: null, charset: null};
  }
  const [type, ...params] = header.split(';');
  let charset: string | null = null;
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key?.trim().toLowerCase() === 'charset' && value) {
      charset = value.trim().replace(/^"|"$/g, '').toLowerCase();
    }
  }
  return {type: type.trim().toLowerCase() || null, charset};
}

const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'];
const UTF8_CHARSETS = ['utf-8', 'utf8', 'us-ascii'];

/**
 * Null when the answer is text Manuscript can import, else the message why not. `text` is the body
 * decoded as UTF-8, or null when it isn't valid UTF-8. A missing type is accepted for text without
 * NUL characters, since simple servers often send none.
 */
export function contentTypeProblem(header: string | null, text: string | null): string | null {
  const {type, charset} = parseContentType(header);
  if (type === 'text/html' || type === 'application/xhtml+xml') {
    return 'This is a web page, not a text file. Nothing was saved.';
  }
  if (type && !TEXT_TYPES.includes(type)) {
    return `This is ${type}, not text or Markdown. Nothing was saved.`;
  }
  if ((charset && !UTF8_CHARSETS.includes(charset)) || text === null || text.includes('\u0000')) {
    return 'This file is not UTF-8 text. Nothing was saved.';
  }
  return null;
}

/**
 * Decodes UTF-8 strictly: null for any invalid sequence (overlong forms, surrogates, cut-off
 * characters), so a binary file is refused instead of imported as garbage. A leading BOM is dropped.
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  let i = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const parts: string[] = [];
  let chunk: number[] = [];
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    let extra: number;
    let min: number;
    if (b < 0x80) {
      code = b;
      extra = 0;
      min = 0;
    } else if (b >= 0xc2 && b <= 0xdf) {
      code = b - 0xc0;
      extra = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      code = b - 0xe0;
      extra = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      code = b - 0xf0;
      extra = 3;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || next < 0x80 || next > 0xbf) {
        return null;
      }
      code = code * 64 + (next - 0x80);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return null;
    }
    chunk.push(code);
    if (chunk.length >= 4096) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
    i += extra + 1;
  }
  parts.push(String.fromCodePoint(...chunk));
  return parts.join('');
}

function percentDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The file name a Content-Disposition header gives: `filename*` (UTF-8) first, then `filename`. */
export function dispositionFileName(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended && ['utf-8', 'utf8', ''].includes(extended[1].trim().toLowerCase())) {
    const decoded = percentDecode(extended[2].trim().replace(/^"|"$/g, ''));
    if (decoded) {
      return decoded;
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) {
    return quoted[1].replace(/\\(.)/g, '$1');
  }
  const plain = /filename\s*=\s*([^;\s]+)/i.exec(header);
  return plain ? plain[1] : null;
}

/** The `title:` of a YAML frontmatter block at the very start, unquoted; null without one. */
export function frontmatterTitle(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return null;
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---' || line.trim() === '...') {
      return null;
    }
    const match = /^title\s*:\s*(.*)$/.exec(line);
    if (match) {
      const value = match[1].trim();
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
      }
      if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        return value.slice(1, -1).replace(/''/g, "'");
      }
      return value || null;
    }
  }
  return null;
}

/** The text of the first `# ` heading; null without one. */
export function firstHeading(text: string): string | null {
  const match = /^#[ \t]+(.+?)[ \t#]*$/m.exec(text);
  return match ? match[1] : null;
}

/** The last path segment of the address, percent-decoded, without its extension. */
export function urlFileStem(url: string): string | null {
  const path = url.replace(/^[a-z]+:\/\/[^/]*/i, '').split(/[?#]/)[0];
  const segment = path.split('/').filter(Boolean).pop();
  if (!segment) {
    return null;
  }
  const decoded = percentDecode(segment) ?? segment;
  const dot = decoded.lastIndexOf('.');
  return dot > 0 ? decoded.slice(0, dot) : decoded;
}

/**
 * A name the Supernote's file system takes: no folder separators, control or reserved characters,
 * no leading or trailing dots or spaces, at most 60 characters. Letters of any script stay.
 * Empty when nothing usable is left.
 */
export function safeFileStem(name: string): string {
  const printable = Array.from(name, ch => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch)).join('');
  const cleaned = printable
    .replace(/[/\\]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const characters = Array.from(cleaned);
  return characters.length > MAX_FILE_NAME_LENGTH
    ? characters.slice(0, MAX_FILE_NAME_LENGTH).join('').replace(/[.\s]+$/g, '')
    : cleaned;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && /^\.[a-z0-9]{1,8}$/i.test(name.slice(dot)) ? name.slice(0, dot) : name;
}

/**
 * The name for the saved file (always `.txt`): the server's file name, else the frontmatter
 * title, else the first `# ` heading, else the address's last segment, else "download".
 */
export function deriveFileName(disposition: string | null, text: string, url: string): string {
  const candidates = [
    (() => {
      const name = dispositionFileName(disposition);
      return name ? stemOf(name) : null;
    })(),
    frontmatterTitle(text),
    firstHeading(text),
    urlFileStem(url),
  ];
  for (const candidate of candidates) {
    const stem = candidate ? safeFileStem(candidate) : '';
    if (stem) {
      return `${stem}.txt`;
    }
  }
  return `${FALLBACK_NAME}.txt`;
}

/** The first line of a server's error text, shortened; empty when there is none. */
export function serverLine(text: string | null): string {
  const line = (text ?? '').split(/\r?\n/).find(item => item.trim())?.trim() ?? '';
  return line.length > SERVER_TEXT_LENGTH ? `${line.slice(0, SERVER_TEXT_LENGTH - 1)}…` : line;
}

export type DownloadFailure =
  | {kind: 'timeout'}
  | {kind: 'unreachable'; host: string}
  | {kind: 'tooLarge'}
  | {kind: 'cancelled'}
  | {kind: 'http'; status: number; text: string | null};

/** What the user reads when a download fails. */
export function downloadFailureMessage(failure: DownloadFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return `No answer after ${URL_IMPORT_TIMEOUT_MS / 1000} s. Is the phone on the same Wi-Fi?`;
    case 'unreachable':
      return `Couldn't reach ${failure.host}. Is it on the same Wi-Fi and sharing?`;
    case 'tooLarge':
      return `Larger than ${URL_IMPORT_MAX_BYTES / 1024 / 1024} MB. Nothing was saved.`;
    case 'cancelled':
      return 'Download cancelled. Nothing was saved.';
    case 'http': {
      const line = serverLine(failure.text);
      return line ? `${failure.status} · ${line}` : `The server answered ${failure.status}. Nothing was saved.`;
    }
  }
}

/** `folder/name` with `/` only, whatever the folder ends with. */
export function pathInFolder(folder: string, name: string): string {
  return `${folder.replace(/\/+$/, '')}/${name}`;
}
