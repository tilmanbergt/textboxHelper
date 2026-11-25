import type {NoteAt, ParagraphCandidate, Region} from '../../src/domain/notes/paragraphOf';

/**
 * Builders for the notes tables: a paragraph is a full-width textbox from `top` to `bottom` on a
 * page; a note is handwriting beside the text at a height. Names stand in for uuids, so a case
 * reads "belongs to p2".
 */

export function box(
  uuid: string,
  top: number,
  bottom: number,
  options: {page?: number; region?: Region; file?: string | null; blockId?: string | null; left?: number} = {},
): ParagraphCandidate {
  const left = options.left ?? 100;
  return {
    uuid,
    blockId: options.blockId === undefined ? `b-${uuid}` : options.blockId,
    page: options.page ?? 0,
    rect: {left, top, right: left + 1000, bottom},
    region: options.region ?? 'text',
    file: options.file ?? null,
  };
}

export function note(top: number, bottom: number, options: {page?: number; region?: Region; file?: string | null} = {}): NoteAt {
  return {
    page: options.page ?? 0,
    rect: {left: 1150, top, right: 1350, bottom},
    region: options.region ?? 'text',
    file: options.file ?? null,
  };
}
