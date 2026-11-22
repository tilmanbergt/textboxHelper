import type {Element, TextBox} from 'sn-plugin-lib';
import {createOutlineBackupPayload} from '../domain/backupPayload';
import {formatBlockTag, newBlockId, parseBlockTag, type BlockTag} from '../domain/blockTag';
import {
  blocksInScope,
  cleanupRange,
  fileStartsPage,
  fitText,
  groupText,
  layoutCleanup,
  pieceGroups,
  type CleanupBox,
} from '../domain/cleanupLayout';
import type {TextboxImportRoleStyle} from '../domain/importSettings';
import {layoutAside, type Placement} from '../domain/outlineLayout';
import type {OutlineBlock} from '../domain/outlineModel';
import type {PlannedOrder} from '../domain/outlinePlan';
import {startsPage, textArea} from '../domain/pageLayout';
import {isPenEditDecoration} from '../domain/penEditTags';
import {plural} from '../domain/plural';
import {isNormalTextElement} from '../domain/textboxEditPlan';
import {isOwnTitle} from '../domain/noteTitlesPlan';
import {ELEMENT_TYPE_TITLE, type PageElementData, type Rect, type TextboxData} from '../domain/textboxModel';
import {writeBackupFile} from '../storage/backupFile';
import {getSettings} from '../storage/settingsFile';
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
  removeNotePages,
  textboxStyle,
  type StyledTextboxInsert,
} from '../supernote/noteTextInsertion';
import {measureTextboxHeight} from '../supernote/textboxMetrics';
import type {RebuildBlocker, ReviewPages} from './outlineApply';
import {syncTitles} from './titleSync';
import {ASIDE_DIVIDER_KEY, asideDividerBlock, asideDividerInsert} from './asideArea';

/**
 * Clean up layout (technical-design-settings-layout-files.md §2): the whole note or one linked
 * file laid out again — every block in the page layout's text area, in the style of its kind and
 * level, a new page before each file and before headings set to break; blocks too tall for the
 * text area cut into pieces, pieces cut before joined first. It takes the Outline's other planned
 * changes along (order, levels, set aside, delete). For a file, pages are inserted or removed
 * before the next file, so the files after it don't move; pages left without text are removed
 * unless they hold handwriting, which stays where it is. One backup, one save before, our titles
 * put right afterwards.
 */

type TextElement = Element & {textBox: TextBox};

/** One block of its file (with the pieces cut from it) and the textboxes it becomes. */
type CleanupGroup = {
  blocks: OutlineBlock[];
  pieces: Array<{id: string; text: string}>;
  /** The style of its kind and level; null keeps its own (a protected block's placeholder). */
  style: TextboxImportRoleStyle | null;
};

export type CleanupCheck = {
  kind: 'cleanup';
  /** The pages it lays out (and those losing a set-aside or deleted block). */
  pages: number[];
  blockers: RebuildBlocker[];
  groups: CleanupGroup[];
  placements: Map<string, Placement>;
  range: {first: number; last: number};
  /** Pages the scope fills afterwards, from its first page. */
  pageCount: number;
  /** Pages of the range that hold handwriting: it stays where it is. */
  handwriting: number[];
  /** Pages of the range that are left without text and can go (no handwriting on them). */
  removable: number[];
  area: Rect;
  /** Short line for the check: what is split, what stays. */
  note: string;
};

/** The import's style for a block: its level's heading style, a file's divider as `#`. */
function styleOf(block: OutlineBlock): TextboxImportRoleStyle | null {
  if (block.placeholder) {
    return null;
  }
  const structure = getSettings().import.structure;
  const level = block.kind === 'file' ? 1 : block.level ?? 0;
  return level === 1 ? structure.heading1 : level === 2 ? structure.heading2 : level >= 3 ? structure.heading3 : structure.paragraph;
}

/** What is on a page besides the scope's textboxes: handwriting, other textboxes, others' titles. */
function pageContents(elements: Element[], scoped: Set<number>) {
  const loose = elements.some(
    element => !isNormalTextElement(element) && !isPenEditDecoration(element) && element.type !== ELEMENT_TYPE_TITLE,
  );
  const otherText = elements.some(element => isNormalTextElement(element) && !scoped.has(element.numInPage));
  const userTitle = elements.some(
    element => element.type === ELEMENT_TYPE_TITLE && !isOwnTitle(element as unknown as PageElementData),
  );
  return {loose, otherText, userTitle};
}

