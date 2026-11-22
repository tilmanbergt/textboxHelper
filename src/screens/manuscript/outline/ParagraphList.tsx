/**
 * The Outline's right column (technical-design-outline-sections.md §3, §7.1): the open entry's own
 * paragraphs — up to its first subheading — each with its first and last line, ✎ n when edits wait
 * on it and its status on the right. Planned changes show in place (moved and new level underlined,
 * set aside in italics, deleted struck through). Below the rows: what follows (its subheadings) and
 * how many paragraphs the filter hides. In a note without headings it is the only column.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ContentsEntry} from '../../../domain/outlineContents';
import {STATUS_GLYPH, STATUS_LABEL, type OutlineBlock} from '../../../domain/outlineModel';
import type {ChangeMark} from '../../../domain/outlinePlan';
import {plural} from '../../../domain/plural';
import {GLYPH} from '../../../ui/glyphs';
import PagedSection from '../../../ui/PagedSection';
import {COLORS, FONT, RADII, SPACING} from '../../../ui/theme';

const LINE = 22;
const ROW_CHROME = 20;
/** One line of text, or two (first and last): design-device-rendering.md §3. */
export const paragraphRowHeight = (block: OutlineBlock) => ROW_CHROME + (block.lastLine ? 2 : 1) * LINE;

interface Props {
  header: string;
  rows: OutlineBlock[];
  hidden: number;
  following: {entry: ContentsEntry; paragraphs: number}[];
  selectedKey: string | null;
  marks: Map<string, ChangeMark>;
  onSelect: (key: string) => void;
  loading: boolean;
  resetKey: string;
}

export default function ParagraphList({
  header,
  rows,
  hidden,
  following,
  selectedKey,
  marks,
  onSelect,
  loading,
  resetKey,
}: Props): React.JSX.Element {
  const after = [
    following.length > 0
      ? `Then: ${following
          .slice(0, 3)
          .map(next => `${next.entry.kind === 'heading' ? `${'#'.repeat(next.entry.level)} ` : ''}${next.entry.title} (${next.paragraphs} ¶)`)
          .join(', ')}${following.length > 3 ? ', …' : ''}`
      : null,
    hidden > 0 ? `${plural(hidden, 'paragraph')} hidden by the filter` : null,
  ].filter(Boolean);
  return (
    <View style={styles.column}>
      <PagedSection<OutlineBlock>
        header={header}
        rows={rows}
        rowHeight={paragraphRowHeight}
        resetKey={resetKey}
        emptyHint={loading ? 'Reading the outline…' : 'No paragraphs here.'}
        renderRow={block => (
          <ParagraphRow
            key={block.key}
            block={block}
            selected={block.key === selectedKey}
            mark={marks.get(block.key) ?? null}
            onPress={() => onSelect(block.key)}
          />
        )}
      />
      {after.length > 0 ? <Text style={styles.after}>{after.join(' · ')}</Text> : null}
    </View>
  );
}

function ParagraphRow({
  block,
  selected,
  mark,
  onPress,
}: {
  block: OutlineBlock;
  selected: boolean;
  mark: ChangeMark | null;
  onPress: () => void;
}): React.JSX.Element {
  const markStyle =
    mark === 'moved' || mark === 'level'
      ? styles.underlined
      : mark === 'aside'
      ? styles.aside
      : mark === 'delete'
      ? styles.deleted
      : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={`Paragraph: ${block.firstLine}`}
      onPress={onPress}
      style={[styles.row, {height: paragraphRowHeight(block)}, selected && styles.selected]}>
      <View style={styles.lines}>
        <Text style={[styles.line, markStyle]} numberOfLines={1}>
          {block.firstLine}
        </Text>
        {block.lastLine ? (
          <Text style={[styles.line, markStyle]} numberOfLines={1}>
            {block.lastLine}
          </Text>
        ) : null}
      </View>
      {mark && mark !== 'level' ? <Text style={styles.mark}>{mark === 'delete' ? 'delete' : mark === 'aside' ? 'set aside' : 'moved'}</Text> : null}
      {block.pendingEdits ? (
        <Text style={styles.edits}>
          {GLYPH.edits} {block.pendingEdits}
        </Text>
      ) : null}
      <Text style={styles.status} accessibilityLabel={STATUS_LABEL[block.status]}>
        {STATUS_GLYPH[block.status]}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minHeight: 0,
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
  selected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  lines: {
    flex: 1,
  },
  line: {
    fontSize: FONT.medium,
    lineHeight: LINE,
    color: COLORS.text,
    includeFontPadding: false,
  },
  underlined: {
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
  mark: {
    fontSize: FONT.small,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.text,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.xs,
  },
  edits: {
    fontSize: FONT.small,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.xs,
  },
  status: {
    width: 26,
    fontSize: FONT.large,
    textAlign: 'center',
    color: COLORS.text,
  },
  after: {
    fontSize: FONT.small,
    color: COLORS.muted,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
});
