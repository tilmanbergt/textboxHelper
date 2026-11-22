import type {CleanupScope} from './cleanupLayout';
import {withHeadingLevel, type HeadingLevel} from './headingText';
import {firstLineOf, lastLineOf, rank, type OutlineBlock} from './outlineModel';
import {plural} from './plural';

/**
 * Planned changes in the Outline (technical-design-manuscript.md §5.3,
 * technical-design-outline-sections.md §2): moves, heading levels, set aside and delete, collected
 * and applied together. Nothing on the page changes until then.
 *
 * - A section is a file's divider or a heading and everything after it up to the next block of the
 *   same or a higher rank (file 0, `#` 1, `##` 2, `###` 3); a paragraph is a section of its own.
 * - Only paragraphs and files move: headings stay (the Supernote is for revising a draft; larger
 *   reordering is done in Obsidian). A file moves with all its text.
 * - A level change rewrites the heading's `#`s; with its subheadings, every heading in its section
 *   shifts by the same steps (within 1–3). Level changes are planned first, so moves see the new
 *   structure.
 * - Setting aside or deleting a heading takes its whole section; a file's divider can't be removed.
 * - Clean up layout (technical-design-settings-layout-files.md §2) lays the whole note or one file
 *   out again, in the planned order; at most one is planned.
 * - The aside area (technical-design-aside-area.md §2.6): its divider is a section like a file's
 *   but never moves, changes level or goes. Set aside puts a block (with its section) at the end of
 *   the area; moving a block of the area to a place in the text is a plain move (Move back).
 *
 * Pure.
 */

/** Where a moved block goes: before this block (its key), or to the end of the note. */
export type MoveTarget = string | 'end';

export type PlannedChange =
  | {kind: 'move'; key: string; before: MoveTarget}
  | {kind: 'level'; key: string; level: 0 | HeadingLevel; withSubheadings: boolean}
  | {kind: 'aside'; key: string}
  | {kind: 'delete'; key: string}
  | {kind: 'cleanup'; key: typeof CLEANUP_KEY; scope: CleanupScope};

/** The key of the planned clean up (one at most), so Undo finds it like any change. */
export const CLEANUP_KEY = '#cleanup';

export type ChangeMark = 'moved' | 'level' | 'aside' | 'delete';

export type PlannedOrder = {
  /** The blocks that stay in the text, in their new order (with planned levels). */
  order: OutlineBlock[];
  /** Blocks set aside (onto a new page at the end), in planned order. */
  aside: OutlineBlock[];
  deleted: OutlineBlock[];
  /** How each changed block shows in the list. */
  marks: Map<string, ChangeMark>;
  /** Headings whose level changes: from (0 = paragraph) → to. */
  levels: Map<string, {from: number; to: number}>;
  /** The planned clean up, if any. */
  cleanup: CleanupScope | null;
};

/** A file's divider or a heading and the blocks after it up to the next of the same or a higher rank. */
export function sectionOf(order: OutlineBlock[], key: string): string[] {
  const start = order.findIndex(block => block.key === key);
  if (start < 0) {
    return [];
  }
  const own = rank(order[start]);
  if (own === Infinity) {
    return [key];
  }
  const keys = [key];
  for (let index = start + 1; index < order.length; index++) {
    if (rank(order[index]) <= own) {
      break;
    }
    keys.push(order[index].key);
  }
  return keys;
}

/**
 * Whether a block can be set aside or deleted: not a linked file's divider (without it the file's
 * text would belong to the file before it), not the aside divider; nothing in the aside area is set
 * aside again.
 */
export function canRemove(block: OutlineBlock): boolean {
  return block.kind !== 'file' && block.kind !== 'aside';
}

/** Whether a block can be set aside: what can be removed, and not already in the aside area. */
export function canSetAside(block: OutlineBlock): boolean {
  return canRemove(block) && !block.aside;
}

/** Whether a block can move: paragraphs and files. Headings and the aside divider stay where they are. */
export function canMove(block: OutlineBlock): boolean {
  return block.kind === 'paragraph' || block.kind === 'file';
}

/** Whether a block's level can change: headings and paragraphs, not a divider. */
export function canChangeLevel(block: OutlineBlock): boolean {
  return block.kind === 'heading' || block.kind === 'paragraph';
}

