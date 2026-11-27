/**
 * The plugin's only network code (DEVELOPMENT-POLICY §2, technical-design-import-from-url.md §3):
 * one GET of the address the user typed in Import from URL, when they tap Download. Nothing from
 * the device is sent beyond the request itself (no cookies, no body, one Accept header), nothing
 * stays open, nothing runs afterwards. ESLint refuses `fetch` and the other network globals in
 * every other file.
 *
 * React Native's fetch has no streaming body, so the size limit is checked on Content-Length
 * before reading and on the bytes after; the timeout bounds a body that never ends.
 */
import {
  decodeUtf8,
  URL_IMPORT_MAX_BYTES,
  URL_IMPORT_TIMEOUT_MS,
  type DownloadFailure,
} from '../domain/urlImport';

export type FetchedText = {
  status: number;
  contentType: string | null;
  disposition: string | null;
  /** The body as UTF-8, or null when it isn't valid UTF-8. */
  text: string | null;
  bytes: number;
};

export type FetchOutcome = {ok: true; result: FetchedText} | {ok: false; failure: DownloadFailure};

export interface FetchOptions {
  host: string;
  /** Aborts the request (Cancel); the outcome is then `cancelled`. */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function fetchText(url: string, options: FetchOptions): Promise<FetchOutcome> {
  const timeoutMs = options.timeoutMs ?? URL_IMPORT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? URL_IMPORT_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCancel = () => controller.abort();
  options.signal?.addEventListener('abort', onCancel);
  const started = Date.now();
  const stopped = (): FetchOutcome => ({ok: false, failure: timedOut ? {kind: 'timeout'} : {kind: 'cancelled'}});
  try {
    if (options.signal?.aborted) {
      return stopped();
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1'},
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return stopped();
      }
      console.warn(`[HttpFetch] ${options.host} unreachable:`, String(error));
      return {ok: false, failure: {kind: 'unreachable', host: options.host}};
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) {
      controller.abort();
      console.warn(`[HttpFetch] ${options.host} ${response.status}: ${length} bytes is over the limit`);
      return {ok: false, failure: {kind: 'tooLarge'}};
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (controller.signal.aborted) {
        return stopped();
      }
      console.warn(`[HttpFetch] ${options.host} body failed:`, String(error));
      return {ok: false, failure: {kind: 'unreachable', host: options.host}};
    }
    console.log(`[HttpFetch] ${options.host} ${response.status}, ${bytes.length} bytes, ${Date.now() - started} ms`);
    if (bytes.length > maxBytes) {
      return {ok: false, failure: {kind: 'tooLarge'}};
    }
    const text = decodeUtf8(bytes);
    if (response.status !== 200) {
      // The server's own words only when they are plain text (VoiceDraft's 404 line), never a web page's markup.
      const plain = /^text\/plain\b/i.test(response.headers.get('content-type') ?? '');
      return {ok: false, failure: {kind: 'http', status: response.status, text: plain ? text : null}};
    }
    return {
      ok: true,
      result: {
        status: response.status,
        contentType: response.headers.get('content-type'),
        disposition: response.headers.get('content-disposition'),
        text,
        bytes: bytes.length,
      },
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCancel);
  }
}
