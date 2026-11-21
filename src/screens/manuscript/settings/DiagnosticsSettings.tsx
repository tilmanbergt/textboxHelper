/** Settings → Diagnostics: Save Diagnostics and the timings (Speed). */
import React, {useEffect} from 'react';
import PillButton from '../../../ui/PillButton';
import type {ManuscriptReview} from '../useManuscriptReview';
import {Hint, Row, Section} from './SettingsParts';

export default function DiagnosticsSettings({review}: {review: ManuscriptReview}): React.JSX.Element {
  const {loading, busy, timings} = review;
  const {update: updateTimings} = timings;
  useEffect(updateTimings, [updateTimings]);
  return (
    <>
      <Section title="Diagnostics">
        <Hint>
          Saves how each mark was read and why one was ignored as a file in the EXPORT folder, to attach to a bug
          report. It contains short previews of the textboxes' text.
        </Hint>
        <Row>
          <PillButton size="small" label="Save Diagnostics" disabled={loading || busy} onPress={review.saveDiagnostics} />
        </Row>
      </Section>
      <Section title="Speed">
        <Hint>
          Records how long reading pages, recognizing and applying take. Save timings writes them as a file in the
          EXPORT folder, to hand over when something feels slow. No text is in it.
        </Hint>
        <Hint>{timings.summary}</Hint>
        <Row>
          <PillButton size="small" label="Save timings" disabled={busy} onPress={timings.save} />
          <PillButton size="small" label="Clear" disabled={busy} onPress={timings.clear} />
        </Row>
      </Section>
    </>
  );
}
