/**
 * State and flows of the Import screen (technical-design-calmer-screens.md §3.7). The settings
 * come from the settings file and every change is saved. The preview runs on open and 500 ms
 * after the last change; a newer run makes an older run's result stale, so it is dropped.
 * "Whole folder" binds the chosen file's folder (technical-design-linked-files.md §2.1): its files
 * are read, all chosen at first, ordered by its index.txt when it has one, else unordered.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {readImportFolder, type ImportFolder} from '../../actions/folderLink';
import {
  getTextboxImportPreview,
  performTextboxImport,
  type FolderImport,
  type TextboxImportPreview,
} from '../../actions/textImport';
import {startOrder} from '../../domain/noteLinks';
import {chosenTextFilePath, type TextboxImportSettings} from '../../domain/importSettings';
import {userMessage} from '../../domain/userMessage';
import {getSettings, updateSettings} from '../../storage/settingsFile';
import {chooseImportFile} from '../../supernote/fileSelector';
import {readNoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';

const PREVIEW_DELAY_MS = 500;

export interface TextImport {
  settings: TextboxImportSettings;
  preview: TextboxImportPreview | null;
  previewError: string | null;
  previewing: boolean;
  busy: boolean;
  imported: boolean;
  status: FrameStatus | null;
  change: (next: TextboxImportSettings) => void;
  chooseFile: () => void;
  runImport: () => void;
  /** Bind the chosen file's whole folder instead of importing the file alone. */
  wholeFolder: boolean;
  setWholeFolder: (on: boolean) => void;
  /** The folder as read, with the setup's choices; null when not reading a folder. */
  folder: ImportFolder | null;
  setup: FolderSetup;
  setSetup: (next: FolderSetup) => void;
  /** The folder import the setup describes. */
  folderImport: FolderImport | null;
}

export type FolderSetup = {
  /** Files left out (names). */
  skipped: string[];
  ordered: boolean;
  orderBy: 'name' | 'date';
};

const NO_SETUP: FolderSetup = {skipped: [], ordered: false, orderBy: 'name'};

export function useTextImport(): TextImport {
  const [settings, setSettings] = useState<TextboxImportSettings>(() => getSettings().import);
  const [preview, setPreview] = useState<TextboxImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const runRef = useRef(0);
  const [wholeFolder, setWholeFolder] = useState(false);
  const [folder, setFolder] = useState<ImportFolder | null>(null);
  const [setup, setSetup] = useState<FolderSetup>(NO_SETUP);

  useEffect(() => {
    setFolder(null);
    if (!wholeFolder || !settings.filePath.trim()) {
      return;
    }
    let current = true;
    readImportFolder(settings.filePath)
      .then(read => {
        if (current) {
          setFolder(read);
          setSetup({skipped: [], ordered: read.index !== null, orderBy: 'name'});
        }
      })
      .catch(error => {
        console.warn('[TextImport] folder not read', String(error));
        if (current) {
          setStatus({kind: 'error', text: userMessage(error, "Can't read the file's folder.")});
        }
      });
    return () => {
      current = false;
    };
  }, [settings.filePath, wholeFolder]);

  const folderImport = useMemo((): FolderImport | null => {
    if (!wholeFolder || !folder) {
      return null;
    }
    const order = startOrder(folder.files, setup.ordered ? folder.index : null, setup.orderBy);
    const skipped = new Set(setup.skipped);
    return {
      path: folder.path,
      names: order.map(file => file.name).filter(name => !skipped.has(name)),
      ordered: setup.ordered,
      skipped: setup.skipped,
    };
  }, [folder, setup, wholeFolder]);

  const change = useCallback((next: TextboxImportSettings) => {
    setSettings(next);
    updateSettings(current => ({...current, import: next}));
  }, []);

  useEffect(() => {
    const run = ++runRef.current;
    if (!settings.filePath.trim()) {
      setPreview(null);
      setPreviewError('Choose a text file.');
      return;
    }
    if (wholeFolder && !folderImport) {
      setPreview(null);
      setPreviewError('Reading the folder…');
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(() => {
      getTextboxImportPreview(settings, folderImport ?? undefined)
        .then(next => {
          if (run === runRef.current) {
            setPreview(next);
            setPreviewError(null);
          }
        })
        .catch(error => {
          if (run === runRef.current) {
            console.warn('[TextImport] preview failed', String(error));
            setPreview(null);
            setPreviewError(userMessage(error, 'Could not read the file.'));
          }
        })
        .finally(() => run === runRef.current && setPreviewing(false));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [folderImport, settings, wholeFolder]);

  const chooseFile = useCallback(() => {
    if (busy) {
      return;
    }
    readNoteInfo()
      .then(info => info.notePath)
      .catch(() => null)
      .then(notePath => chooseImportFile(settings.filePath || null, notePath))
      .then(path => {
        if (!path) {
          return;
        }
        const chosen = chosenTextFilePath(path);
        if (!chosen) {
          setStatus({kind: 'error', text: 'Choose a .txt file.'});
          return;
        }
        setStatus(null);
        setImported(false);
        change({...settings, filePath: chosen});
      })
      .catch(error => {
        console.warn('[TextImport] file selector failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The file selector could not be opened.')});
      });
  }, [busy, change, settings]);

  const runImport = useCallback(() => {
    if (busy || !preview) {
      return;
    }
    setBusy(true);
    setStatus({text: 'Importing…'});
    performTextboxImport(settings, {onProgress: update => setStatus({text: update.message})}, folderImport ?? undefined)
      .then(result => {
        setImported(true);
        setStatus({text: result.message});
      })
      .catch(error => {
        console.warn('[TextImport] import failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The import failed.')});
      })
      .finally(() => setBusy(false));
  }, [busy, folderImport, preview, settings]);

  return {
    settings,
    preview,
    previewError,
    previewing,
    busy,
    imported,
    status,
    change,
    chooseFile,
    runImport,
    wholeFolder,
    setWholeFolder,
    folder,
    setup,
    setSetup,
    folderImport,
  };
}
