import type {Element} from 'sn-plugin-lib';
import type {PageParagraph} from '../domain/notes/noteRows';
import {updatePenEdit, type NoteInfo, type PenEditEntry, type StoredStroke} from '../domain/penEditModel';
import {isNoteKind} from '../domain/penEditTags';
import {changePenEditIndex, readPenEditIndex, replacePenEditStrokes} from '../storage/penEditStore';
import {readStoredStroke} from '../supernote/lassoRead';
import {readPageElements, recycleElements} from '../supernote/noteElements';
import {removeSidemarkTags} from '../supernote/penEditElements';
import {ensureBlockId} from './blockStatus';
import {pageParagraphs} from './notesRead';
import {resolvePenEdit} from './penEditReview';

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

/** Done ✓ on a comment: checked off, or open again. It stays in the list, greyed. */
export async function setCommentDone(id: string, done: boolean): Promise<void> {
  await changeNote(id, note => {
    const next = {...note};
    delete next.done;
    return done ? {...next, done: true} : next;
  });
}

/** Place: an image goes before or after its paragraph (written to the file in a later version). */
export async function setImagePlace(id: string, place: 'before' | 'after'): Promise<void> {
  await changeNote(id, note => ({...note, place}));
}

async function noteEntry(id: string): Promise<PenEditEntry> {
  const {index} = await readPenEditIndex();
  const entry = index.entries.find(item => item.id === id);
  if (!entry || entry.state !== 'active' || !isNoteKind(entry.kind)) {
    throw new Error('This comment or image is no longer known.');
  }
  return entry;
}

/**
 * Drop (§5.4): the sign goes, the strokes lose their tag and are plain handwriting again, the
 * entry is dropped (housekeeping removes it later).
 */
export async function dropNote(id: string): Promise<void> {
  const entry = await noteEntry(id);
  const removed = await removeSidemarkTags(entry.notePath, entry.page, id);
  if (!removed.done) {
    throw new Error(`Could not take the sign off the page (${removed.error ?? 'unknown error'}).`);
  }
  const doneAt = new Date().toISOString();
  await changePenEditIndex(current => updatePenEdit(current, id, item => ({...item, state: 'dropped', doneAt})));
}

/**
 * Update image: the image's tagged strokes as they are on the page now are stored in place of
 * those from tag time, and drawn as its picture (the picture from tag time goes).
 */
export async function updateNoteImage(id: string): Promise<void> {
  const entry = await noteEntry(id);
  let elements: Element[] = [];
  try {
    elements = await readPageElements(entry.notePath, entry.page, `Could not read page ${entry.page + 1}.`);
    const {strokes} = resolvePenEdit(entry, elements);
    const read = (await Promise.all(strokes.map(readStoredStroke))).filter((stroke): stroke is StoredStroke => !!stroke && stroke.points.length >= 4);
    if (read.length === 0) {
      throw new Error('The image\'s handwriting is no longer on the page.');
    }
    await replacePenEditStrokes({version: 1, id, pageSize: null, strokes: read});
    await changePenEditIndex(current => updatePenEdit(current, id, item => ({...item, hasPicture: false})));
    console.log('[NoteEdit] image updated', JSON.stringify({id, strokes: read.length}));
  } finally {
    await recycleElements(elements);
  }
}

/** The paragraphs of a page not read by the Review (‹ › past the page edge). */
export async function readPageParagraphs(notePath: string, page: number): Promise<PageParagraph[]> {
  let elements: Element[] = [];
  try {
    elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    return pageParagraphs(page, elements).paragraphs;
  } finally {
    await recycleElements(elements);
  }
}
