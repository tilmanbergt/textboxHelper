/**
 * Settings of the Manuscript card (technical-design-settings-layout-files.md §3), one tab per
 * area: the Outline's headings, the page layout, the export rules, the calibration of the text
 * measurement, diagnostics and timings. Shares the card's state, so a calibration change re-reads
 * the page the review shows and a heading setting reads the outline again.
 */
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import CountTabs from '../../../ui/CountTabs';
import ScreenFrame, {type FrameStatus} from '../../../ui/ScreenFrame';
import {SPACING} from '../../../ui/theme';
import FilesSection from '../FilesSection';
import type {LinkedFiles} from '../useLinkedFiles';
import type {ManuscriptReview} from '../useManuscriptReview';
import type {Outline} from '../outline/useOutline';
import CalibrationSettings from './CalibrationSettings';
import CleanupSection from './CleanupSection';
import DiagnosticsSettings from './DiagnosticsSettings';
import ExportSettings from './ExportSettings';
import LayoutSettings from './LayoutSettings';
import OutlineSettings from './OutlineSettings';

export type SettingsTab = 'files' | 'outline' | 'layout' | 'export' | 'calibration' | 'diagnostics';

interface Props {
  review: ManuscriptReview;
  source: LinkedFiles;
  outline: Outline;
  /** The tab shown first. */
  initialTab?: SettingsTab;
  /** A clean up was planned: the card shows it in the Outline. */
  onCleanUpPlanned: () => void;
  onBack: () => void;
  onClose: () => void;
}

export default function SettingsScreen({
  review,
  source,
  outline,
  initialTab = 'outline',
  onCleanUpPlanned,
  onBack,
  onClose,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const status: FrameStatus | null = source.status ?? review.status;
  return (
    <ScreenFrame
      title="Settings"
      back={{label: 'Manuscript', onPress: onBack}}
      onClose={onClose}
      status={status}
      primary={{label: 'Done', onPress: onBack}}
      screenKey={`settings-${tab}`}>
      <View style={styles.tabs}>
        <CountTabs<SettingsTab>
          tabs={[
            {key: 'files', label: 'Files'},
            {key: 'outline', label: 'Outline'},
            {key: 'layout', label: 'Layout'},
            {key: 'export', label: 'Export'},
            {key: 'calibration', label: 'Calibration'},
            {key: 'diagnostics', label: 'Diagnostics'},
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </View>
      <View style={styles.body}>
        {tab === 'files' ? <FilesSection source={source} /> : null}
        {tab === 'outline' ? <OutlineSettings outline={outline} source={source} /> : null}
        {tab === 'layout' ? (
          <LayoutSettings cleanup={<CleanupSection outline={outline} onPlanned={onCleanUpPlanned} />} />
        ) : null}
        {tab === 'export' ? <ExportSettings /> : null}
        {tab === 'calibration' ? <CalibrationSettings review={review} /> : null}
        {tab === 'diagnostics' ? <DiagnosticsSettings review={review} /> : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  tabs: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  body: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.xl,
  },
});
