/**
 * The Supernote's own file selector for "Choose ›" on the Import screen
 * (technical-design-source-link.md §3): .txt files from any folder, opening in the folder the
 * current note sits in (else the last chosen file's folder, else INBOX). Returns the chosen absolute path, or null when the user cancels.
 * The host call is bounded, so a selector that never answers can't block the screen.
 */
import {RattaFileSelector} from 'sn-plugin-lib';
import {importStartFolder} from '../domain/importSettings';
import {withTimeout} from './sdkResult';

const SELECTOR_TIMEOUT_MS = 10 * 60 * 1000;

export async function chooseImportFile(currentPath: string | null, notePath: string | null): Promise<string | null> {
  const result = await withTimeout(
    RattaFileSelector.selectFile({
      selectType: 1,
      suffixList: ['txt'],
      maxNum: 1,
      title: 'Choose a text file',
      rightButtonText: 'Choose',
      selectPathList: currentPath ? [currentPath] : [],
      needSelectFolder: importStartFolder(notePath || currentPath || ''),
    }),
    SELECTOR_TIMEOUT_MS,
    'The file selector did not answer.',
  );
  return Array.isArray(result) && typeof result[0] === 'string' && result[0] ? result[0] : null;
}
