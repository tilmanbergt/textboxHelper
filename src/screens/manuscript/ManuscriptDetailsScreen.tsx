/**
 * Details of the Manuscript card: the linked text file (technical-design-source-link.md §4), the
 * calibration of the text measurement, Save Diagnostics and the timings (Speed). Shares the
 * review's state, so a calibration change re-reads the page the review shows when going back.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import {sourceFileName, sourceFolder} from '../../domain/sourceRecord';
import type {ManuscriptReview} from './useManuscriptReview';
import type {SourceLink} from './useSourceLink';

interface Props {
  review: ManuscriptReview;
  source: SourceLink;
  onBack: () => void;
  onClose: () => void;
}

const OFFSET_STEP = 5;
const WIDTH_STEP = 1;

export default function ManuscriptDetailsScreen({review, source, onBack, onClose}: Props): React.JSX.Element {
  const {calibration, loading, busy, timings} = review;
  const disabled = loading || busy;
  const {update: updateTimings} = timings;
  useEffect(updateTimings, [updateTimings]);
  return (
    <ScreenFrame
      title="Details"
      back={{label: 'Manuscript', onPress: onBack}}
      onClose={onClose}
      status={source.status ?? review.status}
      primary={{label: 'Done', onPress: onBack}}
      screenKey="details">
      <View style={styles.body}>
        {source.linked && <SourceSection source={source} />}

        <Section title="Calibration">
          <Text style={styles.hint}>
            Moves the measured text lines against the drawn ones. Only needed when marks pick the wrong
            words. The values are kept for next time.
          </Text>
          <Stepper
            label="X offset"
            value={`${calibration.offsetX} px`}
            disabled={disabled}
            onMinus={() => review.changeCalibration({offsetX: calibration.offsetX - OFFSET_STEP})}
            onPlus={() => review.changeCalibration({offsetX: calibration.offsetX + OFFSET_STEP})}
            step={OFFSET_STEP}
          />
          <Stepper
            label="Width"
            value={`${calibration.widthAdjustment} px`}
            disabled={disabled}
            onMinus={() => review.changeCalibration({widthAdjustment: calibration.widthAdjustment - WIDTH_STEP})}
            onPlus={() => review.changeCalibration({widthAdjustment: calibration.widthAdjustment + WIDTH_STEP})}
            step={WIDTH_STEP}
          />
          <View style={styles.buttons}>
            <PillButton size="small" label="Reset" disabled={disabled} onPress={review.resetCalibration} />
            <PillButton size="small" label="Refresh preview" disabled={disabled} onPress={review.refresh} />
          </View>
        </Section>

        <Section title="Diagnostics">
          <Text style={styles.hint}>
            Saves how each mark was read and why one was ignored as a file in the EXPORT folder, to attach to
            a bug report. It contains short previews of the textboxes' text.
          </Text>
          <View style={styles.buttons}>
            <PillButton size="small" label="Save Diagnostics" disabled={disabled} onPress={review.saveDiagnostics} />
          </View>
        </Section>

        <Section title="Speed">
          <Text style={styles.hint}>
            Records how long reading pages, recognizing and applying take. Save timings writes them as a file in
            the EXPORT folder, to hand over when something feels slow. No text is in it.
          </Text>
          <Text style={styles.hint}>{timings.summary}</Text>
          <View style={styles.buttons}>
            <PillButton size="small" label="Save timings" disabled={busy} onPress={timings.save} />
            <PillButton size="small" label="Clear" disabled={busy} onPress={timings.clear} />
          </View>
        </Section>
      </View>
    </ScreenFrame>
  );
}

/** "2026-11-20 17:04" in the device's time. */
function shortTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SourceSection({source}: {source: SourceLink}): React.JSX.Element | null {
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const linked = source.linked;
  if (!linked) {
    return null;
  }
  const {record} = linked;
  const folder = sourceFolder(record.filePath).replace(/^\/storage\/emulated\/0\//, '');
  return (
    <Section title="Source file">
      <Text style={styles.line}>
        {sourceFileName(record)} <Text style={styles.hint}>in {folder || 'storage'}</Text>
      </Text>
      <Text style={styles.hint}>
        Imported {shortTime(record.importedAt)}
        {record.lastWrittenAt ? ` · last written ${shortTime(record.lastWrittenAt)}` : ' · not written yet'}
        {linked.sourceCount > 1 ? ` · ${linked.sourceCount} linked files on this note, this one has the most textboxes` : ''}
      </Text>
      {source.access && <Text style={styles.hint}>{source.access}</Text>}
      {confirmUnlink ? (
        <View style={styles.buttons}>
          <Text style={styles.hint}>Unlink? The note and the file stay as they are.</Text>
          <PillButton
            size="small"
            label="Unlink"
            disabled={source.busy}
            onPress={() => {
              setConfirmUnlink(false);
              source.unlink();
            }}
          />
          <PillButton size="small" label="Cancel" onPress={() => setConfirmUnlink(false)} />
        </View>
      ) : (
        <View style={styles.buttons}>
          <PillButton size="small" label="Check write access" disabled={source.busy} onPress={source.checkAccess} />
          <PillButton size="small" label="Unlink" disabled={source.busy} onPress={() => setConfirmUnlink(true)} />
        </View>
      )}
    </Section>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Stepper({
  label,
  value,
  step,
  disabled,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  step: number;
  disabled: boolean;
  onMinus: () => void;
  onPlus: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <PillButton size="small" label={`−${step}`} accessibilityLabel={`${label} minus ${step}`} disabled={disabled} onPress={onMinus} />
      <Text style={styles.stepperValue}>{value}</Text>
      <PillButton size="small" label={`+${step}`} accessibilityLabel={`${label} plus ${step}`} disabled={disabled} onPress={onPlus} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.xl,
    maxWidth: 640,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.xs,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 21,
  },
  line: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  stepperLabel: {
    width: 90,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  stepperValue: {
    minWidth: 70,
    textAlign: 'center',
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
});
