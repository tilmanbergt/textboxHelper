/**
 * The Manuscript card's Outline tab (technical-design-manuscript.md §5; canvas "Outline · All,
 * block selected"). Above: the filters (All, Pending edits, each status) with counts. The list:
 * every textbox of the note in reading order, one block per textbox (H for a heading, ¶ for a
 * paragraph), its first and last line, ✎ with the edits pending on it, and its status on the right
 * (○ open, ◐ review, ● final). Below, the bottom panel: the selected block's whole text, paged, and
 * its action bar. Nothing is typed here, so the writing pad never covers anything that matters.
 *
 * Moving: while a block is selected (under All), a ← sits at the top right of every row it can go
 * before, and at the end of the list. Moves, set aside and delete are planned: moved blocks are
 * underlined at their new place, set-aside blocks in italics, deleted ones struck through; the
 * planned line names them, with Undo last. A block with edits waiting can't be planned.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  BLOCK_STATUSES,
  STATUS_GLYPH,
  STATUS_LABEL,
  filterCounts,
  matchesFilter,
  type BlockStatus,
  type OutlineBlock,
  type OutlineFilter,
} from '../../domain/outlineModel';
import {
  canMoveBefore,
  plannedSummary,
  type ChangeMark,
  type MoveTarget,
} from '../../domain/outlinePlan';
import {plural} from '../../domain/plural';
import ChipRow from '../../ui/ChipRow';
import PagedSection from '../../ui/PagedSection';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';
import type {Outline} from './useOutline';

/** A block row: two lines of text (one for a heading), padding and its bottom line. */
const ROW_PADDING = 2 * SPACING.sm + 2;
const rowHeight = (block: OutlineBlock) =>
  ROW_PADDING + (block.heading || !block.lastLine ? 1 : 2) * LINE_HEIGHT.medium;

type ListFilter = OutlineFilter | 'planned';
type Row =
  | {kind: 'block'; block: OutlineBlock; mark: ChangeMark | null}
  | {kind: 'end'};
const END_ROW_HEIGHT = 48;

const FILTER_LABELS: Record<ListFilter, string> = {
  all: 'All',
  planned: 'Planned',
  pending: 'Pending edits',
  open: `${STATUS_GLYPH.open} Open`,
  review: `${STATUS_GLYPH.review} Review`,
  final: `${STATUS_GLYPH.final} Final`,
};

interface Props {
  outline: Outline;
  disabled: boolean;
  /** Switches to the Review, showing this page. */
  onReviewPage: (page: number) => void;
}

