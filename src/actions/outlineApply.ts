import type {Element, TextBox} from 'sn-plugin-lib';
import {withHeadingLevel} from '../domain/headingText';
import type {TextboxImportRoleStyle} from '../domain/importSettings';
import {createOutlineBackupPayload} from '../domain/backupPayload';
import {
  layoutAside,
  layoutNote,
  shiftedPage,
  type NoteRebuild,
  type PageFrame,
  type Placement,
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
import {ASIDE_DIVIDER_KEY, asideDividerBlock, asideDividerInsert} from './asideArea';
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
  insertNotePages,
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
  layout: NoteRebuild | null;
  /** Headings whose level changes: their new text, style and size (at their old place). */
  levels: Map<string, LevelEdit>;
  aside: Map<string, Placement>;
  /** Where a new aside divider goes (after the inserted pages), or null. */
  divider: Placement | null;
  /** Every page the changes touch: rebuilt, or losing a set-aside or deleted block (as the note is now). */
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
  const area = await pageArea(notePath, blocks);
  const frame: PageFrame = {top: area.top, bottom: area.bottom};
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
    const kind = block.kind === 'file' || block.kind === 'aside' ? block.kind : level ? 'heading' : 'paragraph';
    return {...block, startsPage: startsPage({kind, level: level ?? null}, layoutSettings)};
  });
  // Set aside before the divider existed: the divider gets a page of its own before the area.
  const legacy = blocks.some(block => block.aside) && !blocks.some(block => block.kind === 'aside');
  const planAside = planned.order.findIndex(block => block.aside);
  const layout = layoutNote(
    layoutBlocks,
    planned.order.map(block => block.key),
    planAside >= 0 ? planAside : planned.order.length,
    frame,
    pageCount,
    heights,
    legacy,
  );
  const removedPages = [...planned.aside, ...planned.deleted].map(
    block => block.page,
  );
  const rebuilt = new Set([...(layout?.pages ?? []), ...removedPages]);
  const levelPages = blocks.filter(block => levels.has(block.key)).map(block => block.page);
  const pages = [...new Set([...rebuilt, ...levelPages])].sort((a, b) => a - b);
  const lastPage = pageCount - 1 + (layout?.insertCount ?? 0) + (layout?.appendCount ?? 0);
  // The first set aside of a note without aside area starts it with the divider.
  const newDivider = planned.aside.length > 0 && !blocks.some(block => block.aside);
  const dividerBlock = newDivider || layout?.dividerPage != null ? await asideDividerBlock(area) : null;
  const aside = layoutAside([...(newDivider && dividerBlock ? [dividerBlock] : []), ...planned.aside], frame, lastPage);
  const dividerHeight = dividerBlock ? dividerBlock.rect.bottom - dividerBlock.rect.top : 0;
  const divider: Placement | null = newDivider
    ? aside.get(ASIDE_DIVIDER_KEY) ?? null
    : dividerBlock && layout?.dividerPage != null
    ? {page: layout.dividerPage, rect: {...dividerBlock.rect, top: frame.top, bottom: frame.top + dividerHeight}}
    : null;
  aside.delete(ASIDE_DIVIDER_KEY);

  const blockers: RebuildBlocker[] = [];
  if (legacy && layout?.dividerPage == null && (layout || planned.aside.length > 0)) {
    const first = blocks.find(block => block.aside);
    blockers.push({
      page: first?.page ?? 0,
      kind: 'plan',
      reason: 'set-aside text shares this page with the text: move it to a page of its own with the lasso first',
    });
  }
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
  return {layout, levels, aside, divider, pages, frame, blockers};
}

/**
 * The area textboxes are stacked in: the page layout's text area (technical-design-settings-layout-files.md
 * §1). Without the page size, from the textboxes' extent.
 */
async function pageArea(notePath: string, blocks: OutlineBlock[]): Promise<Rect> {
  const size = await readPageSizeForDiagnostics(notePath, 0);
  if (typeof size !== 'string') {
    return textArea(size, getSettings().layout);
  }
  return {
    left: Math.max(0, Math.min(...blocks.map(block => block.rect.left))),
    right: Math.max(...blocks.map(block => block.rect.right)),
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

    // Pages before the aside area first (text that grew, a divider of its own), then at the end.
    const shift = {insertAt: check.layout?.insertAt ?? pageCount, insertCount: check.layout?.insertCount ?? 0};
    const at = (page: number) => shiftedPage(shift, page);
    if (shift.insertCount > 0) {
      onProgress(`Adding ${plural(shift.insertCount, 'page')}…`);
      await insertNotePages(notePath, shift.insertAt, shift.insertCount);
    }
    const count = pageCount + shift.insertCount;
    const newPages = Math.max(
      check.layout?.appendCount ?? 0,
      ...[...check.aside.values(), ...(check.divider ? [check.divider] : [])].map(place => place.page + 1 - count),
      0,
    );
    if (newPages > 0) {
      onProgress(`Adding ${plural(newPages, 'page')}…`);
      await appendNotePages(notePath, count, newPages);
    }

    // Per page: new places first, then removals; new textboxes last (inserting may renumber).
    const inserts = new Map<number, StyledTextboxInsert[]>();
    if (check.divider) {
      inserts.set(check.divider.page, [asideDividerInsert(check.divider)]);
    }
    for (const page of check.pages) {
      onProgress(`Changing page ${at(page) + 1}…`);
      const moved: Element[] = [];
      const gone: number[] = [];
      for (const block of changed.filter(item => item.page === page)) {
        const element = withLevel(
          elementOf.get(block.key) as TextElement,
          removed.has(block.key) ? undefined : check.levels.get(block.key),
        );
        const place = placements.get(block.key);
        if (!removed.has(block.key) && (!place || place.page === at(page))) {
          moved.push({
            ...element,
            textBox: {...element.textBox, textRect: place?.rect ?? element.textBox.textRect},
          } as Element);
          continue;
        }
        gone.push(element.numInPage);
        if (place) {
          inserts.set(place.page, [...(inserts.get(place.page) ?? []), insertOf(element, place)]);
        }
      }
      await modifyPageElements(notePath, at(page), moved);
      await deletePageElements(notePath, at(page), gone);
    }
    for (const [page, items] of inserts) {
      onProgress(`Writing page ${page + 1}…`);
      await insertTextboxesIntoFile(notePath, page, items);
    }
    // Titles over linked files' names follow their dividers (technical-design-linked-files.md §4).
    const touched = [...check.pages.map(at), ...inserts.keys()];
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
      check.divider ? '“Set aside” started' : null,
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

/** A textbox written on another page: its text, style and tag go along. */
function insertOf(element: TextElement, place: Placement): StyledTextboxInsert {
  return {
    text: element.textBox.textContentFull ?? '',
    rect: place.rect,
    userData: typeof element.userData === 'string' ? element.userData : null,
    style: textboxStyle(element.textBox as TextboxData),
  };
}
