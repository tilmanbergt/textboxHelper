/**
 * The rows of To decide (technical-design-mark-dialogue.md §5.3): a number ring for a linked mark
 * whose place stayed open, a "?" ring for text without a mark, an empty dashed box for an unclear
 * mark; its kind; the words (or the recognized text, or "handwriting"); page and paragraph.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {DecideEntry} from '../../domain/manuscriptPages';
import type {PenTextState} from '../../domain/markerTypes';
import {penEditNumberText} from '../../domain/penEditTags';
import EmptyState from '../../ui/EmptyState';
import PagedSection from '../../ui/PagedSection';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';

/** A row: border, padding, the kind line, two lines of words, the meta line. */
const ROW_HEIGHT = 2 * 2 + 2 * SPACING.sm + LINE_HEIGHT.small * 2 + LINE_HEIGHT.medium * 2;

const KIND_LABELS = {placeOpen: 'Place open', noMark: 'No mark', unclear: 'Unclear mark'} as const;

/** What a row says under its kind: the words, the text written, or what it may be. */
export function decideText(entry: DecideEntry, penStates: Record<string, PenTextState>): string {
  const {item} = entry;
  if (item.kind === 'noMark') {
    const state = item.penEditId ? penStates[item.penEditId] : undefined;
    const text = state ? (state.correctedText ?? state.text).trim() : '';
    return text ? `"${text}"` : 'handwriting';
  }
  return item.words ? `${item.summary} · "${item.words}"` : item.summary;
}

interface Props {
  entries: DecideEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  penStates: Record<string, PenTextState>;
  severalPages: boolean;
  resetKey: string;
}

export default function ToDecideList({entries, selectedKey, onSelect, penStates, severalPages, resetKey}: Props): React.JSX.Element {
  return (
    <PagedSection
      header="To decide"
      rows={entries}
      rowHeight={() => ROW_HEIGHT}
      resetKey={resetKey}
      viewportContent={
        entries.length === 0 ? <EmptyState title="Nothing to decide" text="Every mark on the pages read made a change." /> : undefined
      }
      renderRow={entry => {
        const {item} = entry;
        const selected = entry.key === selectedKey;
        const where = [severalPages ? `p.${entry.page + 1}` : null, item.paragraph ? `¶${item.paragraph}` : null].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityState={{selected}}
            accessibilityLabel={`${KIND_LABELS[item.kind]}, ${item.summary}`}
            onPress={() => onSelect(entry.key)}
            style={[styles.row, selected && styles.rowSelected]}>
            {item.kind === 'unclear' ? (
              <View style={styles.box} />
            ) : (
              <Text style={styles.ring}>{penEditNumberText(item.kind === 'noMark' ? null : item.number ?? null)}</Text>
            )}
            <View style={styles.body}>
              <Text style={styles.kind}>{KIND_LABELS[item.kind]}</Text>
              <Text style={styles.text} numberOfLines={2}>
                {decideText(entry, penStates)}
              </Text>
              {where ? <Text style={styles.meta}>{where}</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
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
  ring: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: COLORS.muted,
    borderRadius: 16,
    textAlign: 'center',
    lineHeight: 28,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  box: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.muted,
    borderRadius: RADII.sm,
  },
  body: {
    flex: 1,
  },
  kind: {
    fontSize: FONT.small - 2,
    lineHeight: LINE_HEIGHT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  text: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  meta: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    color: COLORS.muted,
  },
});