/** A block with a new level: its `#`s rewritten, kind and lines to match. */
function relevelled(block: OutlineBlock, level: number): OutlineBlock {
  const text = withHeadingLevel(block.text, level as 0 | HeadingLevel);
  return {
    ...block,
    text,
    firstLine: firstLineOf(text),
    lastLine: lastLineOf(text),
    kind: level > 0 ? 'heading' : 'paragraph',
    level: level > 0 ? level : null,
  };
}

const clampLevel = (level: number) => Math.min(3, Math.max(1, level));

/** The order with the plan's level changes, and which blocks change (from their original level). */
function applyLevels(
  blocks: OutlineBlock[],
  plan: PlannedChange[],
): {order: OutlineBlock[]; levels: Map<string, {from: number; to: number}>} {
  let order = [...blocks];
  const original = new Map(blocks.map(block => [block.key, block.level ?? 0]));
  for (const change of plan) {
    if (change.kind !== 'level') {
      continue;
    }
    const at = order.findIndex(block => block.key === change.key);
    if (at < 0 || !canChangeLevel(order[at])) {
      continue;
    }
    const from = order[at].level ?? 0;
    // Removing a heading with its subheadings lifts them by one level.
    const delta = change.level === 0 ? -1 : change.level - from;
    const subheadings =
      change.withSubheadings && from > 0
        ? new Set(sectionOf(order, change.key).slice(1))
        : new Set<string>();
    order = order.map(block => {
      if (block.key === change.key) {
        return relevelled(block, change.level);
      }
      if (subheadings.has(block.key) && block.kind === 'heading') {
        return relevelled(block, clampLevel((block.level ?? 1) + delta));
      }
      return block;
    });
  }
  const levels = new Map<string, {from: number; to: number}>();
  for (const block of order) {
    const from = original.get(block.key) ?? 0;
    const to = block.level ?? 0;
    if (canChangeLevel(block) && from !== to) {
      levels.set(block.key, {from, to});
    }
  }
  return {order, levels};
}

export function plannedOrder(
  blocks: OutlineBlock[],
  plan: PlannedChange[],
): PlannedOrder {
  const levelled = applyLevels(blocks, plan);
  let order = levelled.order;
  const byKey = new Map(order.map(block => [block.key, block]));
  const aside: OutlineBlock[] = [];
  const deleted: OutlineBlock[] = [];
  const marks = new Map<string, ChangeMark>();
  levelled.levels.forEach((_, key) => marks.set(key, 'level'));
  let cleanup: CleanupScope | null = null;
  for (const change of plan) {
    if (change.kind === 'cleanup') {
      cleanup = change.scope;
      continue;
    }
    if (change.kind === 'level') {
      continue;
    }
    const block = byKey.get(change.key);
    if (!block || !order.includes(block)) {
      continue;
    }
    if (change.kind !== 'move') {
      if (change.kind === 'aside' ? !canSetAside(block) : !canRemove(block)) {
        continue;
      }
      const section = new Set(sectionOf(order, change.key));
      const removed = order.filter(item => section.has(item.key));
      order = order.filter(item => !section.has(item.key));
      (change.kind === 'aside' ? aside : deleted).push(...removed);
      removed.forEach(item => marks.set(item.key, change.kind));
      continue;
    }
    if (!canMove(block)) {
      continue;
    }
    const section = new Set(sectionOf(order, change.key));
    if (change.before !== 'end' && section.has(change.before)) {
      continue;
    }
    const moving = order.filter(item => section.has(item.key));
    const rest = order.filter(item => !section.has(item.key));
    const at =
      change.before === 'end'
        ? rest.length
        : rest.findIndex(item => item.key === change.before);
    if (at < 0) {
      continue;
    }
    order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    moving.forEach(item => {
      if (!marks.has(item.key)) {
        marks.set(item.key, 'moved');
      }
    });
  }
  return {order: withPlannedAside(order, marks), aside, deleted, marks, levels: levelled.levels, cleanup};
}

/**
 * The planned order with each block's part by its planned place: from the aside divider on, the
 * aside area; before it, the text — so a block moved back is in the text even right before the
 * divider. A note without divider (set aside before it existed): the area starts at its first
 * block that wasn't moved.
 */
