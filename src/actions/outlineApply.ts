import type {Element, TextBox} from 'sn-plugin-lib';
import {withAside} from '../domain/blockTag';
import {withHeadingLevel} from '../domain/headingText';
import type {TextboxImportRoleStyle} from '../domain/importSettings';
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
import {startsPage, textArea} from '../domain/pageLayout';
import {plural} from '../domain/plural';
import {isNormalTextElement} from '../domain/textboxEditPlan';
import {isOwnTitle} from '../domain/noteTitlesPlan';
import {ELEMENT_TYPE_TITLE, type PageElementData, type Rect, type TextboxData} from '../domain/textboxModel';
import {writeBackupFile} from '../storage/backupFile';
import {getSettings} from '../storage/settingsFile';
import {estimateTextboxHeight} from '../supernote/textboxMetrics';
import {syncTitles} from './titleSync';
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
 * Applying the Outline's planned changes (technical-design-manuscript.md §5.4–§5.5,
 * technical-design-outline-sections.md §3): check which pages a rebuild touches and what is in the
 * way, then change heading levels, move, set aside and delete the textboxes. A level change
 * rewrites the textbox's #s and gives it the import's style for its level; if that makes it taller,
 * its page is laid out again from there. A textbox that stays on its page only gets a new place
 * (it keeps its number and tag); one that goes to another page is written there again with its
 * style and tag, then removed from where it was. One backup of every textbox on the pages touched,
 * one save before anything changes, our titles put right afterwards.
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
  kind: 'edits' | 'unread' | 'handwriting' | 'title' | 'plan';
};

export type RebuildCheck = {
  layout: RebuildLayout | null;
  /** Headings whose level changes: their new text, style and size (at their old place). */
  levels: Map<string, LevelEdit>;
  aside: Map<string, Placement>;
  /** Every page the changes touch: rebuilt, or losing a set-aside or deleted block. */
  pages: number[];
  frame: PageFrame;
  blockers: RebuildBlocker[];
};

/** A heading's new level on the page: its text, the style of its level, its size there. */
export type LevelEdit = {text: string; style: TextboxImportRoleStyle; rect: Rect};

/** Below this, a new height is the same height (measuring isn't exact to the pixel). */
const GROWN_PX = 4;

/** The import's style for a level: # to ### their heading styles, 0 the paragraph style. */
function levelStyle(level: number): TextboxImportRoleStyle {
  const structure = getSettings().import.structure;
  return level === 1
    ? structure.heading1
    : level === 2
    ? structure.heading2
    : level >= 3
    ? structure.heading3
    : structure.paragraph;
}

/** Every level change with its new text, style and measured size. */
async function levelEdits(
  notePath: string,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
): Promise<Map<string, LevelEdit>> {
  const edits = new Map<string, LevelEdit>();
  const staying = new Set(planned.order.map(block => block.key));
  const fonts = new Map<number, Map<number, string | undefined>>();
  for (const block of blocks) {
    const change = planned.levels.get(block.key);
    if (!change || !staying.has(block.key)) {
      continue;
    }
    if (!fonts.has(block.page)) {
      const elements = await readPageElements(notePath, block.page, `Could not read page ${block.page + 1}.`);
      try {
        fonts.set(
          block.page,
          new Map(elements.filter(isNormalTextElement).map(item => [item.numInPage, item.textBox?.fontPath ?? undefined])),
        );
      } finally {
        await recycleElements(elements);
      }
    }
    const text = withHeadingLevel(block.text, change.to as 0 | 1 | 2 | 3);
    const style = levelStyle(change.to);
    const height = await estimateTextboxHeight(
      text,
      block.rect.right - block.rect.left,
      style.fontSize,
      fonts.get(block.page)?.get(block.numInPage),
    );
    edits.set(block.key, {text, style, rect: {...block.rect, bottom: block.rect.top + Math.ceil(height)}});
  }
  return edits;
}

