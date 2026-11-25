import type {OutlineBlock} from '../outlineModel';
import type {PenEditEntry} from '../penEditModel';
import {isNoteKind} from '../penEditTags';
import {paragraphOf, sectionAt, type ParagraphCandidate} from './paragraphOf';

/**
 * The comments and images of each Outline block (technical-design-comments-images.md §6), for the
 * whole note without reading pages: `paragraphOf` over the note entries of the pen-edit index
 * (their page and place, as the Review last saw them) and the Outline's own scan. The scan holds
 * every textbox, so a chosen paragraph that isn't among them is gone. Pure.
 */

export type NoteCount = {comments: number; images: number};

/** The Outline's blocks as paragraphs a note may belong to: their file follows the dividers. */
export function blockCandidates(blocks: OutlineBlock[]): ParagraphCandidate[] {
  let file: string | null = null;
  return blocks.map(block => {
    if (block.kind === 'file') {
      file = block.fileSource;
    }
    return {
      uuid: block.key,
      blockId: block.tagId,
      page: block.page,
      rect: block.rect,
      region: block.aside ? 'aside' : 'text',
      file: block.aside ? null : file,
    };
  });
}

/** Comments and images per block key; blocks without any are left out. */
export function noteCounts(blocks: OutlineBlock[], entries: PenEditEntry[]): Map<string, NoteCount> {
  const candidates = blockCandidates(blocks);
  const counts = new Map<string, NoteCount>();
  for (const entry of entries) {
    if (entry.state !== 'active' || !isNoteKind(entry.kind)) {
      continue;
    }
    const section = sectionAt({page: entry.page, rect: entry.rect}, candidates, {region: 'text', file: null});
    const result = paragraphOf({page: entry.page, rect: entry.rect, ...section}, candidates, entry.note?.paragraph);
    if ('none' in result) {
      continue;
    }
    const count = counts.get(result.uuid) ?? {comments: 0, images: 0};
    counts.set(result.uuid, entry.kind === 'comment' ? {...count, comments: count.comments + 1} : {...count, images: count.images + 1});
  }
  return counts;
}

/** What a block row shows: "C 2", "▣ 1", or both; empty for none. */
export function noteCountLabel(count: NoteCount | undefined, imageGlyph: string): string {
  if (!count) {
    return '';
  }
  return [count.comments > 0 ? `C ${count.comments}` : null, count.images > 0 ? `${imageGlyph} ${count.images}` : null]
    .filter(Boolean)
    .join(' ');
}

/**
 * The planned line's note when a block with comments or images moves or is set aside: they stay
 * where they were drawn in this version (§0.8). `moving`: the keys of the blocks that move.
 */
export function notesStayLine(moving: string[], counts: Map<string, NoteCount>): string | null {
  return moving.some(key => counts.has(key)) ? 'Its comments stay where they are (moving them comes later).' : null;
}
