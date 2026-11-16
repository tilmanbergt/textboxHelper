/**
 * TEMPORARY device test for the calmer-screens foundation (technical-design-calmer-screens.md §7,
 * step S1, device stop 1). Opened from the lasso screen's "Paging test" button; removed in step
 * S3. Shows every new building block with enough content to need several pages.
 */
import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {TextSegment} from '../../domain/textPages';
import Checkbox from '../../ui/Checkbox';
import CountTabs from '../../ui/CountTabs';
import PagedSection from '../../ui/PagedSection';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import ScreenFrame, {type FrameStatus} from '../../ui/ScreenFrame';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';

type Row = {id: number; label: string};
type Tab = 'text' | 'controls';

const SENTENCE =
  'GTD and PARA for the Supernote: todos, meetings and next actions, joined to the notes you write. ';

function buildSegments(): TextSegment[] {
  const segments: TextSegment[] = [];
  for (let i = 1; i <= 14; i += 1) {
    segments.push({text: `${i}. ${SENTENCE}Engage: `});
    segments.push({text: 'your next actions', style: 'removed'});
    segments.push({text: ' and ', style: undefined});
    segments.push({text: 'the context', style: 'inserted'});
    segments.push({text: ' right on the note page you are working in.\n'});
  }
  return segments;
}

const HELP = `## Paging test
This screen checks the new building blocks on the device.

## What to check
The text on the right breaks pages at whole lines. The list on the left shows +N and arrows only when there is more. Every page turn redraws the screen cleanly.`;

export default function PagingTestScreen({onBack}: {onBack: () => void}): React.JSX.Element {
  const rows = useMemo<Row[]>(
    () => Array.from({length: 40}, (_, i) => ({id: i, label: `Row ${i + 1}: Delete "few words to make"`})),
    [],
  );
  const segments = useMemo(buildSegments, []);
  const [tab, setTab] = useState<Tab>('text');
  const [jumpKey, setJumpKey] = useState(0);
  const [mode, setMode] = useState<'a' | 'b' | 'c'>('a');
  const [checked, setChecked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>({text: 'Turn pages in both columns.'});

  return (
    <ScreenFrame
      title="Paging test"
      context="temporary · step S1"
      back={{label: 'Tools', onPress: onBack}}
      help={{title: 'Paging test', text: HELP}}
      onClose={onBack}
      status={status}
      primary={{
        label: 'Simulate apply',
        busy,
        busyLabel: 'Applying…',
        onPress: () => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setStatus({text: 'Done. Backup: page-3-20261116.json'});
          }, 1500);
        },
      }}
      screenKey={tab}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <PagedSection
            header="Changes"
            rows={rows}
            rowHeight={() => 48}
            renderRow={row => (
              <View key={row.id} style={styles.row}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {row.label}
                </Text>
              </View>
            )}
          />
        </View>
        <View style={styles.right}>
          <CountTabs
            tabs={[
              {key: 'text', label: 'Text', count: segments.length},
              {key: 'controls', label: 'Controls'},
            ]}
            activeKey={tab}
            onChange={setTab}
          />
          {tab === 'text' ? (
            <PagedText
              header="Textbox 12 · 14 changes"
              headerAccessory={
                <PillButton label="Jump to 10." size="small" onPress={() => setJumpKey(k => k + 1)} />
              }
              segments={segments}
              jumpTo={jumpKey > 0 ? {key: jumpKey, index: findChar(segments, '10. ')} : null}
            />
          ) : (
            <View style={styles.controls}>
              <Segmented
                options={[
                  {key: 'a', label: 'Continuous text'},
                  {key: 'b', label: 'Paragraph boxes'},
                  {key: 'c', label: 'Off', disabled: true},
                ]}
                value={mode}
                onChange={setMode}
              />
              <Segmented
                size="small"
                options={[
                  {key: 'a', label: 'Any'},
                  {key: 'b', label: 'Yes'},
                  {key: 'c', label: 'No'},
                ]}
                value={mode}
                onChange={setMode}
              />
              <Checkbox label="Recognize #, ##, ###" checked={checked} onChange={setChecked} />
              <Text style={styles.hint}>Status errors look like this:</Text>
              <PillButton
                label="Show an error"
                size="small"
                onPress={() => setStatus({text: 'Could not read the page.', kind: 'error'})}
              />
            </View>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

function findChar(segments: TextSegment[], needle: string): number {
  let offset = 0;
  for (const segment of segments) {
    const at = segment.text.indexOf(needle);
    if (at >= 0) {
      return offset + at;
    }
    offset += segment.text.length;
  }
  return 0;
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: 320,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  right: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
  },
  row: {
    height: 48,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rowText: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  controls: {
    gap: SPACING.base,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
});