export default function OutlineTab({
  outline,
  disabled,
  onReviewPage,
}: Props): React.JSX.Element {
  const {blocks, loading, load, planned} = outline;
  const [filter, setFilter] = useState<ListFilter>('all');
  // Read when the tab opens; the Outline keeps its blocks while the card is open.
  useEffect(() => {
    if (!blocks) {
      load();
    }
  }, [blocks, load]);

  const all = blocks ?? [];
  const marks = planned?.marks ?? new Map<string, ChangeMark>();
  const display = displayOrder(all, planned);
  const counts = filterCounts(all);
  const shown = display.filter(block =>
    filter === 'planned' ? marks.has(block.key) : matchesFilter(block, filter),
  );
  const selected =
    shown.find(block => block.key === outline.selectedKey) ?? shown[0] ?? null;
  const selectedMark = selected ? marks.get(selected.key) ?? null : null;
  // Moving: the selected block (not removed, no edits waiting) can go before other rows, under All.
  const moving =
    filter === 'all' &&
    selected &&
    !disabled &&
    selectedMark !== 'aside' &&
    selectedMark !== 'delete' &&
    !selected.pendingEdits
      ? selected
      : null;
  const order = planned?.order ?? all;
  const targetOf = (key: MoveTarget) =>
    moving &&
    order.some(block => block.key === moving.key) &&
    canMoveBefore(order, moving.key, key)
      ? () => outline.move(moving.key, key)
      : null;
  const rows: Row[] = [
    ...shown.map(block => ({
      kind: 'block' as const,
      block,
      mark: marks.get(block.key) ?? null,
    })),
    ...(moving && targetOf('end') ? [{kind: 'end' as const}] : []),
  ];

  return (
    <View style={styles.tab}>
      <View style={styles.filters}>
        <ChipRow<ListFilter>
          chips={(
            ['all', 'planned', 'pending', ...BLOCK_STATUSES] as ListFilter[]
          )
            .filter(key => key !== 'planned' || marks.size > 0)
            .map(key => ({
              key,
              label: `${FILTER_LABELS[key]} ${
                key === 'planned' ? marks.size : counts[key]
              }`,
            }))}
          value={filter}
          onChange={setFilter}
          trailing={
            <PillButton
              size="small"
              label="Read again"
              onPress={load}
              disabled={loading || disabled || outline.plan.length > 0}
            />
          }
        />
      </View>
      <View style={styles.list}>
        <PagedSection<Row>
          header={`${plural(
            all.length,
            'block',
          )} · H heading · ¶ textbox · ✎ edits pending${
            moving ? ' · ← move here' : ''
          }`}
          rows={rows}
          rowHeight={row =>
            row.kind === 'end' ? END_ROW_HEIGHT : rowHeight(row.block)
          }
          resetKey={`${filter}|${all.length}`}
          emptyHint={
            loading || !blocks ? 'Reading the outline…' : 'No blocks here.'
          }
          renderRow={row =>
            row.kind === 'end' ? (
              <EndTarget key="end" onPress={targetOf('end')} />
            ) : (
              <BlockRow
                key={row.block.key}
                block={row.block}
                mark={row.mark}
                selected={row.block.key === selected?.key}
                onPress={() => outline.select(row.block.key)}
                onMoveHere={
                  row.block.key === moving?.key ? null : targetOf(row.block.key)
                }
              />
            )
          }
        />
      </View>
      {outline.plan.length > 0 && blocks ? (
        <View style={styles.planned}>
          <Text style={styles.plannedText} numberOfLines={2}>
            <Text style={styles.plannedTitle}>Planned: </Text>
            {plannedSummary(all, outline.plan)}
            {outline.checking ? ' · checking the pages…' : blockerNote(outline)}
          </Text>
          <PillButton
            size="small"
            label="Undo last"
            onPress={outline.undoLastChange}
            disabled={disabled}
          />
        </View>
      ) : null}
      <View style={styles.panel}>
        {selected ? (
          <BlockPanel
            block={selected}
            mark={selectedMark}
            disabled={disabled || outline.busy}
            onStatus={status => outline.setStatus(selected, status)}
            onReviewPage={onReviewPage}
            onAside={() => outline.setAside(selected.key)}
            onDelete={() => outline.remove(selected.key)}
            onUndo={() => outline.undo(selected.key)}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The blocks as planned: the new order, with set-aside and deleted blocks still at their old place. */
function displayOrder(
  all: OutlineBlock[],
  planned: Outline['planned'],
): OutlineBlock[] {
  if (!planned) {
    return all;
  }
  const result = [...planned.order];
  [...planned.aside, ...planned.deleted]
    .sort((a, b) => all.indexOf(a) - all.indexOf(b))
    .forEach(block => {
      const before = all[all.indexOf(block) - 1];
      result.splice(before ? result.indexOf(before) + 1 : 0, 0, block);
    });
  return result;
}

/** What stands in the way, in a few words, for the planned line. */
function blockerNote(outline: Outline): string {
  const blockers = outline.check?.blockers ?? [];
  if (blockers.length === 0) {
    return outline.check
      ? ` · pages ${outline.check.pages
          .map(page => page + 1)
          .join(', ')} are rebuilt`
      : '';
  }
  return ` · blocked: ${blockers
    .map(blocker => `p.${blocker.page + 1} ${blocker.reason}`)
    .join('; ')}`;
}

function EndTarget({
  onPress,
}: {
  onPress: (() => void) | null;
}): React.JSX.Element {
  return (
    <View style={[styles.endRow, {height: END_ROW_HEIGHT}]}>
      <Text style={styles.endText}>End of the note</Text>
      {onPress ? <MoveTargetButton onPress={onPress} /> : null}
    </View>
  );
}

function MoveTargetButton({onPress}: {onPress: () => void}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Move the selected block here"
      onPress={onPress}
      hitSlop={6}
      style={styles.target}>
      <Text style={styles.targetText}>←</Text>
    </Pressable>
  );
}

function BlockRow({
  block,
  mark,
  selected,
  onPress,
  onMoveHere,
}: {
  block: OutlineBlock;
  mark: ChangeMark | null;
  selected: boolean;
  onPress: () => void;
  /** Set when the selected block can move before this one. */
  onMoveHere: (() => void) | null;
}): React.JSX.Element {
  const markStyle =
    mark === 'moved'
      ? styles.moved
      : mark === 'aside'
      ? styles.aside
      : mark === 'delete'
      ? styles.deleted
      : null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{selected}}
        accessibilityLabel={`${
          block.heading ? 'Heading' : 'Paragraph'
        } on page ${block.page + 1}: ${block.firstLine}`}
        onPress={onPress}
        style={[
          styles.row,
          {height: rowHeight(block)},
          selected && styles.rowSelected,
          onMoveHere && styles.rowWithTarget,
        ]}>
        <Text style={styles.kind}>{block.heading ? 'H' : '¶'}</Text>
        <View style={styles.lines}>
          <Text
            style={[styles.line, block.heading && styles.heading, markStyle]}
            numberOfLines={1}>
            {block.firstLine}
          </Text>
          {!block.heading && block.lastLine ? (
            <Text style={[styles.line, markStyle]} numberOfLines={1}>
              {block.lastLine}
            </Text>
          ) : null}
        </View>
        <Text style={styles.page}>
          {mark ? MARK_LABEL[mark] : `p.${block.page + 1}`}
        </Text>
        <View style={styles.pending}>
          {block.pendingEdits ? (
            <Text style={styles.pendingText}>✎ {block.pendingEdits}</Text>
          ) : null}
        </View>
        <Text
          style={styles.status}
          accessibilityLabel={STATUS_LABEL[block.status]}>
          {STATUS_GLYPH[block.status]}
        </Text>
      </Pressable>
      {onMoveHere ? <MoveTargetButton onPress={onMoveHere} /> : null}
    </View>
  );
}

const MARK_LABEL: Record<ChangeMark, string> = {
  moved: 'moved',
  aside: 'set aside',
  delete: 'delete',
};

function BlockPanel({
  block,
  mark,
  disabled,
  onStatus,
  onReviewPage,
  onAside,
  onDelete,
  onUndo,
}: {
  block: OutlineBlock;
  mark: ChangeMark | null;
  disabled: boolean;
  onStatus: (status: BlockStatus) => void;
  onReviewPage: (page: number) => void;
  onAside: () => void;
  onDelete: () => void;
  onUndo: () => void;
}): React.JSX.Element {
  const locked = !!block.pendingEdits;
  const pending =
    block.pendingEdits === null
      ? 'edits not read yet'
      : block.pendingEdits === 0
      ? 'no pending edits'
      : `${plural(block.pendingEdits, 'pending edit')}`;
  return (
    <View style={styles.panelBody}>
      <Text style={styles.panelTitle}>
        Page {block.page + 1} · {block.heading ? 'heading' : 'paragraph'} ·{' '}
        {pending}
      </Text>
      <View style={styles.panelText}>
        <PagedText segments={[{text: block.text}]} resetKey={block.key} />
      </View>
      <View style={styles.bar}>
        <Segmented<BlockStatus>
          options={BLOCK_STATUSES.map(status => ({
            key: status,
            label: `${STATUS_GLYPH[status]} ${STATUS_LABEL[status]}`,
          }))}
          value={block.status}
          onChange={status => !disabled && onStatus(status)}
          size="small"
          accessibilityLabel="Status"
        />
        {mark ? (
          <PillButton
            size="small"
            label={`Undo ${MARK_LABEL[mark]}`}
            onPress={onUndo}
            disabled={disabled}
          />
        ) : (
          <>
            <PillButton
              size="small"
              label="Set aside"
              onPress={onAside}
              disabled={disabled || locked}
            />
            <PillButton
              size="small"
              label="Delete"
              onPress={onDelete}
              disabled={disabled || locked}
            />
          </>
        )}
        {block.pendingEdits ? (
          <PillButton
            size="small"
            label={`Review its ${plural(block.pendingEdits, 'edit')} ›`}
            onPress={() => onReviewPage(block.page)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
  },
  filters: {
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.base,
  },
  list: {
    flex: 3,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  panel: {
    flex: 2,
    borderTopWidth: 2,
    borderTopColor: COLORS.accent,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomColor: COLORS.border,
    borderRadius: RADII.md,
  },
  rowWithTarget: {
    paddingRight: 52,
  },
  rowSelected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  kind: {
    width: 20,
    fontSize: FONT.small,
    color: COLORS.muted,
    textAlign: 'center',
  },
  lines: {
    flex: 1,
  },
  line: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  heading: {
    fontWeight: '700',
  },
  page: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  pending: {
    width: 56,
    alignItems: 'flex-end',
  },
  pendingText: {
    fontSize: FONT.small,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.xs,
  },
  status: {
    width: 28,
    fontSize: FONT.large,
    textAlign: 'center',
    color: COLORS.text,
  },
  panelBody: {
    flex: 1,
    gap: SPACING.sm,
  },
  panelTitle: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  panelText: {
    flex: 1,
  },
  moved: {
    textDecorationLine: 'underline',
  },
  aside: {
    fontStyle: 'italic',
    color: COLORS.muted,
  },
  deleted: {
    textDecorationLine: 'line-through',
    color: COLORS.muted,
  },
  target: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 44,
    height: 28,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetText: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  endRow: {
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  endText: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  planned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  plannedText: {
    flex: 1,
    fontSize: FONT.small,
    color: COLORS.text,
  },
  plannedTitle: {
    fontWeight: '700',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
});
