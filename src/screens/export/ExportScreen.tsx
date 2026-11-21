/**
 * Export DOCX (technical-design-calmer-screens.md §3.8, canvas "Export DOCX"), opened from the
 * Manuscript card's Files tab (technical-design-settings-layout-files.md §4). Left: which pages
 * and options. Right: the textboxes that will be exported, paged, updated by itself after every
 * change. The classification rules are set in the card's Settings → Export.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ExportScope, ScannedTextBox} from '../../domain/exportClassification';
import {noteNameOf} from '../../domain/exportRulesCheck';
import {EXPORT_HELP} from '../../domain/helpTexts';
import Checkbox from '../../ui/Checkbox';
import {GLYPH} from '../../ui/glyphs';
import NumberField from '../../ui/NumberField';
import PagedSection from '../../ui/PagedSection';
import ScreenFrame from '../../ui/ScreenFrame';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import {useExportScan} from './useExportScan';

const ROW_HEIGHT = 48;

const ROLE_LABELS: Record<ScannedTextBox['role'], string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  comment: 'Comment',
  meta: 'Meta',
  unknown: 'Other',
};

interface Props {
  onClose: () => void;
  onBack: () => void;
  /** Opens Settings → Export. */
  onOpenRules: () => void;
}

export default function ExportScreen({onClose, onBack, onOpenRules}: Props): React.JSX.Element {
  const flow = useExportScan();
  const {note, scan} = flow;

  const totalPages = note?.totalPages ?? null;
  const context = note
    ? [
        noteNameOf(note.filePath),
        note.page !== null && note.page >= 0
          ? `page ${note.page + 1}${totalPages ? ` of ${totalPages}` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const rows = flow.included.map((item, index) => ({key: `${item.page}-${index}`, item}));

  return (
    <ScreenFrame
      title="Export DOCX"
      back={{label: 'Manuscript', onPress: onBack}}
      context={context}
      help={{title: 'Export DOCX', text: EXPORT_HELP}}
      onClose={onClose}
      status={flow.status ?? {text: 'Saved to the EXPORT folder. The note is not changed.'}}
      primary={{
        label: 'Export DOCX',
        onPress: flow.runExport,
        disabled: !scan || flow.scanning || flow.included.length === 0,
        busy: flow.busy,
        busyLabel: 'Exporting…',
      }}
      screenKey={`export-${flow.scope}`}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <Text style={[styles.label, styles.firstLabel]}>Pages</Text>
          <Segmented<ExportScope>
            direction="column"
            options={[
              {key: 'currentPage', label: 'This page'},
              {key: 'wholeNote', label: totalPages ? `Whole note · ${totalPages} pages` : 'Whole note'},
              {key: 'pageRange', label: 'Page range'},
            ]}
            value={flow.scope}
            onChange={flow.setScope}
          />
          {flow.scope === 'pageRange' && (
            <View style={styles.range}>
              <NumberField
                label="From page"
                value={flow.rangeStart}
                min={1}
                max={totalPages ?? 9999}
                onChange={n => flow.setRange(n, Math.max(n, flow.rangeEnd))}
              />
              <NumberField
                label="To page"
                value={flow.rangeEnd}
                min={1}
                max={totalPages ?? 9999}
                onChange={n => flow.setRange(flow.rangeStart, n)}
              />
            </View>
          )}
          <Text style={styles.label}>Options</Text>
          <Checkbox label="Include comments" checked={flow.includeComments} onChange={flow.setIncludeComments} />

          <Pressable accessibilityRole="button" onPress={onOpenRules} style={styles.link}>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Classification rules</Text>
              <Text style={styles.hint}>what counts as heading, paragraph, comment</Text>
            </View>
            <Text style={styles.linkTitle}>{GLYPH.next}</Text>
          </Pressable>
        </View>

        <View style={styles.right}>
          <PagedSection
            header={flow.summary}
            rows={rows}
            rowHeight={() => ROW_HEIGHT}
            resetKey={scan ? `${scan.scannedPages.join(',')}-${rows.length}` : undefined}
            viewportContent={
              flow.scanning && !scan ? (
                <Text style={styles.hint}>Scanning…</Text>
              ) : flow.scanError ? (
                <Text style={styles.error}>{flow.scanError}</Text>
              ) : undefined
            }
            emptyHint="No textboxes to export on these pages."
            renderRow={({key, item}) => (
              <View key={key} style={styles.row}>
                <Text style={styles.kind}>{ROLE_LABELS[item.role]}</Text>
                <Text
                  style={[styles.rowText, item.role === 'heading' && styles.heading]}
                  numberOfLines={1}>
                  {item.text.replace(/\s+/g, ' ').trim()}
                </Text>
                <Text style={styles.page}>p. {item.page + 1}</Text>
              </View>
            )}
          />
          {flow.scanning && scan ? <Text style={styles.hint}>Updating…</Text> : null}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: 360,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    gap: SPACING.xs,
  },
  right: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
  },
  label: {
    fontSize: FONT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
    marginTop: SPACING.md,
  },
  firstLabel: {
    marginTop: 0,
  },
  range: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  link: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
  },
  linkText: {
    flex: 1,
  },
  linkTitle: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  error: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  kind: {
    width: 96,
    fontSize: FONT.small - 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  rowText: {
    flex: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  heading: {
    fontWeight: '700',
  },
  page: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
});
