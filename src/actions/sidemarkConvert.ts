import {canConvertSidemark, convertSidemarkEntry, updatePenEdit, type SidemarkKind} from '../domain/penEditModel';
import {changePenEditIndex, readPenEditIndex} from '../storage/penEditStore';
import {replaceSnippetSign} from '../supernote/penEditElements';

/**
 * A sidemark becomes "?" (text waiting for its mark), a comment or an image
 * (technical-design-comments-images.md §3.3): from the tag's cards, from To decide and from the
 * Notes tab. The entry first (kind, no number, no mark), then its sign on the page; if the sign
 * can't change, the entry is set back and the error says so. The strokes keep their tags.
 */

const NAMES: Record<SidemarkKind, string> = {unpaired: 'text', comment: 'comment', image: 'image'};

export async function convertSidemark(id: string, kind: SidemarkKind): Promise<void> {
  const {index} = await readPenEditIndex();
  const before = index.entries.find(entry => entry.id === id);
  if (!before || !canConvertSidemark(before)) {
    throw new Error('This text is linked to its mark or no longer on the page.');
  }
  if (before.kind === kind) {
    return;
  }
  await changePenEditIndex(current => updatePenEdit(current, id, entry => convertSidemarkEntry(entry, kind)));
  const sign = await replaceSnippetSign(before.notePath, before.page, id, {from: before.kind, to: kind, fallback: before.iconRect});
  console.log('[Sidemark] convert', JSON.stringify({id, from: before.kind, to: kind, page: before.page, signChanged: sign.changed, error: sign.error}));
  if (!sign.changed) {
    await changePenEditIndex(current => updatePenEdit(current, id, () => before)).catch(error =>
      console.warn('[Sidemark] entry not set back', String(error)),
    );
    throw new Error(`Could not change the sign on the page to a ${NAMES[kind]} (${sign.error ?? 'unknown error'}). Please try again.`);
  }
}
