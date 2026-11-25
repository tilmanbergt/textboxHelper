import {updatePenEdit, type NoteInfo} from '../domain/penEditModel';
import {isNoteKind} from '../domain/penEditTags';
import {changePenEditIndex, readPenEditIndex} from '../storage/penEditStore';
import {ensureBlockId} from './blockStatus';

/**
 * What the Review changes on a comment or an image (technical-design-comments-images.md §5.2):
 * every action writes at once, one entry update; no Apply is involved.
 */

/** Changes a note's info; an entry that is no note (any more) is left alone. */
async function changeNote(id: string, change: (note: NoteInfo) => NoteInfo): Promise<void> {
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => (isNoteKind(entry.kind) ? {...entry, note: change(entry.note ?? {})} : entry)),
  );
}

/**
 * The paragraph the user chose (‹ ›, §2.2): stored as its block id; a textbox without one gets one
 * now, written into its `userData` - the only time a note writes onto the page.
 */
export async function chooseNoteParagraph(
  id: string,
  target: {page: number; numInPage: number; text: string; blockId: string | null},
): Promise<void> {
  const {index} = await readPenEditIndex();
  const entry = index.entries.find(item => item.id === id);
  if (!entry || !isNoteKind(entry.kind)) {
    throw new Error('This comment or image is no longer known.');
  }
  const blockId = target.blockId ?? (await ensureBlockId(entry.notePath, target));
  await changeNote(id, note => ({...note, paragraph: blockId}));
  console.log('[NoteEdit] paragraph', JSON.stringify({id, page: target.page, tagged: target.blockId === null}));
}
