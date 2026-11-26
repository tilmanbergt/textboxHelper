/** Settings → Diagnostics: the version, Report a problem, the timings (Speed) and the plugin's files (Storage). */
import React, {useCallback, useEffect, useState} from 'react';
import {pluginStorage, runHousekeeping} from '../../../actions/housekeeping';
import {currentVersionLine, writeProblemReport} from '../../../actions/problemReport';
import {housekeepingResultText, storageSummaryText} from '../../../domain/housekeeping';
import {fileNameOf, userMessage} from '../../../domain/userMessage';
import Checkbox from '../../../ui/Checkbox';
import PillButton from '../../../ui/PillButton';
import type {ManuscriptReview} from '../useManuscriptReview';
import {Hint, Row, Section} from './SettingsParts';

export default function DiagnosticsSettings({review}: {review: ManuscriptReview}): React.JSX.Element {
  const {busy, timings} = review;
  const {update: updateTimings} = timings;
  useEffect(updateTimings, [updateTimings]);
  return (
    <>
      <ReportSection busy={busy} />
      <Section title="Speed">
        <Hint>
          Records how long reading pages, recognizing and applying take; Report a problem includes them. No text is in
          them.
        </Hint>
        <Hint>{timings.summary}</Hint>
        <Row>
          <PillButton size="small" label="Clear" disabled={busy} onPress={timings.clear} />
        </Row>
      </Section>
      <StorageSection busy={busy} />
    </>
  );
}

/** Report a problem (technical-design-release-readiness.md §4): one file in EXPORT for a bug report. */
function ReportSection({busy}: {busy: boolean}): React.JSX.Element {
  const [includeText, setIncludeText] = useState(false);
  const [writing, setWriting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const report = useCallback(() => {
    setWriting(true);
    writeProblemReport(includeText)
      .then(path => setResult(`Saved to EXPORT: ${fileNameOf(path)}. Attach it to your bug report.`))
      .catch(error => {
        console.warn('[Report] not written', String(error));
        setResult(userMessage(error, 'The report could not be written.'));
      })
      .finally(() => setWriting(false));
  }, [includeText]);
  return (
    <Section title="Report a problem">
      <Hint>{currentVersionLine()}</Hint>
      <Hint>
        Writes one file to EXPORT for a bug report: versions, settings, the last marks read, timings and errors. Your
        text only if ticked.
      </Hint>
      <Checkbox label="Include the text of this page" checked={includeText} onChange={setIncludeText} disabled={writing} />
      <Row>
        <PillButton size="small" label={writing ? 'Writing…' : 'Report a problem'} disabled={busy || writing} onPress={report} />
      </Row>
      {result ? <Hint>{result}</Hint> : null}
    </Section>
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
