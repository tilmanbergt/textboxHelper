import type {Element, TextBox} from 'sn-plugin-lib';
import {withAside} from '../domain/blockTag';
import {createOutlineBackupPayload} from '../domain/backupPayload';
import {
  layoutAside,
  layoutRebuild,
  type PageFrame,
  type Placement,
  type RebuildLayout,
} from '../domain/outlineLayout';
import type {OutlineBlock} from '../domain/outlineModel';
import type {PlannedOrder} from '../domain/outlinePlan';
import {isPenEditDecoration} from '../domain/penEditTags';
import {plural} from '../domain/plural';
import {isNormalTextElement} from '../domain/textboxEditPlan';
import {ELEMENT_TYPE_TITLE, type TextboxData} from '../domain/textboxModel';
import {writeBackupFile} from '../storage/backupFile';
import {
  deletePageElements,
  modifyPageElements,
  readPageElements,
  readPageSizeForDiagnostics,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {
  appendNotePages,
  insertTextboxesIntoFile,
  textboxStyle,
  type StyledTextboxInsert,
} from '../supernote/noteTextInsertion';

/**
 * Applying the Outline's planned changes (technical-design-manuscript.md §5.4–§5.5): check which
 * pages a rebuild touches and what is in the way, then move, set aside and delete the textboxes.
 * A textbox that stays on its page only gets a new place (it keeps its number and tag); one that
 * goes to another page is written there again with its style and tag, then removed from where it
 * was. One backup of every textbox on the pages touched, one save before anything changes.
 */

type TextElement = Element & {textBox: TextBox};

/** What the Review knows about the pages, for the check. */
export type ReviewPages = {
  /** Edits waiting, per page read. */
  pendingByPage: Map<number, number>;
  /** Pages the Review hasn't read yet. */
  unread: number[];
};

export type RebuildBlocker = {
  page: number;
  reason: string;
  kind: 'edits' | 'unread' | 'handwriting' | 'title';
};

export type RebuildCheck = {
  layout: RebuildLayout | null;
  aside: Map<string, Placement>;
  /** Every page the changes touch: rebuilt, or losing a set-aside or deleted block. */
  pages: number[];
  frame: PageFrame;
  blockers: RebuildBlocker[];
};

/** Reads the touched pages and says what stands in the way of the rebuild. */
export async function checkRebuild(
  notePath: string,
  pageCount: number,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
  review: ReviewPages,
): Promise<RebuildCheck> {
  const frame = await pageFrame(notePath, blocks);
  const layout = layoutRebuild(
    blocks,
    planned.order.map(block => block.key),
    frame,
    pageCount,
  );
  const removedPages = [...planned.aside, ...planned.deleted].map(
    block => block.page,
  );
  const pages = [
    ...new Set([
      ...(layout?.pages ?? []).filter(page => page < pageCount),
      ...removedPages,
    ]),
  ].sort((a, b) => a - b);
  const lastPage = Math.max(pageCount - 1, ...(layout?.pages ?? []));
  const aside = layoutAside(planned.aside, frame, lastPage);

  const blockers: RebuildBlocker[] = [];
  for (const page of pages) {
    if (review.unread.includes(page)) {
      blockers.push({
        page,
        kind: 'unread',
        reason:
          'not read in the Review yet: read it first, so no edits are lost',
      });
      continue;
    }
    const pending = review.pendingByPage.get(page) ?? 0;
    if (pending > 0) {
      blockers.push({
        page,
        kind: 'edits',
        reason: `${plural(pending, 'edit')} waiting: apply or drop them first`,
      });
    }
    const elements = await readPageElements(
      notePath,
      page,
      `Could not read page ${page + 1}.`,
    );
    try {
      const loose = elements.filter(
        element =>
          !isNormalTextElement(element) &&
          !isPenEditDecoration(element) &&
          element.type !== ELEMENT_TYPE_TITLE,
      ).length;
      if (loose > 0) {
        blockers.push({
          page,
          kind: 'handwriting',
          reason:
            'handwriting outside textboxes would stay where it is while the text moves: lasso it into a textbox, move it off the page, or erase it',
        });
      }
      if (elements.some(element => element.type === ELEMENT_TYPE_TITLE)) {
        blockers.push({
          page,
          kind: 'title',
          reason: 'a heading made with NOTE’s title can’t be moved yet',
        });
      }
    } finally {
      await recycleElements(elements);
    }
  }
  return {layout, aside, pages, frame, blockers};
}

/** The area textboxes are stacked in: from the highest textbox top, as far from the page's bottom. */
async function pageFrame(
  notePath: string,
  blocks: OutlineBlock[],
): Promise<PageFrame> {
  const size = await readPageSizeForDiagnostics(notePath, 0);
  const top = Math.max(0, Math.min(...blocks.map(block => block.rect.top)));
  const pageHeight =
    typeof size === 'string'
      ? Math.max(...blocks.map(block => block.rect.bottom)) + top
      : size.height;
  return {top, bottom: pageHeight - top};
}

export async function applyOutlinePlan(
  notePath: string,
  pageCount: number,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
  check: RebuildCheck,
  onProgress: (message: string) => void,
): Promise<{message: string; backupPath: string}> {
  if (check.blockers.length > 0) {
    throw new Error('Something on these pages is in the way of the changes.');
  }
  const placements = new Map([
    ...(check.layout?.placements ?? []),
    ...check.aside,
  ]);
  const removed = new Set(planned.deleted.map(block => block.key));
  const changed = blocks.filter(
    block => placements.has(block.key) || removed.has(block.key),
  );

  onProgress('Saving the note…');
  await saveCurrentNoteForConsistency('changing the order of textboxes');

  const read = new Map<number, Element[]>();
  try {
    onProgress('Reading the pages again…');
    for (const page of check.pages) {
      read.set(
        page,
        await readPageElements(
          notePath,
          page,
          `Could not read page ${page + 1}.`,
        ),
      );
    }
    // Every changed block's textbox, found again by number and text.
    const elementOf = new Map<string, TextElement>();
    for (const block of changed) {
      const element = (read.get(block.page) ?? []).find(
        item =>
          isNormalTextElement(item) &&
          item.numInPage === block.numInPage &&
          (item.textBox.textContentFull ?? '').trim() === block.text,
      ) as TextElement | undefined;
      if (!element) {
        throw new Error(
          `A textbox on page ${
            block.page + 1
          } changed since the outline was read. Read it again.`,
        );
      }
      elementOf.set(block.key, element);
    }

    onProgress('Writing the backup…');
    const {backupPath} = await writeBackupFile(
      createOutlineBackupPayload(
        notePath,
        check.pages.map(page => ({
          page,
          textboxes: (read.get(page) ?? []).filter(isNormalTextElement),
        })),
      ),
    );

    const newPages = Math.max(
      check.layout?.newPages ?? 0,
      ...[...check.aside.values()].map(place => place.page + 1 - pageCount),
      0,
    );
    if (newPages > 0) {
      onProgress(`Adding ${plural(newPages, 'page')}…`);
      await appendNotePages(notePath, pageCount, newPages);
    }

    // Per page: new places first, then removals; new textboxes last (inserting may renumber).
    const inserts = new Map<number, StyledTextboxInsert[]>();
    for (const page of check.pages) {
      onProgress(`Changing page ${page + 1}…`);
      const moved: Element[] = [];
      const gone: number[] = [];
      for (const block of changed.filter(item => item.page === page)) {
        const element = elementOf.get(block.key) as TextElement;
        const place = placements.get(block.key);
        if (place && place.page === page) {
          moved.push({
            ...element,
            textBox: {...element.textBox, textRect: place.rect},
          } as Element);
          continue;
        }
        gone.push(element.numInPage);
        if (place) {
          inserts.set(place.page, [
            ...(inserts.get(place.page) ?? []),
            insertOf(element, place, check.aside.has(block.key)),
          ]);
        }
      }
      await modifyPageElements(notePath, page, moved);
      await deletePageElements(notePath, page, gone);
    }
    for (const [page, items] of inserts) {
      onProgress(`Writing page ${page + 1}…`);
      await insertTextboxesIntoFile(notePath, page, items);
    }

    const counts = [
      planned.marks.size - planned.aside.length - planned.deleted.length > 0
        ? plural(
            planned.marks.size - planned.aside.length - planned.deleted.length,
            'block',
          ) + ' moved'
        : null,
      planned.aside.length > 0 ? `${planned.aside.length} set aside` : null,
      planned.deleted.length > 0 ? `${planned.deleted.length} deleted` : null,
    ].filter(Boolean);
    return {
      message: `${counts.join(', ')} on ${plural(check.pages.length, 'page')}.`,
      backupPath,
    };
  } finally {
    for (const elements of read.values()) {
      await recycleElements(elements);
    }
  }
}

/** A set-aside block's tag says so, so a linked file leaves it out (technical-design-source-link.md §2.4). */
function insertOf(element: TextElement, place: Placement, aside: boolean): StyledTextboxInsert {
  return {
    text: element.textBox.textContentFull ?? '',
    rect: place.rect,
    userData: withAside(typeof element.userData === 'string' ? element.userData : null, aside),
    style: textboxStyle(element.textBox as TextboxData),
  };
}
