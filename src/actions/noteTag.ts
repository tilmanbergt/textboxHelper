import type {NoteKind} from '../domain/penEditTags';
import {newPenEditId} from '../domain/penEditTags';
import type {LassoSnapshot} from '../supernote/lassoRead';
import {
  discardSidemarkData,
  readSidemarkLasso,
  recycleLasso,
  storeSidemarkData,
  writeSidemark,
  type SidemarkLasso,
  type SidemarkStoring,
} from './sidemarkWrite';
import type {PenEditTagOutcome} from './penEditTag';

/**
 * The "Comment or Image" lasso button (technical-design-comments-images.md §3.1): the lassoed
 * handwriting becomes a comment or an image - a sidemark that needs no mark, so nothing is looked
 * for before it. The lasso is read and its strokes and picture stored at once; the small card
 * (`NoteKindCard`) asks Comment · Image, and only the choice writes the entry, the tag on the
 * strokes and the sign (a speech bubble with "C", or a plain double frame). Cancel writes nothing.
 * The lasso snapshot is kept here while the card is open.
 */

type PendingNote = {
  id: string;
  lasso: Extract<SidemarkLasso, {ok: true}>;
  storing: SidemarkStoring;
};

let pending: PendingNote | null = null;
let running = false;

/** Forgets the waiting lasso: its stored strokes and picture go, its elements are given back. */
async function forgetPending(): Promise<void> {
  const current = pending;
  pending = null;
  if (current) {
    recycleLasso(current.lasso.snap);
    await discardSidemarkData(current.id, current.storing);
  }
}

/**
 * Reads the lasso for a comment or image. `chooseNote` means the card is to open and wait for the
 * choice; anything else is the outcome to show.
 */
export async function startNoteTag(): Promise<PenEditTagOutcome> {
  if (running) {
    console.warn('[NoteTag] tag already running - press ignored');
    return {kind: 'busy'};
  }
  running = true;
  // A card left open from an earlier press is not answered any more.
  await forgetPending();
  const id = newPenEditId(new Date());
  let snap: LassoSnapshot | null = null;
  try {
    const read = await readSidemarkLasso(id, '[NoteTag]');
    snap = read.snap;
    if (!read.lasso.ok) {
      recycleLasso(snap);
      return read.lasso.empty
        ? {kind: 'failed', detail: 'Lasso handwriting to keep it as a comment or an image.'}
        : {kind: 'failed', detail: read.lasso.detail};
    }
    pending = {id, lasso: read.lasso, storing: storeSidemarkData(id, read.lasso.snap)};
    console.log('[NoteTag] waiting for the choice', JSON.stringify({id, page: read.lasso.page, strokes: read.lasso.snap.strokes.length}));
    return {kind: 'chooseNote'};
  } catch (error) {
    recycleLasso(snap);
    console.error('[NoteTag] lasso not read', JSON.stringify({id, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The handwriting could not be read.'};
  } finally {
    running = false;
  }
}

/**
 * The card's choice: the entry with its kind, the tag on the strokes, the sign, save. Returns
 * null when it is on the page, else the outcome that says why not.
 */
export async function chooseNoteKind(kind: NoteKind): Promise<PenEditTagOutcome | null> {
  const current = pending;
  if (!current || running) {
    return {kind: 'failed', detail: 'The lassoed handwriting is no longer known. Please lasso it again.'};
  }
  running = true;
  pending = null;
  let written = false;
  const start = Date.now();
  try {
    const result = await writeSidemark({
      id: current.id,
      kind,
      lasso: current.lasso,
      number: null,
      mark: null,
      note: {},
      strokes: current.lasso.snap.strokeElements.map(element => ({element, role: 'stroke' as const})),
      extra: {badges: [], numbers: []},
      storing: current.storing,
    });
    if (!result.ok) {
      return {kind: 'failed', detail: result.detail};
    }
    written = true;
    console.log(
      '[NoteTag] tag',
      JSON.stringify({
        id: current.id,
        kind,
        page: current.lasso.page,
        strokes: current.lasso.snap.strokes.length,
        strokesTagged: result.tagged.tagged,
        hasPicture: result.picture.kept,
        saved: result.placed.saved,
        totalMs: Date.now() - start,
      }),
    );
    return null;
  } catch (error) {
    console.error('[NoteTag] tag failed', JSON.stringify({id: current.id, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The tag could not be saved.'};
  } finally {
    if (!written) {
      await discardSidemarkData(current.id, current.storing);
    }
    recycleLasso(current.lasso.snap);
    running = false;
  }
}

/** Cancel on the card: nothing is written, the stored handwriting goes. */
export async function cancelNoteTag(): Promise<void> {
  await forgetPending();
}
