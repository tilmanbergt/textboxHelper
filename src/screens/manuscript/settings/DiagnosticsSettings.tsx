/** Settings → Diagnostics: Save Diagnostics, the timings (Speed) and the plugin's files (Storage). */
import React, {useCallback, useEffect, useState} from 'react';
import {pluginStorage, runHousekeeping} from '../../../actions/housekeeping';
import {housekeepingResultText, storageSummaryText} from '../../../domain/housekeeping';
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
      <StorageSection busy={busy} />
    </>
  );
}

/** Storage (technical-design-housekeeping.md §3): the plugin folder's size and Clean up now. */
function StorageSection({busy}: {busy: boolean}): React.JSX.Element {
  const [summary, setSummary] = useState('Counting the plugin files…');
  const [result, setResult] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const count = useCallback(() => {
    pluginStorage()
      .then(storage => setSummary(storageSummaryText(storage)))
      .catch(error => {
        console.warn('[Housekeeping] storage not counted', String(error));
        setSummary('The plugin files could not be counted.');
      });
  }, []);
  useEffect(count, [count]);
  const clean = useCallback(() => {
    setCleaning(true);
    runHousekeeping()
      .then(removed => setResult(housekeepingResultText(removed)))
      .finally(() => {
        setCleaning(false);
        count();
      });
  }, [count]);
  return (
    <Section title="Storage">
      <Hint>
        The plugin removes applied and dropped pen edits after 3 days and keeps the 3 newest backups of the last 14
        days. Clean up now does it at once.
      </Hint>
      <Hint>{summary}</Hint>
      {result ? <Hint>{result}</Hint> : null}
      <Row>
        <PillButton size="small" label="Clean up now" disabled={busy || cleaning} onPress={clean} />
      </Row>
    </Section>
  );
}
