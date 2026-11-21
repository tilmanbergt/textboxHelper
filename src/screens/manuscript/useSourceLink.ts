/**
 * The Manuscript card's link to a text file (technical-design-source-link.md §4, §5): which file
 * the note's tags point to and whether the note differs from it, read in the background once the
 * current page is shown; "Also update <file>" (on every time the card opens, not remembered); the
 * write after an Apply or from "Update <file>"; the question before a protected block leaves the
 * file; and what Details offers (Save as copy, Save to EXPORT, Check write access, Unlink).
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  checkSourceWriteAccess,
  findLinkedSource,
  unlinkSource,
  writeAccessText,
  writeLinkedSource,
  writeResultText,
  type LinkedSource,
  type SourceWriteMode,
} from '../../actions/sourceLink';
import type {SourceBlock} from '../../domain/sourceBlocks';
import {userMessage} from '../../domain/userMessage';
import type {NoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface SourceLink {
  linked: LinkedSource | null;
  /** True while the note's textboxes are read to find the file and compare it. */
  finding: boolean;
  busy: boolean;
  status: FrameStatus | null;
  /** The answer of the last Check write access. */
  access: string | null;
  /** The warnings of the last write (or the dry run until then). */
  warnings: string[];
  /** "Also update <file>" next to Apply. */
  alsoUpdate: boolean;
  setAlsoUpdate: (on: boolean) => void;
  /** Protected blocks deleted on the page, waiting for Remove / Keep before the write. */
  confirm: SourceBlock[] | null;
  answer: (remove: boolean) => void;
  /** Reads the note again and compares it with the file (after the note changed). */
  refind: () => void;
  write: (mode: SourceWriteMode) => void;
  checkAccess: () => void;
  unlink: () => void;
}

export function useSourceLink(note: NoteInfo | null, ready: boolean): SourceLink {
  const [linked, setLinked] = useState<LinkedSource | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const [access, setAccess] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [alsoUpdate, setAlsoUpdate] = useState(true);
  const [confirm, setConfirm] = useState<{blocks: SourceBlock[]; mode: SourceWriteMode} | null>(null);
  const started = useRef(false);

  const find = useCallback(
    (fresh: boolean): Promise<LinkedSource | null> => {
      if (!note) {
        return Promise.resolve(null);
      }
      setFinding(true);
      return findLinkedSource(note.notePath, note.pageCount, fresh)
        .then(found => {
          setLinked(found);
          setWarnings(found?.regeneration.warnings ?? []);
          return found;
        })
        .catch(error => {
          console.warn('[SourceLink] not found', String(error));
          setStatus({kind: 'error', text: userMessage(error, 'Could not read the note to compare it with its text file.')});
          return null;
        })
        .finally(() => setFinding(false));
    },
    [note],
  );

  // Once the current page shows, quietly in the background. Always a fresh scan: the Outline's
  // cached scan may be older than an import or a change made since (it is updated by this scan).
  useEffect(() => {
    if (note && ready && !started.current) {
      started.current = true;
      find(true);
    }
  }, [find, note, ready]);

  const refind = useCallback(() => {
    find(true);
  }, [find]);

  const run = useCallback(
    (mode: SourceWriteMode, protectedAnswer?: 'remove' | 'keep') => {
      if (!note || !linked) {
        return;
      }
      setBusy(true);
      setStatus({text: `Writing ${linked.record.filePath.split('/').slice(-1)[0]}…`});
      writeLinkedSource({
        notePath: note.notePath,
        pageCount: note.pageCount,
        sourceId: linked.record.sourceId,
        mode,
        protectedAnswer,
      })
        .then(async result => {
          if (result.kind === 'confirm') {
            setConfirm({blocks: result.pending, mode});
            setStatus({text: writeResultText(result)});
            return;
          }
          setConfirm(null);
          if (result.kind === 'written') {
            setWarnings(result.regeneration.warnings);
          }
          setStatus({text: writeResultText(result)});
          // The record changed (last written, removed blocks): compare again.
          const found = await find(false);
          if (found && result.kind === 'written') {
            setWarnings(result.regeneration.warnings);
          }
        })
        .catch(error => {
          console.warn('[SourceLink] write failed', String(error));
          const message = userMessage(error, 'The text file could not be written.');
          setStatus({
            kind: 'error',
            text: message.startsWith("Can't write") ? `${message} Details → Save to EXPORT.` : message,
          });
        })
        .finally(() => setBusy(false));
    },
    [find, linked, note],
  );

  const write = useCallback(
    (mode: SourceWriteMode) => {
      if (!busy) {
        run(mode);
      }
    },
    [busy, run],
  );

  const answer = useCallback(
    (remove: boolean) => {
      if (confirm && !busy) {
        run(confirm.mode, remove ? 'remove' : 'keep');
      }
    },
    [busy, confirm, run],
  );

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
        setConfirm(null);
        setStatus({text: 'Unlinked: the note keeps its text, the file stays as it is.'});
      })
      .catch(error => setStatus({kind: 'error', text: userMessage(error, 'Could not unlink the file.')}))
      .finally(() => setBusy(false));
  }, [busy, linked]);

  return {
    linked,
    finding,
    busy,
    status,
    access,
    warnings,
    alsoUpdate,
    setAlsoUpdate,
    confirm: confirm?.blocks ?? null,
    answer,
    refind,
    write,
    checkAccess,
    unlink,
  };
}
