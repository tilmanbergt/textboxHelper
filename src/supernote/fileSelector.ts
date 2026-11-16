/**
 * The Supernote's own file selector, limited to INBOX and .txt files, for "Choose ›" on the Import
 * screen (technical-design-calmer-screens.md §3.7). Returns the chosen absolute path, or null when
 * the user cancels. The host call is bounded, so a selector that never answers can't block the
 * screen.
 */
import {RattaFileSelector} from 'sn-plugin-lib';
import {IMPORT_FOLDER} from '../domain/importSettings';
import {withTimeout} from './sdkResult';

const SELECTOR_TIMEOUT_MS = 10 * 60 * 1000;

export async function chooseImportFile(currentPath: string | null): Promise<string | null> {
  const result = await withTimeout(
    RattaFileSelector.selectFile({
      selectType: 1,
      suffixList: ['txt'],
      maxNum: 1,
      title: 'Choose a text file',
      rightButtonText: 'Choose',
      selectPathList: currentPath ? [currentPath] : [],
      needSelectFolder: IMPORT_FOLDER,
      limitPath: IMPORT_FOLDER,
    }),
    SELECTOR_TIMEOUT_MS,
    'The file selector did not answer.',
  );
  return Array.isArray(result) && typeof result[0] === 'string' && result[0] ? result[0] : null;
}
