import type {Element, TextBox} from 'sn-plugin-lib';
import {parseBlockTag} from '../domain/blockTag';
import {movedNote, paragraphAt, type NoteRow, type PageParagraph} from '../domain/notes/noteRows';
import {paragraphOf, sectionAt, sectionsOf, type ParagraphResult, type Section} from '../domain/notes/paragraphOf';
import {updatePenEdit, type PenEditEntry} from '../domain/penEditModel';
import {isNoteKind} from '../domain/penEditTags';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import type {Rect} from '../domain/textboxModel';
import {changePenEditIndex, penEditPictureUri, readPenEditIndex} from '../storage/penEditStore';
import {readNotePageCount, readPageElements, recycleElements} from '../supernote/noteElements';

/**
 * A page's comments and images in the Review (technical-design-comments-images.md §5.1): their
 * paragraphs by `paragraphOf`, on the textboxes the page read already has (no measuring). Nothing
 * is written on the page while reading. A stored paragraph that is not on this page is looked for
 * on the other pages, nearest first; only when no page has it is it gone. A note whose handwriting
 * was moved with the lasso gets its new place in the index (the Outline counts from there, §6).
 */

type TextElement = Element & {textBox: TextBox};

/**
 * The page's textboxes as paragraphs a note may belong to, in reading order. A page starts in the
 * section its first textbox names (an imported textbox carries its file), else in the text with no
 * file; dividers on the page start theirs.
 */
export function pageParagraphs(page: number, pageElements: Element[]): {paragraphs: PageParagraph[]; carry: Section} {
  const textboxes = sortTextElements(pageElements.filter(isNormalTextElement) as TextElement[]);
  const tags = textboxes.map(textbox => parseBlockTag(textbox.userData));
  const carry: Section = {region: 'text', file: tags[0]?.k !== 'f' && tags[0]?.s ? tags[0].s : null};
  const sections = sectionsOf(tags, carry);
  return {
    carry,
    paragraphs: textboxes.map((textbox, index) => ({
      uuid: textbox.uuid,
      blockId: tags[index]?.id ?? null,
      page,
      rect: {...textbox.textBox.textRect},
      region: sections[index].region,
      file: sections[index].file,
      numInPage: textbox.numInPage,
      text: textbox.textBox.textContentFull || '',
    })),
  };
}

/** Looks for a block on the other pages, nearest first: its page's paragraphs, or null. */
async function findBlockElsewhere(notePath: string, page: number, blockId: string): Promise<PageParagraph[] | null> {
  const count = await readNotePageCount(notePath);
  const order = Array.from({length: count}, (_, index) => index)
    .filter(index => index !== page)
    .sort((a, b) => Math.abs(a - page) - Math.abs(b - page) || a - b);
  for (const other of order) {
    let elements: Element[] = [];
    try {
      elements = await readPageElements(notePath, other, `Could not read page ${other + 1}.`);
      const {paragraphs} = pageParagraphs(other, elements);
      if (paragraphs.some(item => item.blockId === blockId)) {
        return paragraphs;
      }
    } finally {
      await recycleElements(elements);
    }
  }
  return null;
}

/**
 * The page's notes with their paragraphs. `snippetRects`: where each entry's handwriting is now.
 * Returns the page's paragraphs too (for ‹ › and the page map).
 */
export async function readNotesOfPage(
  notePath: string,
  page: number,
  pageElements: Element[],
  entries: PenEditEntry[],
  snippetRects: Map<string, Rect>,
): Promise<{notes: NoteRow[]; paragraphs: PageParagraph[]}> {
  const notes = entries.filter(entry => entry.state === 'active' && isNoteKind(entry.kind));
  const {paragraphs} = pageParagraphs(page, pageElements);
  if (notes.length === 0) {
    return {notes: [], paragraphs};
  }
  const rows: NoteRow[] = [];
  const moved: PenEditEntry[] = [];
  for (const entry of notes) {
    const rect = snippetRects.get(entry.id) ?? entry.rect;
    const at = {page, rect, ...sectionAt({page, rect}, paragraphs, {region: 'text', file: null})};
    const stored = entry.note?.paragraph;
    let result: ParagraphResult = paragraphOf(at, paragraphs, stored);
    let known = paragraphs;
    if (stored && 'gone' in result) {
      const elsewhere = await findBlockElsewhere(notePath, page, stored).catch(error => {
        console.warn('[NotesRead] other pages not read', JSON.stringify({id: entry.id, error: String(error)}));
        return null;
      });
      if (elsewhere) {
        known = [...paragraphs, ...elsewhere];
        result = paragraphOf(at, known, stored);
      }
    }
    rows.push({
      id: entry.id,
      kind: entry.kind as NoteRow['kind'],
      page,
      rect,
      note: entry.note ?? {},
      paragraph: result,
      at: paragraphAt(result, known),
      pictureUri: entry.hasPicture ? await penEditPictureUri(entry.id) : null,
    });
    const now = entry.strokesTagged ? movedNote(entry, rect) : null;
    if (now) {
      moved.push(now);
    }
  }
  if (moved.length > 0) {
    await changePenEditIndex(current =>
      moved.reduce((next, entry) => updatePenEdit(next, entry.id, item => ({...item, rect: entry.rect, strokeRects: entry.strokeRects})), current),
    ).catch(error => console.warn('[NotesRead] moved notes not stored', String(error)));
  }
  console.log('[NotesRead] page', JSON.stringify({page, notes: rows.length, stored: rows.filter(row => 'by' in row.paragraph && row.paragraph.by === 'stored').length, moved: moved.length}));
  return {notes: rows, paragraphs};
}

/** The note's comments and images as the index has them (the Outline counts them, §6). */
export async function readNoteEntries(notePath: string): Promise<PenEditEntry[]> {
  const {index} = await readPenEditIndex();
  return index.entries.filter(entry => entry.notePath === notePath && entry.state === 'active' && isNoteKind(entry.kind));
}
