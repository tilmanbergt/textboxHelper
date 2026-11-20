/**
 * The Manuscript card's Outline tab (technical-design-manuscript.md §5; canvas "Outline · All,
 * block selected"). Above: the filters (All, Pending edits, each status) with counts. The list:
 * every textbox of the note in reading order, one block per textbox (H for a heading, ¶ for a
 * paragraph), its first and last line, ✎ with the edits pending on it, and its status on the right
 * (○ open, ◐ review, ● final). Below, the bottom panel: the selected block's whole text, paged, and
 * its action bar. Nothing is typed here, so the writing pad never covers anything that matters.
 *
 * This step (S4) reads and marks; moving, setting aside and deleting blocks come with S5.
 */
import React, {useEffect} from 'react';
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

const FILTER_LABELS: Record<OutlineFilter, string> = {
  all: 'All',
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

export default function OutlineTab({outline, disabled, onReviewPage}: Props): React.JSX.Element {
  const {blocks, loading, filter, load} = outline;
  // Read when the tab opens; the Outline keeps its blocks while the card is open.
  useEffect(() => {
    if (!blocks) {
      load();
    }
  }, [blocks, load]);

  const all = blocks ?? [];
  const counts = filterCounts(all);
  const shown = all.filter(block => matchesFilter(block, filter));
  const selected = shown.find(block => block.key === outline.selectedKey) ?? shown[0] ?? null;

  return (
    <View style={styles.tab}>
      <View style={styles.filters}>
        <ChipRow<OutlineFilter>
          chips={(['all', 'pending', ...BLOCK_STATUSES] as OutlineFilter[]).map(key => ({
            key,
            label: `${FILTER_LABELS[key]} ${counts[key]}`,
          }))}
          value={filter}
          onChange={outline.setFilter}
          trailing={
            <PillButton size="small" label="Read again" onPress={load} disabled={loading || disabled} />
          }
        />
      </View>
      <View style={styles.list}>
        <PagedSection
          header={`${plural(all.length, 'block')} · H heading · ¶ textbox · ✎ edits pending`}
          rows={shown}
          rowHeight={rowHeight}
          resetKey={`${filter}|${all.length}`}
          emptyHint={loading || !blocks ? 'Reading the outline…' : 'No blocks here.'}
          renderRow={block => (
            <BlockRow
              key={block.key}
              block={block}
              selected={block.key === selected?.key}
              onPress={() => outline.select(block.key)}
            />
          )}
        />
      </View>
      <View style={styles.panel}>
        {selected ? (
          <BlockPanel
            block={selected}
            disabled={disabled || outline.busy}
            onStatus={status => outline.setStatus(selected, status)}
            onReviewPage={onReviewPage}
          />
        ) : null}
      </View>
    </View>
  );
}

function BlockRow({
  block,
  selected,
  onPress,
}: {
  block: OutlineBlock;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={`${block.heading ? 'Heading' : 'Paragraph'} on page ${block.page + 1}: ${block.firstLine}`}
      onPress={onPress}
      style={[styles.row, {height: rowHeight(block)}, selected && styles.rowSelected]}>
      <Text style={styles.kind}>{block.heading ? 'H' : '¶'}</Text>
      <View style={styles.lines}>
        <Text style={[styles.line, block.heading && styles.heading]} numberOfLines={1}>
          {block.firstLine}
        </Text>
        {!block.heading && block.lastLine ? (
          <Text style={styles.line} numberOfLines={1}>
            {block.lastLine}
          </Text>
        ) : null}
      </View>
      <Text style={styles.page}>p.{block.page + 1}</Text>
      <View style={styles.pending}>
        {block.pendingEdits ? <Text style={styles.pendingText}>✎ {block.pendingEdits}</Text> : null}
      </View>
      <Text style={styles.status} accessibilityLabel={STATUS_LABEL[block.status]}>
        {STATUS_GLYPH[block.status]}
      </Text>
    </Pressable>
  );
}

function BlockPanel({
  block,
  disabled,
  onStatus,
  onReviewPage,
}: {
  block: OutlineBlock;
  disabled: boolean;
  onStatus: (status: BlockStatus) => void;
  onReviewPage: (page: number) => void;
}): React.JSX.Element {
  const pending =
    block.pendingEdits === null
      ? 'edits not read yet'
      : block.pendingEdits === 0
      ? 'no pending edits'
      : `${plural(block.pendingEdits, 'pending edit')}`;
  return (
    <View style={styles.panelBody}>
      <Text style={styles.panelTitle}>
        Page {block.page + 1} · {block.heading ? 'heading' : 'paragraph'} · {pending}
      </Text>
      <View style={styles.panelText}>
        <PagedText segments={[{text: block.text}]} resetKey={block.key} />
      </View>
      <View style={styles.bar}>
        <Segmented<BlockStatus>
          options={BLOCK_STATUSES.map(status => ({key: status, label: `${STATUS_GLYPH[status]} ${STATUS_LABEL[status]}`}))}
          value={block.status}
          onChange={status => !disabled && onStatus(status)}
          size="small"
          accessibilityLabel="Status"
        />
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
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
});
