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
 *
 * Pure.
 */

/** Where a moved block goes: before this block (its key), or to the end of the note. */
export type MoveTarget = string | 'end';

export type PlannedChange =
  | {kind: 'move'; key: string; before: MoveTarget}
  | {kind: 'level'; key: string; level: 0 | HeadingLevel; withSubheadings: boolean}
  | {kind: 'aside'; key: string}
  | {kind: 'delete'; key: string};

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
 * text would belong to the file before it).
 */
export function canRemove(block: OutlineBlock): boolean {
  return block.kind !== 'file';
}

/** Whether a block can move: paragraphs and files. Headings stay where they are. */
export function canMove(block: OutlineBlock): boolean {
  return block.kind !== 'heading';
}

/** Whether a block's level can change: headings and paragraphs, not a file's divider. */
export function canChangeLevel(block: OutlineBlock): boolean {
  return block.kind !== 'file';
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
    if (block.kind !== 'file' && from !== to) {
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
  for (const change of plan) {
    if (change.kind === 'level') {
      continue;
    }
    const block = byKey.get(change.key);
    if (!block || !order.includes(block)) {
      continue;
    }
    if (change.kind !== 'move') {
      if (!canRemove(block)) {
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
  return {order, aside, deleted, marks, levels: levelled.levels};
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
  const moves = plan.filter(change => change.kind === 'move');
  const movedFiles = moves.filter(change => byKey.get(change.key)?.kind === 'file').length;
  if (moves.length - movedFiles > 0) {
    parts.push(`${plural(moves.length - movedFiles, 'paragraph')} moved`);
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
  return parts.join(' · ');
}
