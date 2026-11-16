/**
 * State and flows of the Export screen (technical-design-calmer-screens.md §3.8). Reads the note
 * context once, scans on open and 500 ms after the scope, the page range or the rules change (a
 * newer scan makes an older one's result stale), and exports the scan. Scope, "Include comments"
 * and the rules are remembered in the settings file; the page range is not (it belongs to one
 * note). "Include comments" only filters the scan, so it doesn't scan again.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {scanTextBoxes} from '../../actions/textboxScan';
import {
  getIncludedRoleCounts,
  getIncludedScanItems,
  summarizeExcludedStyles,
  type ExportScope,
  type ScanSummary,
  type ScannedTextBox,
} from '../../domain/exportClassification';
import type {ExportClassificationConfig} from '../../domain/exportConfig';
import {exportRulesProblem} from '../../domain/exportRulesCheck';
import {plural} from '../../domain/plural';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {exportScannedDocx, MAX_EXPORT_ITEM_COUNT} from '../../storage/docxExport';
import {getSettings, updateSettings} from '../../storage/settingsFile';
import {refreshExportNoteContext, type ExportNoteContext} from '../../supernote/exportNoteContext';
import type {FrameStatus} from '../../ui/ScreenFrame';

const SCAN_DELAY_MS = 500;

export interface ExportScan {
  note: ExportNoteContext | null;
  scope: ExportScope;
  includeComments: boolean;
  rangeStart: number;
  rangeEnd: number;
  rules: ExportClassificationConfig;
  rulesProblem: string | null;
  scan: ScanSummary | null;
  scanning: boolean;
  scanError: string | null;
  included: ScannedTextBox[];
  summary: string;
  busy: boolean;
  status: FrameStatus | null;
  setScope: (scope: ExportScope) => void;
  setIncludeComments: (value: boolean) => void;
  setRange: (start: number, end: number) => void;
  setRules: (rules: ExportClassificationConfig) => void;
  runExport: () => void;
}

export function useExportScan(): ExportScan {
  const saved = getSettings().export;
  const [note, setNote] = useState<ExportNoteContext | null>(null);
  const [scope, setScopeState] = useState<ExportScope>(saved.scope);
  const [includeComments, setIncludeCommentsState] = useState(saved.includeComments);
  const [range, setRangeState] = useState<{start: number; end: number}>({start: 1, end: 1});
  const [rules, setRulesState] = useState<ExportClassificationConfig>(saved.rules);
  // The rules the scan uses: the edited ones as long as they are valid.
  const [scanRules, setScanRules] = useState<ExportClassificationConfig>(saved.rules);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>(null);
  const runRef = useRef(0);

  const remember = useCallback((next: Partial<typeof saved>) => {
    updateSettings(current => ({...current, export: {...current.export, ...next}}));
  }, []);

  useEffect(() => {
    refreshExportNoteContext()
      .then(context => {
        setNote(context);
        const page = (context.page ?? 0) + 1;
        setRangeState({start: page, end: page});
      })
      .catch(error => {
        console.warn('[Export] note context failed', String(error));
        setScanning(false);
        setScanError(userMessage(error, 'Could not read the current note.'));
      });
  }, []);

  useEffect(() => {
    if (!note) {
      return;
    }
    const run = ++runRef.current;
    setScanning(true);
    const timer = setTimeout(() => {
      scanTextBoxes({
        notePath: note.filePath,
        currentPage: note.page,
        totalPages: note.totalPages,
        scope,
        config: scanRules,
        pageRangeStart: range.start,
        pageRangeEnd: range.end,
      })
        .then(next => {
          if (run === runRef.current) {
            setScan(next);
            setScanError(null);
          }
        })
        .catch(error => {
          if (run === runRef.current) {
            console.warn('[Export] scan failed', String(error));
            setScan(null);
            setScanError(userMessage(error, 'Could not read the textboxes.'));
          }
        })
        .finally(() => run === runRef.current && setScanning(false));
    }, SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [note, range, scanRules, scope]);

  const setScope = useCallback(
    (next: ExportScope) => {
      setScopeState(next);
      remember({scope: next});
    },
    [remember],
  );

  const setIncludeComments = useCallback(
    (next: boolean) => {
      setIncludeCommentsState(next);
      remember({includeComments: next});
    },
    [remember],
  );

  const setRange = useCallback((start: number, end: number) => setRangeState({start, end}), []);

  const setRules = useCallback(
    (next: ExportClassificationConfig) => {
      setRulesState(next);
      if (!exportRulesProblem(next)) {
        setScanRules(next);
        remember({rules: next});
      }
    },
    [remember],
  );

  const included = useMemo(() => (scan ? getIncludedScanItems(scan, includeComments) : []), [includeComments, scan]);

  const summary = useMemo(() => {
    if (!scan) {
      return 'Will export';
    }
    const counts = getIncludedRoleCounts(scan, includeComments);
    const parts = [
      counts.heading > 0 ? plural(counts.heading, 'heading') : null,
      counts.paragraph > 0 ? plural(counts.paragraph, 'paragraph') : null,
      counts.comment > 0 ? plural(counts.comment, 'comment') : null,
    ].filter(Boolean);
    return parts.length > 0 ? `Will export ${parts.join(' · ')}` : 'Nothing to export';
  }, [includeComments, scan]);

  // The status line names what is left out or too much - only when it applies.
  const hint = useMemo<FrameStatus | null>(() => {
    if (!scan) {
      return null;
    }
    if (included.length > MAX_EXPORT_ITEM_COUNT) {
      return {kind: 'error', text: `More than ${MAX_EXPORT_ITEM_COUNT} textboxes: choose fewer pages.`};
    }
    const excluded = summarizeExcludedStyles(scan, includeComments).reduce((sum, item) => sum + item.count, 0);
    return excluded > 0 ? {text: `${plural(excluded, 'textbox', 'textboxes')} not exported (meta, comments or other styles).`} : null;
  }, [includeComments, included.length, scan]);

  const runExport = useCallback(() => {
    if (!scan || busy) {
      return;
    }
    setBusy(true);
    setStatus({text: 'Exporting…'});
    exportScannedDocx({scan, includeComments, onProgress: message => setStatus({text: message})})
      .then(result =>
        setStatus({text: `Exported ${plural(result.exportedItemCount, 'textbox', 'textboxes')} to EXPORT: ${fileNameOf(result.exportPath)}`}),
      )
      .catch(error => {
        console.warn('[Export] export failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The export failed.')});
      })
      .finally(() => setBusy(false));
  }, [busy, includeComments, scan]);

  return {
    note,
    scope,
    includeComments,
    rangeStart: range.start,
    rangeEnd: range.end,
    rules,
    rulesProblem: exportRulesProblem(rules),
    scan,
    scanning,
    scanError,
    included,
    summary,
    busy,
    status: status ?? hint,
    setScope,
    setIncludeComments,
    setRange,
    setRules,
    runExport,
  };
}
