/**
 * State of the Import from URL screen (technical-design-import-from-url.md §1): the address field,
 * the remembered addresses and folder, and one download at a time with Cancel.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  downloadToFile,
  forgetRecentUrl,
  setTargetFolder,
  urlImportSettings,
  type Downloaded,
} from '../../actions/urlImport';
import {normalizeUrl} from '../../domain/urlImport';
import {chooseTargetFolder} from '../../supernote/fileSelector';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface UrlImport {
  url: string;
  setUrl: (url: string) => void;
  recent: string[];
  forget: (url: string) => void;
  folder: string;
  chooseFolder: () => void;
  busy: boolean;
  /** The last download failed: the primary button says Try again. */
  failed: boolean;
  status: FrameStatus | null;
  download: () => void;
  cancel: () => void;
}

export function useUrlImport(onDownloaded: (file: Downloaded) => void): UrlImport {
  const [url, setUrlState] = useState(() => urlImportSettings().recentUrls[0] ?? '');
  const [recent, setRecent] = useState(() => urlImportSettings().recentUrls);
  const [folder, setFolder] = useState(() => urlImportSettings().targetFolder);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const setUrl = useCallback((next: string) => {
    setUrlState(next);
    setFailed(false);
    setStatus(null);
  }, []);

  const forget = useCallback((item: string) => setRecent(forgetRecentUrl(item)), []);

  const chooseFolder = useCallback(() => {
    chooseTargetFolder(folder)
      .then(chosen => {
        if (chosen && mounted.current) {
          setFolder(chosen);
          setTargetFolder(chosen);
        }
      })
      .catch(error => {
        console.warn('[UrlImport] folder not chosen', String(error));
        if (mounted.current) {
          setStatus({kind: 'error', text: 'The file selector could not be opened.'});
        }
      });
  }, [folder]);

  const download = useCallback(() => {
    if (controller.current) {
      return;
    }
    const address = normalizeUrl(url);
    if (!address.ok) {
      setFailed(true);
      setStatus({kind: 'error', text: address.message});
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFailed(false);
    setStatus({text: `Downloading from ${address.host}…`});
    downloadToFile(url, folder, abort.signal)
      .then(outcome => {
        if (!mounted.current) {
          return;
        }
        if (outcome.ok) {
          setRecent(urlImportSettings().recentUrls);
          onDownloaded(outcome.file);
        } else {
          setFailed(true);
          setStatus({kind: 'error', text: outcome.message});
        }
      })
      .catch(error => {
        console.error('[UrlImport] download failed', String(error));
        if (mounted.current) {
          setFailed(true);
          setStatus({kind: 'error', text: 'The download failed. Nothing was saved.'});
        }
      })
      .finally(() => {
        controller.current = null;
        if (mounted.current) {
          setBusy(false);
        }
      });
  }, [folder, onDownloaded, url]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  return {url, setUrl, recent, forget, folder, chooseFolder, busy, failed, status, download, cancel};
}
