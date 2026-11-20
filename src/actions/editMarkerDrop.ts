import type {Element} from 'sn-plugin-lib';
import {isSupportedEditMarkerElement} from '../domain/markerStrokes';
import type {
  EditMarkerPreview,
  IgnoredEditMarker,
  RecognizedEditOperation,
} from '../domain/markerTypes';
import {isPenEditElement} from '../domain/penEditTags';
import {plural} from '../domain/plural';
import {fileNameOf} from '../domain/userMessage';
import {writeBackupFile} from '../storage/backupFile';
import {
  deletePageElements,
  readPageElements,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {logEditMarker} from '../utils/editMarkerLog';
import {
  markPenEditsDropped,
  penEditBackupData,
  penEditElementNums,
} from './penEditReview';

/**
 * Something the review can drop from the page (technical-design-pen-edits-2.md §7): a pen edit,
 * or a plain mark's strokes. Strokes away from every textbox may be the user's own handwriting and
 * are never droppable.
 */
export type DropItem = {penEditId?: string; markerNums?: number[]};

export function dropItemOfIgnored(item: IgnoredEditMarker): DropItem | null {
  if (item.penEditId !== undefined) {
    return {penEditId: item.penEditId};
  }
  return (item.removableNums?.length ?? 0) > 0
    ? {markerNums: item.removableNums}
    : null;
}

export function dropItemOfOperation(
  operation: RecognizedEditOperation,
): DropItem | null {
  if (operation.penEditId) {
    return {penEditId: operation.penEditId};
  }
  return operation.consumedMarkerNums.length > 0
    ? {markerNums: operation.consumedMarkerNums}
    : null;
}

/**
 * Drops changes from the page without applying them. Always: a pen edit's badges and numbers and
 * its mark (a strike left behind would read as a delete next time), and a plain mark's strokes.
 * With `eraseHandwriting`, also the tagged handwriting; a backup holding it is written first (its
 * stored strokes and picture stay in the plugin folder as well). Reads the page fresh and deletes
 * only strokes still there under a unique number; never textboxes. The dropped pen edits are
 * marked so; the text of the textboxes is not touched.
 */
export async function dropItems(
  preview: EditMarkerPreview,
  items: DropItem[],
  eraseHandwriting: boolean,
): Promise<{message: string}> {
  const base = preview.base;
  if (!base || items.length === 0) {
    throw new Error('Nothing here can be dropped.');
  }
  let pageElements: Element[] = [];
  try {
    pageElements = await readPageElements(
      base.notePath,
      base.page,
      `Could not read page ${base.page} elements before dropping.`,
    );
    const counts = new Map<number, number>();
    pageElements.forEach(element =>
      counts.set(element.numInPage, (counts.get(element.numInPage) ?? 0) + 1),
    );
    const byNum = new Map(
      pageElements.map(element => [element.numInPage, element]),
    );
    const markerNums = items
      .flatMap(item => (item.penEditId ? [] : item.markerNums ?? []))
      .filter(num => {
        const element = byNum.get(num);
        return (
          !!element &&
          counts.get(num) === 1 &&
          isSupportedEditMarkerElement(element) &&
          !isPenEditElement(element)
        );
      });

    const penIds = [
      ...new Set(
        items
          .map(item => item.penEditId)
          .filter((id): id is string => !!id),
      ),
    ];
    const penBackup =
      penIds.length > 0 ? await penEditBackupData(penIds) : null;
    const penNums = penEditElementNums(
      penIds,
      penBackup?.entries ?? [],
      pageElements,
      {handwriting: eraseHandwriting, replaceMark: true},
    );

    let backupPath: string | null = null;
    if (eraseHandwriting && penBackup && penBackup.entries.length > 0) {
      const written = await writeBackupFile({
        action: 'edit-markers',
        createdAt: new Date().toISOString(),
        notePath: base.notePath,
        pages: [base.page],
        recognizedOperationCount: 0,
        texts: [],
        penEdits: penBackup,
      });
      backupPath = written.backupPath;
    }

    const nums = [...new Set([...markerNums, ...penNums])];
    logEditMarker('drop', {
      penIds,
      markerNums,
      penNums,
      eraseHandwriting,
    });
    // As in apply: save first, so the file the delete works on holds the latest strokes.
    await saveCurrentNoteForConsistency('dropping changes');
    await deletePageElements(base.notePath, base.page, nums);
    try {
      await markPenEditsDropped(penIds);
    } catch (error) {
      console.warn(
        '[EditMarkerActions] pen edits not marked dropped',
        String(error),
      );
    }

    const markCount = items.filter(item => !item.penEditId).length;
    const parts = [
      penIds.length > 0 ? plural(penIds.length, 'tagged text') : null,
      markerNums.length > 0 ? plural(markCount, 'mark') : null,
    ].filter(Boolean);
    const kept =
      penIds.length > 0 && !eraseHandwriting ? ' Your handwriting stays.' : '';
    const backup = backupPath ? ` Backup: ${fileNameOf(backupPath)}` : '';
    return {
      message:
        nums.length > 0
          ? `Dropped ${parts.join(' and ')}.${kept}${backup}`
          : 'Nothing was dropped: the strokes are no longer on the page.',
    };
  } finally {
    await recycleElements(pageElements);
  }
}