/** Reads the touched pages and says what stands in the way of the rebuild. */
export async function checkRebuild(
  notePath: string,
  pageCount: number,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
  review: ReviewPages,
): Promise<RebuildCheck> {
  const frame = await pageFrame(notePath, blocks);
  const layoutSettings = getSettings().layout;
  const levels = await levelEdits(notePath, blocks, planned);
  // A heading that grows lays its page out again; one that shrinks keeps its place.
  const heights = new Map(
    [...levels]
      .filter(([key, edit]) => {
        const block = blocks.find(item => item.key === key);
        return !!block && edit.rect.bottom - block.rect.bottom > GROWN_PX;
      })
      .map(([key, edit]) => [key, edit.rect.bottom - edit.rect.top]),
  );
  // Whether a block starts a page goes by its planned level.
  const layoutBlocks = blocks.map(block => {
    const level = planned.levels.get(block.key)?.to ?? block.level;
    const kind = block.kind === 'file' ? 'file' : level ? 'heading' : 'paragraph';
    return {...block, startsPage: startsPage({kind, level: level ?? null}, layoutSettings)};
  });
  const layout = layoutRebuild(
    layoutBlocks,
    planned.order.map(block => block.key),
    frame,
    pageCount,
    heights,
  );
  const removedPages = [...planned.aside, ...planned.deleted].map(
    block => block.page,
  );
  const rebuilt = new Set([
    ...(layout?.pages ?? []).filter(page => page < pageCount),
    ...removedPages,
  ]);
  const levelPages = blocks.filter(block => levels.has(block.key)).map(block => block.page);
  const pages = [...new Set([...rebuilt, ...levelPages])].sort((a, b) => a - b);
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
    if (!rebuilt.has(page)) {
      // Only headings change here, in place: nothing on the page moves.
      continue;
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
      // Our titles (over linked files' names and headings) are put back after the rebuild
      // (`syncTitles`); other titles can't be moved yet.
      if (elements.some(element => element.type === ELEMENT_TYPE_TITLE && !isOwnTitle(element as unknown as PageElementData))) {
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
  return {layout, levels, aside, pages, frame, blockers};
}

/**
 * The area textboxes are stacked in: the page layout's text area (technical-design-settings-layout-files.md
 * §1). Without the page size, from the highest textbox top to the lowest bottom.
 */
async function pageFrame(
  notePath: string,
  blocks: OutlineBlock[],
): Promise<PageFrame> {
  const size = await readPageSizeForDiagnostics(notePath, 0);
  if (typeof size !== 'string') {
    const area = textArea(size, getSettings().layout);
    return {top: area.top, bottom: area.bottom};
  }
  return {
    top: Math.max(0, Math.min(...blocks.map(block => block.rect.top))),
    bottom: Math.max(...blocks.map(block => block.rect.bottom)),
  };
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
    block =>
      placements.has(block.key) ||
      removed.has(block.key) ||
      check.levels.has(block.key),
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
        const element = withLevel(
          elementOf.get(block.key) as TextElement,
          removed.has(block.key) ? undefined : check.levels.get(block.key),
        );
        const place = placements.get(block.key);
        if (!removed.has(block.key) && (!place || place.page === page)) {
          moved.push({
            ...element,
            textBox: {...element.textBox, textRect: place?.rect ?? element.textBox.textRect},
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
    // Titles over linked files' names follow their dividers (technical-design-linked-files.md §4).
    const touched = [...check.pages, ...inserts.keys()];
    try {
      await syncTitles(notePath, touched);
    } catch (error) {
      console.warn('[OutlineApply] file titles not synced', String(error));
    }

    const moves = [...planned.marks.values()].filter(mark => mark === 'moved').length;
    const counts = [
      check.levels.size > 0 ? `${plural(check.levels.size, 'heading level')} changed` : null,
      moves > 0 ? `${plural(moves, 'block')} moved` : null,
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

/** The textbox with its heading's new level: text, size, weight and height; as it was without one. */
function withLevel(element: TextElement, edit: LevelEdit | undefined): TextElement {
  if (!edit) {
    return element;
  }
  return {
    ...element,
    textBox: {
      ...element.textBox,
      textContentFull: edit.text,
      fontSize: edit.style.fontSize,
      textBold: edit.style.bold ? 1 : 0,
      textRect: edit.rect,
    },
  } as TextElement;
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
