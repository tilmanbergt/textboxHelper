/**
 * Details of the edit-marker review (canvas "Edit markers · ⚙ Details"): where the markers were
 * read from, the calibration of the text measurement, and Save Diagnostics. Shares the review's
 * state, so a calibration change re-reads the preview the review shows when going back.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {EditMarkerPreviewScope} from '../../domain/markerTypes';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import type {EditMarkerReview} from './useEditMarkerReview';

interface Props {
  review: EditMarkerReview;
  scope: EditMarkerPreviewScope;
  onBack: () => void;
  onClose: () => void;
}

const OFFSET_STEP = 5;
const WIDTH_STEP = 1;

export default function MarkerDetailsScreen({review, scope, onBack, onClose}: Props): React.JSX.Element {
  const {calibration, loading, busy} = review;
  const disabled = loading || busy;
  return (
    <ScreenFrame
      title="Details"
      back={{label: 'Edit markers', onPress: onBack}}
      onClose={onClose}
      status={review.status}
      primary={{label: 'Done', onPress: onBack}}
      screenKey="details">
      <View style={styles.body}>
        <Section title="Markers read from">
          <Text style={styles.line}>{scope === 'page' ? 'The whole page' : 'The lasso selection'}</Text>
          <Text style={styles.hint}>
            {scope === 'page'
              ? 'Lasso markers and textboxes and tap "Apply Edit Markers" in the lasso toolbar to review only those.'
              : 'Use the note button "Apply All Edit Markers" to review every marker on the page.'}
          </Text>
        </Section>

        <Section title="Calibration">
          <Text style={styles.hint}>
            Moves the measured text lines against the drawn ones. Only needed when markers pick the wrong
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
            Saves how each marker was read and why one was ignored as a file in the EXPORT folder, to attach to
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
  line: {
    fontSize: FONT.medium,
    color: COLORS.text,
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
