/**
 * Settings → Calibration: moves the measured text lines against the drawn ones. Shares the
 * review's state, so a change re-reads the page the review shows when going back.
 */
import React from 'react';
import PillButton from '../../../ui/PillButton';
import type {ManuscriptReview} from '../useManuscriptReview';
import {Hint, Row, Section, Stepper} from './SettingsParts';

const OFFSET_STEP = 5;
const WIDTH_STEP = 1;

export default function CalibrationSettings({review}: {review: ManuscriptReview}): React.JSX.Element {
  const {calibration, loading, busy} = review;
  const disabled = loading || busy;
  return (
    <Section title="Calibration">
      <Hint>
        Moves the measured text lines against the drawn ones. Only needed when marks pick the wrong words. The values
        are kept for next time.
      </Hint>
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
      <Row>
        <PillButton size="small" label="Reset" disabled={disabled} onPress={review.resetCalibration} />
        <PillButton size="small" label="Refresh preview" disabled={disabled} onPress={review.refresh} />
      </Row>
    </Section>
  );
}