export async function checkCleanup(
  notePath: string,
  pageCount: number,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
  review: ReviewPages,
): Promise<CleanupCheck> {
  const scope = planned.cleanup;
  if (!scope) {
    throw new Error('No clean up is planned.');
  }
  const size = await readPageSizeForDiagnostics(notePath, 0);
  if (typeof size === 'string') {
    throw new Error(`Could not read the page size (${size}).`);
  }
  const layout = getSettings().layout;
  const area = textArea(size, layout);
  const scoped = blocksInScope(planned.order, scope);
  const original = new Map(blocks.map(block => [block.key, block]));
  const range = cleanupRange(
    scoped.map(block => original.get(block.key) ?? block),
    blocks,
    scope,
  );
  if (!range) {
    throw new Error('Nothing to clean up.');
  }
  const blockers: RebuildBlocker[] = [];
  if (scope.kind === 'file' && !fileStartsPage(blocks, scope.sourceId)) {
    blockers.push({
      page: range.first,
      kind: 'title',
      reason: 'the file shares its first page with the file before: clean up the whole note once first',
    });
  }

  // Changes planned outside a file's clean up would be lost: they go first.
  const inScope = new Set([...scoped, ...planned.aside, ...planned.deleted].map(block => block.key));
  const outside = [...planned.marks.keys()].find(key => !inScope.has(key));
  if (outside) {
    blockers.push({
      page: original.get(outside)?.page ?? range.first,
      kind: 'plan',
      reason: 'a change is planned outside this file: apply it first, then clean up',
    });
  }

  // Each page once: fonts for measuring, what else is on it.
  const rangePages = Array.from({length: range.last - range.first + 1}, (_, index) => range.first + index);
  const removedPages = [...planned.aside, ...planned.deleted].map(block => block.page);
  const pages = [...new Set([...rangePages, ...removedPages])].sort((a, b) => a - b);
  const scopedByPage = new Map<number, Set<number>>();
  for (const block of scoped) {
    const at = original.get(block.key) ?? block;
    scopedByPage.set(at.page, (scopedByPage.get(at.page) ?? new Set()).add(at.numInPage));
  }
  const fonts = new Map<string, string | undefined>();
  const handwriting: number[] = [];
  const keep = new Set<number>();
  for (const page of pages) {
    if (review.unread.includes(page)) {
      blockers.push({page, kind: 'unread', reason: 'not read in the Review yet: read it first, so no edits are lost'});
      continue;
    }
    const pending = review.pendingByPage.get(page) ?? 0;
    if (pending > 0) {
      blockers.push({page, kind: 'edits', reason: `${plural(pending, 'edit')} waiting: apply or drop them first`});
    }
    const elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    try {
      for (const element of elements.filter(isNormalTextElement)) {
        fonts.set(`${page}:${element.numInPage}`, element.textBox?.fontPath ?? undefined);
      }
      if (!rangePages.includes(page)) {
        continue;
      }
      const contents = pageContents(elements, scopedByPage.get(page) ?? new Set());
      if (contents.loose) {
        handwriting.push(page);
      }
      if (contents.loose || contents.otherText) {
        keep.add(page);
      }
      if (contents.userTitle) {
        blockers.push({page, kind: 'title', reason: 'a heading made with NOTE’s title can’t be moved yet'});
      }
    } finally {
      await recycleElements(elements);
    }
  }

  // The new textboxes: pieces joined, styled, measured, cut to fit.
  const groups: CleanupGroup[] = [];
  const boxes: CleanupBox[] = [];
  let split = 0;
  let joined = 0;
  for (const group of pieceGroups(scoped)) {
    const head = group[0];
    const at = original.get(head.key) ?? head;
    const style = styleOf(head);
    const text = groupText(group);
    const fontSize = style?.fontSize ?? 0;
    const fitted =
      style === null
        ? [{text, height: Math.min(at.rect.bottom - at.rect.top, area.bottom - area.top)}]
        : await fitText({text, area, fontSize, fontPath: fonts.get(`${at.page}:${at.numInPage}`), measureHeight: measureTextboxHeight});
    if (fitted.length > group.length) {
      split++;
    } else if (fitted.length < group.length) {
      joined++;
    }
    const pieces = fitted.map((piece, index) => ({id: `${head.key}#${index}`, text: piece.text}));
    groups.push({blocks: group, pieces, style});
    fitted.forEach((piece, index) =>
      boxes.push({
        id: pieces[index].id,
        height: piece.height,
        startsPage:
          index === 0 &&
          startsPage({kind: head.kind, level: head.kind === 'heading' ? head.level : null}, layout),
      }),
    );
  }
  const {placements, pageCount: filled} = layoutCleanup(boxes, area, layout.blockGap, range.first);
  const removable = rangePages.filter(page => page >= range.first + filled && !keep.has(page));
  const note = [
    split > 0 ? `${plural(split, 'long paragraph')} cut to fit` : null,
    joined > 0 ? `${plural(joined, 'cut paragraph')} joined again` : null,
    handwriting.length > 0
      ? `handwriting on ${handwriting.length === 1 ? 'page' : 'pages'} ${handwriting.map(page => page + 1).join(', ')} stays in place`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    kind: 'cleanup',
    pages,
    blockers,
    groups,
    placements,
    range,
    pageCount: filled,
    handwriting,
    removable,
    area,
    note,
  };
}

