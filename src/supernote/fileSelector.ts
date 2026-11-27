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

/**
 * "Change ›" on Import from URL: the folder downloads go to. The selector has no folder mode
 * (sn-plugin-lib 0.2.3 offers file selection only), so the user picks any file in the folder and
 * its folder is used - the same way "Whole folder" finds its folder. Null when cancelled.
 */
export async function chooseTargetFolder(currentFolder: string): Promise<string | null> {
  const result = await withTimeout(
    RattaFileSelector.selectFile({
      selectType: 1,
      suffixList: ['txt', 'note', 'pdf', 'epub', 'docx', 'png', 'jpg'],
      maxNum: 1,
      title: 'Choose any file in the folder for downloads',
      rightButtonText: 'Use its folder',
      selectPathList: [],
      needSelectFolder: currentFolder,
    }),
    SELECTOR_TIMEOUT_MS,
    'The file selector did not answer.',
  );
  const path = Array.isArray(result) && typeof result[0] === 'string' ? result[0] : '';
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : null;
}
