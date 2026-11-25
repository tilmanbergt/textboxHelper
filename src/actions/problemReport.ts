/**
 * Report a problem (technical-design-release-readiness.md §4): one JSON file in EXPORT for a bug
 * report - build, device, the open note, settings, the last marks read, timings and the session's
 * errors; the current page's text only when `includeText`. Reading the note may fail (no note
 * open, a host error): the report is written anyway and says why.
 */
import {Dimensions, Platform} from 'react-native';
import {BUILD_INFO} from '../generated/buildInfo';
import {countEvents, summarizePerf} from '../domain/perfLog';
import {
  buildProblemReport,
  fileName,
  reportFileName,
  versionLine,
  type ReportBuild,
  type ReportDevice,
  type ReportNote,
} from '../domain/problemReport';
import {readNoteLinks} from '../storage/sourceStore';
import {getSettings} from '../storage/settingsFile';
import {writeJsonExportFile} from '../storage/exportFile';
import {getCurrentNoteContext, readNotePageCount} from '../supernote/noteElements';
import {markerDiagnostics} from '../utils/editMarkerLog';
import {sessionErrorSnapshot} from '../utils/errorLog';
import {perfLog} from '../utils/perf';
import {diagnosticsPagesRead} from './markerCalibration';

export function reportBuild(): ReportBuild {
  return {
    label: BUILD_INFO.label,
    version: BUILD_INFO.version,
    versionCode: BUILD_INFO.versionCode,
    commit: BUILD_INFO.commit,
    snPluginLib: BUILD_INFO.snPluginLib,
  };
}

export function reportDevice(): ReportDevice {
  const constants = (Platform.constants ?? {}) as Record<string, unknown>;
  const text = (key: string): string | null => (typeof constants[key] === 'string' && constants[key] ? String(constants[key]) : null);
  const release = text('Release');
  const screen = (() => {
    try {
      const {width, height, scale} = Dimensions.get('screen');
      return {width, height, scale};
    } catch {
      return null;
    }
  })();
  return {
    model: text('Model'),
    manufacturer: text('Manufacturer') ?? text('Brand'),
    os: [release ? `Android ${release}` : null, text('Fingerprint')].filter(Boolean).join(' · ') || null,
    screen,
  };
}

/** "Manuscript 0.3.0-alpha+a1b2c3d · build 473462 · Ratta Supernote A5 X · Android 8.1 · …". */
export function currentVersionLine(): string {
  return versionLine(reportBuild(), reportDevice());
}

async function readNote(includeText: boolean): Promise<{note: ReportNote | null; noteError?: string; pageText: string[] | null}> {
  try {
    const context = await getCurrentNoteContext();
    const pageCount = await readNotePageCount(context.notePath).catch(() => null);
    const links = await readNoteLinks(context.notePath).catch(() => null);
    const pageText = includeText
      ? context.pageElements
          .map(element => element.textBox?.textContentFull)
          .filter((text): text is string => typeof text === 'string')
      : null;
    return {
      note: {
        name: fileName(context.notePath),
        pageCount,
        currentPage: context.currentPage + 1,
        pageSize: context.pageSize ? {width: context.pageSize.width, height: context.pageSize.height} : null,
        linked: links ? {mode: links.mode, count: links.sources.length} : null,
      },
      pageText,
    };
  } catch (error) {
    return {note: null, noteError: String(error), pageText: includeText ? [] : null};
  }
}

/** Writes the report to EXPORT and returns its path. */
export async function writeProblemReport(includeText: boolean): Promise<string> {
  const createdAt = new Date().toISOString();
  const {note, noteError, pageText} = await readNote(includeText);
  const perfEntries = perfLog.entries();
  const report = buildProblemReport({
    createdAt,
    build: reportBuild(),
    device: reportDevice(),
    note,
    noteError,
    settings: getSettings(),
    markers: {...markerDiagnostics.snapshot(), pages: diagnosticsPagesRead()},
    timings: {
      entryCount: perfEntries.length,
      droppedCount: perfLog.droppedCount(),
      summary: summarizePerf(perfEntries),
      events: countEvents(perfEntries),
    },
    errors: sessionErrorSnapshot(),
    pageText,
  });
  return writeJsonExportFile(reportFileName(createdAt), report);
}
