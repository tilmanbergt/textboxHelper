/**
 * Details of the Manuscript card: the calibration of the text measurement and Save Diagnostics.
 * Shares the review's state, so a calibration change re-reads the page the review shows when
 * going back.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import type {ManuscriptReview} from './useManuscriptReview';

interface Props {
  review: ManuscriptReview;
  onBack: () => void;
  onClose: () => void;
}

const OFFSET_STEP = 5;
const WIDTH_STEP = 1;

export default function ManuscriptDetailsScreen({review, onBack, onClose}: Props): React.JSX.Element {
  const {calibration, loading, busy} = review;
  const disabled = loading || busy;
  return (
    <ScreenFrame
      title="Details"
      back={{label: 'Manuscript', onPress: onBack}}
      onClose={onClose}
      status={review.status}
      primary={{label: 'Done', onPress: onBack}}
      screenKey="details">
      <View style={styles.body}>
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
      </View>
    </ScreenFrame>
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
  buttons: {
    flexDirection: 'row',
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