/** The tag of piece `index` of a block: the first keeps the block's tag (without a piece), the others get their own id. */
function pieceTag(userData: string | null, index: number, now: Date): string | null {
  const tag = parseBlockTag(userData);
  if (!tag) {
    return index === 0 ? userData : null;
  }
  const rest: BlockTag = {...tag};
  delete rest.p;
  if (index === 0) {
    return formatBlockTag(rest);
  }
  if (!tag.s || tag.i === undefined) {
    return null;
  }
  return formatBlockTag({...rest, id: newBlockId(now), p: index});
}

function styled(element: TextElement, style: TextboxImportRoleStyle | null) {
  const own = textboxStyle(element.textBox as TextboxData);
  return style ? {...own, fontSize: style.fontSize, textBold: style.bold ? 1 : 0} : own;
}

export async function applyCleanup(
  notePath: string,
  pageCount: number,
  blocks: OutlineBlock[],
  planned: PlannedOrder,
  check: CleanupCheck,
  onProgress: (message: string) => void,
): Promise<{message: string; backupPath: string}> {
  if (check.blockers.length > 0) {
    throw new Error('Something on these pages is in the way of the clean up.');
  }
  const original = new Map(blocks.map(block => [block.key, block]));
  const touched = [...check.groups.flatMap(group => group.blocks), ...planned.aside, ...planned.deleted].map(
    block => original.get(block.key) ?? block,
  );

  onProgress('Saving the note…');
  await saveCurrentNoteForConsistency('cleaning up the layout');

  const read = new Map<number, Element[]>();
  try {
    onProgress('Reading the pages again…');
    for (const page of check.pages) {
      read.set(page, await readPageElements(notePath, page, `Could not read page ${page + 1}.`));
    }
    const elementOf = new Map<string, TextElement>();
    for (const block of touched) {
      const element = (read.get(block.page) ?? []).find(
        item =>
          isNormalTextElement(item) &&
          item.numInPage === block.numInPage &&
          (item.textBox.textContentFull ?? '').trim() === block.text,
      ) as TextElement | undefined;
      if (!element) {
        throw new Error(`A textbox on page ${block.page + 1} changed since the outline was read. Read it again.`);
      }
      elementOf.set(block.key, element);
    }

    onProgress('Writing the backup…');
    const {backupPath} = await writeBackupFile(
      createOutlineBackupPayload(
        notePath,
        check.pages.map(page => ({page, textboxes: (read.get(page) ?? []).filter(isNormalTextElement)})),
      ),
    );

    const oldCount = check.range.last - check.range.first + 1;
    const extra = Math.max(0, check.pageCount - oldCount);
    if (extra > 0) {
      onProgress(`Adding ${plural(extra, 'page')}…`);
      await insertNotePages(notePath, check.range.last + 1, extra);
    }

    // Per page: new places and styles first, then removals; new textboxes last.
    const now = new Date();
    const modified = new Map<number, Element[]>();
    const gone = new Map<number, number[]>();
    const inserts = new Map<number, StyledTextboxInsert[]>();
    const add = <T>(map: Map<number, T[]>, page: number, item: T) => map.set(page, [...(map.get(page) ?? []), item]);
    for (const group of check.groups) {
      const head = original.get(group.blocks[0].key) ?? group.blocks[0];
      const element = elementOf.get(head.key) as TextElement;
      const place = check.placements.get(group.pieces[0].id) as Placement;
      if (group.blocks.length === 1 && group.pieces.length === 1 && place.page === head.page) {
        const style = styled(element, group.style);
        add(modified, head.page, {
          ...element,
          textBox: {
            ...element.textBox,
            textContentFull: group.pieces[0].text,
            fontSize: style.fontSize,
            textBold: style.textBold,
            textRect: place.rect,
          },
        } as Element);
        continue;
      }
      for (const block of group.blocks) {
        const at = original.get(block.key) ?? block;
        add(gone, at.page, (elementOf.get(block.key) as TextElement).numInPage);
      }
      const userData = typeof element.userData === 'string' ? element.userData : null;
      group.pieces.forEach((piece, index) => {
        const target = check.placements.get(piece.id) as Placement;
        add(inserts, target.page, {
          text: piece.text,
          rect: target.rect,
          userData: pieceTag(userData, index, now),
          style: styled(element, group.style),
        });
      });
    }
    for (const block of planned.deleted) {
      const at = original.get(block.key) ?? block;
      add(gone, at.page, (elementOf.get(block.key) as TextElement).numInPage);
    }
    // Set-aside blocks go onto new pages at the end of the note, under a new divider when the
    // note has no aside area yet (technical-design-aside-area.md §3.4).
    const lastPage = pageCount + extra - 1;
    const divider =
      planned.aside.length > 0 && !blocks.some(block => block.aside) ? await asideDividerBlock(check.area) : null;
    const aside = layoutAside(
      [...(divider ? [divider] : []), ...planned.aside.map(block => original.get(block.key) ?? block)],
      {top: check.area.top, bottom: check.area.bottom},
      lastPage,
    );
    const dividerPlace = aside.get(ASIDE_DIVIDER_KEY);
    if (dividerPlace) {
      add(inserts, dividerPlace.page, asideDividerInsert(dividerPlace));
    }
    for (const block of planned.aside) {
      const at = original.get(block.key) ?? block;
      const element = elementOf.get(block.key) as TextElement;
      add(gone, at.page, element.numInPage);
      const place = aside.get(block.key) as Placement;
      add(inserts, place.page, {
        text: element.textBox.textContentFull ?? '',
        rect: place.rect,
        userData: typeof element.userData === 'string' ? element.userData : null,
        style: textboxStyle(element.textBox as TextboxData),
      });
    }
    const asidePages = Math.max(0, ...[...aside.values()].map(place => place.page - lastPage));
    if (asidePages > 0) {
      await appendNotePages(notePath, lastPage + 1, asidePages);
    }

    for (const page of check.pages) {
      onProgress(`Changing page ${page + 1}…`);
      await modifyPageElements(notePath, page, modified.get(page) ?? []);
      await deletePageElements(notePath, page, gone.get(page) ?? []);
    }
    for (const [page, items] of [...inserts].sort((a, b) => a[0] - b[0])) {
      onProgress(`Writing page ${page + 1}…`);
      await insertTextboxesIntoFile(notePath, page, items);
    }
    if (check.removable.length > 0) {
      onProgress(`Removing ${plural(check.removable.length, 'empty page')}…`);
      await removeNotePages(notePath, check.removable);
    }

    // Our titles follow the dividers and headings on every page from the first one laid out.
    const finalCount = pageCount + extra + asidePages - check.removable.length;
    try {
      await syncTitles(
        notePath,
        Array.from({length: Math.max(0, finalCount - check.range.first)}, (_, index) => check.range.first + index),
      );
    } catch (error) {
      console.warn('[CleanupApply] titles not synced', String(error));
    }

    const textboxes = check.groups.reduce((sum, group) => sum + group.pieces.length, 0);
    return {
      message: `Laid out ${plural(textboxes, 'textbox', 'textboxes')} on ${plural(check.pageCount, 'page')}${
        check.removable.length > 0 ? `, ${plural(check.removable.length, 'empty page')} removed` : ''
      }${planned.aside.length > 0 ? `, ${planned.aside.length} set aside` : ''}${
        planned.deleted.length > 0 ? `, ${planned.deleted.length} deleted` : ''
      }.`,
      backupPath,
    };
  } finally {
    for (const elements of read.values()) {
      await recycleElements(elements);
    }
  }
}
