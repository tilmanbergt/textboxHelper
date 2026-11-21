/**
 * The Manuscript card's linked files (technical-design-linked-files.md §3): which files the note's
 * dividers and tags point to and how each stands, read in the background once the current page is
 * shown; "Also update changed files" (on every time the card opens, not remembered); the write
 * after an Apply or from "Update"; the question before protected blocks leave their files; and
 * what Details offers per file (Save as copy, Save to EXPORT, Check write access, Unlink) and for
 * the note (Restore titles).
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {
  checkSourceWriteAccess,
  filesToWrite,
  readLinkedNote,
  restoreFileTitles,
  saveFileCopy,
  unlinkFile,
  writeAccessText,
  writeLinkedFiles,
  writeResultText,
  type LinkedFile,
  type LinkedNote,
  type PendingRemoval,
} from '../../actions/linkedFiles';
import {userMessage} from '../../domain/userMessage';
import type {NoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface LinkedFiles {
  note: LinkedNote | null;
  /** Files Update would write now. */
  toWrite: LinkedFile[];
  /** True while the note's textboxes are read to find the files and compare them. */
  finding: boolean;
  busy: boolean;
  status: FrameStatus | null;
  /** The answer of the last Check write access, by source id. */
  access: Record<string, string>;
  /** The warnings of the last write (or the dry run until then). */
  warnings: string[];
  /** "Also update changed files" next to Apply. */
  alsoUpdate: boolean;
  setAlsoUpdate: (on: boolean) => void;
  /** Protected blocks deleted on the page, waiting for Remove / Keep before the write. */
  confirm: PendingRemoval[] | null;
  answer: (remove: boolean) => void;
  /** Reads the note again and compares it with the files (after the note changed). */
  refind: () => void;
  /** Writes every file that changed here. */
  write: () => void;
  saveCopy: (sourceId: string, mode: 'copy' | 'export') => void;
  checkAccess: (file: LinkedFile) => void;
  unlink: (file: LinkedFile) => void;
  restoreTitles: () => void;
}

function dryRunWarnings(note: LinkedNote | null): string[] {
  const files = note?.files ?? [];
  return files.flatMap(file =>
    file.regeneration.warnings.map(warning =>
      files.length > 1 ? `${file.record.filePath.split('/').slice(-1)[0]}: ${warning}` : warning,
    ),
  );
}

export function useLinkedFiles(info: NoteInfo | null, ready: boolean): LinkedFiles {
  const [note, setNote] = useState<LinkedNote | null>(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const [access, setAccess] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [alsoUpdate, setAlsoUpdate] = useState(true);
  const [confirm, setConfirm] = useState<PendingRemoval[] | null>(null);
  const started = useRef(false);

  const find = useCallback(
    (fresh: boolean): Promise<LinkedNote | null> => {
      if (!info) {
        return Promise.resolve(null);
      }
      setFinding(true);
      return readLinkedNote(info.notePath, info.pageCount, fresh)
        .then(found => {
          setNote(found);
          setWarnings(dryRunWarnings(found));
          return found;
        })
        .catch(error => {
          console.warn('[SourceLink] not found', String(error));
          setStatus({kind: 'error', text: userMessage(error, 'Could not read the note to compare it with its text files.')});
          return null;
        })
        .finally(() => setFinding(false));
    },
    [info],
  );

  // Once the current page shows, quietly in the background. Always a fresh scan: the Outline's
  // cached scan may be older than an import or a change made since (it is updated by this scan).
  useEffect(() => {
    if (info && ready && !started.current) {
      started.current = true;
      find(true);
    }
  }, [find, info, ready]);

  const refind = useCallback(() => {
    find(true);
  }, [find]);

  /** Runs a step that changes files or the note, then reads the note again. */
  const step = useCallback(
    (label: string, work: () => Promise<string | null>, failure: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      setStatus({text: label});
      work()
        .then(async text => {
          if (text !== null) {
            setStatus({text});
          }
          await find(true);
        })
        .catch(error => {
          console.warn('[SourceLink] step failed', String(error));
          const message = userMessage(error, failure);
          setStatus({
            kind: 'error',
            text: message.startsWith("Can't write") ? `${message} Details → Save to EXPORT.` : message,
          });
        })
        .finally(() => setBusy(false));
    },
    [busy, find],
  );

  const run = useCallback(
    (protectedAnswer?: 'remove' | 'keep') => {
      if (!info || !note) {
        return;
      }
      step(
        'Writing the files…',
        async () => {
          const result = await writeLinkedFiles({notePath: info.notePath, pageCount: info.pageCount, protectedAnswer});
          if (result.kind === 'confirm') {
            setConfirm(result.pending);
            return writeResultText(result);
          }
          setConfirm(null);
          setWarnings(result.warnings);
          return writeResultText(result);
        },
        'The text files could not be written.',
      );
    },
    [info, note, step],
  );

  const write = useCallback(() => run(), [run]);

  const answer = useCallback(
    (remove: boolean) => {
      if (confirm) {
        run(remove ? 'remove' : 'keep');
      }
    },
    [confirm, run],
  );

  const saveCopy = useCallback(
    (sourceId: string, mode: 'copy' | 'export') => {
      if (info) {
        step('Saving…', () => saveFileCopy({notePath: info.notePath, pageCount: info.pageCount, sourceId, mode}), 'The copy could not be saved.');
      }
    },
    [info, step],
  );

  const checkAccess = useCallback(
    (file: LinkedFile) => {
      if (busy) {
        return;
      }
      const id = file.record.sourceId;
      setBusy(true);
      setAccess(current => ({...current, [id]: 'Checking…'}));
      checkSourceWriteAccess(file.record)
        .then(result => setAccess(current => ({...current, [id]: writeAccessText(result)})))
        .catch(error => setAccess(current => ({...current, [id]: userMessage(error, 'The check failed.')})))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const unlink = useCallback(
    (file: LinkedFile) => {
      step(
        'Unlinking…',
        async () => {
          await unlinkFile(file.record);
          setConfirm(null);
          return 'Unlinked: the note keeps its text, the file stays as it is.';
        },
        'Could not unlink the file.',
      );
    },
    [step],
  );

  const restoreTitles = useCallback(() => {
    if (info) {
      step('Restoring the file titles…', () => restoreFileTitles(info.notePath, info.pageCount), 'Could not restore the file titles.');
    }
  }, [info, step]);

  return {
    note,
    toWrite: filesToWrite(note),
    finding,
    busy,
    status,
    access,
    warnings,
    alsoUpdate,
    setAlsoUpdate,
    confirm,
    answer,
    refind,
    write,
    saveCopy,
    checkAccess,
    unlink,
    restoreTitles,
  };
}
