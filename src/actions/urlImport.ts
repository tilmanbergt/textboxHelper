/**
 * Import from URL's Download (technical-design-import-from-url.md §4): check the address, ask
 * INTERNET (only now), download once, check that it is text, name the file and save it as a new
 * `.txt` in the chosen folder - or in EXPORT when that folder can't be written. The note is not
 * touched: the Import screen then opens on the saved file and runs its own preview and import.
 */
import RNFS from 'react-native-fs';
import {FileUtils} from 'sn-plugin-lib';
import {IMPORT_FOLDER} from '../domain/importSettings';
import {pushRecentUrl, removeRecentUrl} from '../domain/recentUrls';
import {
  contentTypeProblem,
  copyCandidate,
  deriveFileName,
  downloadFailureMessage,
  normalizeUrl,
  pathInFolder,
} from '../domain/urlImport';
import {getSettings, updateSettings} from '../storage/settingsFile';
import {writeTextFile, writeTextToExport} from '../storage/sourceFile';
import {fetchText} from '../supernote/httpFetch';
import {ensureInternetPermission} from '../supernote/permissions';

export type Downloaded = {
  /** Absolute path of the saved file. */
  path: string;
  name: string;
  host: string;
  /** EXPORT when the chosen folder couldn't be written. */
  savedIn: 'target' | 'export';
  bytes: number;
  at: Date;
};

export type DownloadOutcome = {ok: true; file: Downloaded} | {ok: false; message: string};

const NOTHING_SAVED = 'Nothing was saved.';
const MAX_COPIES = 50;

/** The first free name: the file's own, else its dated copy name, numbered when that is taken too. */
async function freePath(folder: string, name: string, now: Date): Promise<string> {
  for (let n = 0; n <= MAX_COPIES; n++) {
    const candidate = copyCandidate(pathInFolder(folder, name), now, n);
    if (!(await RNFS.exists(candidate))) {
      return candidate;
    }
  }
  throw new Error('Too many files with this name.');
}

/** Saves into the folder, else into EXPORT; never overwrites. */
async function save(folder: string, name: string, text: string, now: Date): Promise<{path: string; savedIn: 'target' | 'export'}> {
  try {
    const path = await freePath(folder, name, now);
    const method = await writeTextFile(path, text);
    console.log(`[UrlImport] saved by ${method}`);
    return {path, savedIn: 'target'};
  } catch (error) {
    console.warn(`[UrlImport] ${folder} not writable, saving to EXPORT:`, String(error));
  }
  const exportName = (await freePath(await exportFolder(), name, now)).split('/').pop() ?? name;
  return {path: await writeTextToExport(exportName, text), savedIn: 'export'};
}

async function exportFolder(): Promise<string> {
  return FileUtils.getExportPath();
}

/** Downloads `rawUrl` into `folder`; on success the address and folder are remembered. */
export async function downloadToFile(rawUrl: string, folder: string, signal?: AbortSignal): Promise<DownloadOutcome> {
  const address = normalizeUrl(rawUrl);
  if (!address.ok) {
    return {ok: false, message: address.message};
  }
  if (!(await ensureInternetPermission())) {
    return {ok: false, message: 'Download needs internet access. Nothing was downloaded.'};
  }
  if (signal?.aborted) {
    return {ok: false, message: downloadFailureMessage({kind: 'cancelled'})};
  }
  const fetched = await fetchText(address.url, {host: address.host, signal});
  if (!fetched.ok) {
    return {ok: false, message: downloadFailureMessage(fetched.failure)};
  }
  const {contentType, disposition, text, bytes} = fetched.result;
  const problem = contentTypeProblem(contentType, text);
  if (problem || text === null) {
    return {ok: false, message: problem ?? `This file is not UTF-8 text. ${NOTHING_SAVED}`};
  }
  if (signal?.aborted) {
    return {ok: false, message: downloadFailureMessage({kind: 'cancelled'})};
  }
  const now = new Date();
  const name = deriveFileName(disposition, text, address.url);
  let saved: {path: string; savedIn: 'target' | 'export'};
  try {
    saved = await save(folder || IMPORT_FOLDER, name, text, now);
  } catch (error) {
    console.error('[UrlImport] could not save the download:', String(error));
    return {ok: false, message: `The file could not be saved, not even to EXPORT. ${NOTHING_SAVED}`};
  }
  updateSettings(settings => ({
    ...settings,
    urlImport: {recentUrls: pushRecentUrl(settings.urlImport.recentUrls, address.url), targetFolder: folder || IMPORT_FOLDER},
    import: {...settings.import, filePath: saved.path},
  }));
  return {
    ok: true,
    file: {
      path: saved.path,
      name: saved.path.split('/').pop() ?? name,
      host: address.host,
      savedIn: saved.savedIn,
      bytes,
      at: now,
    },
  };
}

/** Removes one remembered address. */
export function forgetRecentUrl(url: string): string[] {
  const next = updateSettings(settings => ({
    ...settings,
    urlImport: {...settings.urlImport, recentUrls: removeRecentUrl(settings.urlImport.recentUrls, url)},
  }));
  return next.urlImport.recentUrls;
}

/** Remembers the folder downloads go to. */
export function setTargetFolder(folder: string): void {
  updateSettings(settings => ({...settings, urlImport: {...settings.urlImport, targetFolder: folder}}));
}

export function urlImportSettings() {
  return getSettings().urlImport;
}
