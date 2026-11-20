/**
 * The Manuscript card's link to a text file (technical-design-source-link.md §4): which file the
 * note's tags point to, read in the background once the current page is shown, and what Details
 * offers for it (Check write access, Unlink).
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  checkSourceWriteAccess,
  findLinkedSource,
  unlinkSource,
  writeAccessText,
  type LinkedSource,
} from '../../actions/sourceLink';
import {userMessage} from '../../domain/userMessage';
import type {NoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface SourceLink {
  linked: LinkedSource | null;
  /** True while the note's textboxes are read to find the file. */
  finding: boolean;
  busy: boolean;
  status: FrameStatus | null;
  /** The answer of the last Check write access. */
  access: string | null;
  /** Reads the note again and looks for its file (after the note changed). */
  refind: () => void;
  checkAccess: () => void;
  unlink: () => void;
}

export function useSourceLink(note: NoteInfo | null, ready: boolean): SourceLink {
  const [linked, setLinked] = useState<LinkedSource | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const [access, setAccess] = useState<string | null>(null);
  const started = useRef(false);

  const find = useCallback(
    (fresh: boolean) => {
      if (!note) {
        return;
      }
      setFinding(true);
      findLinkedSource(note.notePath, note.pageCount, fresh)
        .then(found => setLinked(found))
        .catch(error => {
          console.warn('[SourceLink] not found', String(error));
          setStatus({kind: 'error', text: userMessage(error, 'Could not read the note to find its text file.')});
        })
        .finally(() => setFinding(false));
    },
    [note],
  );

  // Once the current page shows, quietly in the background.
  useEffect(() => {
    if (note && ready && !started.current) {
      started.current = true;
      find(false);
    }
  }, [find, note, ready]);

  const refind = useCallback(() => find(true), [find]);

  const checkAccess = useCallback(() => {
    if (!linked || busy) {
      return;
    }
    setBusy(true);
    setAccess('Checking…');
    checkSourceWriteAccess(linked.record)
      .then(result => setAccess(writeAccessText(result)))
      .catch(error => setAccess(userMessage(error, 'The check failed.')))
      .finally(() => setBusy(false));
  }, [busy, linked]);

  const unlink = useCallback(() => {
    if (!linked || busy) {
      return;
    }
    setBusy(true);
    unlinkSource(linked.record)
      .then(() => {
        setLinked(null);
        setStatus({text: 'Unlinked: the note keeps its text, the file stays as it is.'});
      })
      .catch(error => setStatus({kind: 'error', text: userMessage(error, 'Could not unlink the file.')}))
      .finally(() => setBusy(false));
  }, [busy, linked]);

  return {linked, finding, busy, status, access, refind, checkAccess, unlink};
}
