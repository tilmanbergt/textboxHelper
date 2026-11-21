/**
 * State and flows of the Import screen (technical-design-calmer-screens.md §3.7). The settings
 * come from the settings file and every change is saved. The preview runs on open and 500 ms
 * after the last change; a newer run makes an older run's result stale, so it is dropped.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  getTextboxImportPreview,
  performTextboxImport,
  type TextboxImportPreview,
} from '../../actions/textImport';
import {chosenTextFilePath, type TextboxImportSettings} from '../../domain/importSettings';
import {userMessage} from '../../domain/userMessage';
import {getSettings, updateSettings} from '../../storage/settingsFile';
import {chooseImportFile} from '../../supernote/fileSelector';
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
}

export function useTextImport(): TextImport {
  const [settings, setSettings] = useState<TextboxImportSettings>(() => getSettings().import);
  const [preview, setPreview] = useState<TextboxImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const runRef = useRef(0);

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
    setPreviewing(true);
    const timer = setTimeout(() => {
      getTextboxImportPreview(settings)
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
  }, [settings]);

  const chooseFile = useCallback(() => {
    if (busy) {
      return;
    }
    chooseImportFile(settings.filePath || null)
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
    performTextboxImport(settings, {onProgress: update => setStatus({text: update.message})})
      .then(result => {
        setImported(true);
        setStatus({text: result.message});
      })
      .catch(error => {
        console.warn('[TextImport] import failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The import failed.')});
      })
      .finally(() => setBusy(false));
  }, [busy, preview, settings]);

  return {settings, preview, previewError, previewing, busy, imported, status, change, chooseFile, runImport};
}