function withPlannedAside(order: OutlineBlock[], marks: Map<string, ChangeMark>): OutlineBlock[] {
  const divider = order.findIndex(block => block.kind === 'aside');
  const start = divider >= 0 ? divider : order.findIndex(block => block.aside && marks.get(block.key) !== 'moved');
  const from = start >= 0 ? start : order.length;
  return order.map((block, index) => (block.aside === index >= from ? block : {...block, aside: index >= from}));
}

/** Whether moving `key` before `target` would change anything (not onto itself or its own place). */
export function canMoveBefore(
  order: OutlineBlock[],
  key: string,
  target: MoveTarget,
): boolean {
  const section = sectionOf(order, key);
  if (section.length === 0 || (target !== 'end' && section.includes(target))) {
    return false;
  }
  const keys = order.map(block => block.key);
  const after = keys[keys.indexOf(section[section.length - 1]) + 1] ?? 'end';
  return after !== target;
}

/** Edits waiting on these blocks; such blocks can't be moved, levelled or removed yet. */
export function blockedBy(blocks: OutlineBlock[]): number {
  return blocks.reduce((sum, block) => sum + (block.pendingEdits ?? 0), 0);
}

/** The plan without the changes of this block (Undo on a planned block). */
export function undoFor(plan: PlannedChange[], key: string): PlannedChange[] {
  return plan.filter(change => change.key !== key);
}

/** The plan without its last change. */
export function undoLast(plan: PlannedChange[]): PlannedChange[] {
  return plan.slice(0, -1);
}

/** "1 heading level (with 2 subheadings) · 2 paragraphs moved · 1 section set aside" */
export function plannedSummary(
  blocks: OutlineBlock[],
  plan: PlannedChange[],
  planned: PlannedOrder,
): string {
  const byKey = new Map(blocks.map(block => [block.key, block]));
  const parts: string[] = [];
  const levelChanges = plan.filter(change => change.kind === 'level');
  if (levelChanges.length > 0) {
    const along = planned.levels.size - levelChanges.length;
    parts.push(
      `${plural(levelChanges.length, 'heading level')}${along > 0 ? ` (with ${plural(along, 'subheading')})` : ''}`,
    );
  }
  const moves = plan.filter((change): change is Extract<PlannedChange, {kind: 'move'}> => change.kind === 'move');
  const movedFiles = moves.filter(change => byKey.get(change.key)?.kind === 'file').length;
  // From the aside area to a place in the text (technical-design-aside-area.md §2.5): before a
  // block of the text, or before the divider (the end of the text).
  const intoText = (before: MoveTarget) => {
    const target = before === 'end' ? undefined : byKey.get(before);
    return !!target && (!target.aside || target.kind === 'aside');
  };
  const movedBack = moves.filter(change => byKey.get(change.key)?.aside && intoText(change.before)).length;
  if (moves.length - movedFiles - movedBack > 0) {
    parts.push(`${plural(moves.length - movedFiles - movedBack, 'paragraph')} moved`);
  }
  if (movedBack > 0) {
    parts.push(`${plural(movedBack, 'paragraph')} moved back`);
  }
  if (movedFiles > 0) {
    parts.push(`${plural(movedFiles, 'file')} moved`);
  }
  for (const [kind, verb] of [
    ['aside', 'set aside'],
    ['delete', 'deleted'],
  ] as const) {
    const changes = plan.filter(change => change.kind === kind);
    const sections = changes.filter(change => byKey.get(change.key)?.kind === 'heading').length;
    if (sections > 0) {
      parts.push(`${plural(sections, 'section')} ${verb}`);
    }
    if (changes.length - sections > 0) {
      parts.push(`${plural(changes.length - sections, 'paragraph')} ${verb}`);
    }
  }
  if (planned.cleanup) {
    const file =
      planned.cleanup.kind === 'file'
        ? blocks.find(block => block.fileSource === (planned.cleanup as {sourceId: string}).sourceId)
        : undefined;
    parts.push(`Clean up layout: ${file ? file.firstLine : 'whole note'}`);
  }
  return parts.join(' · ');
}
