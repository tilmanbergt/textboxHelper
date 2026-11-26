/**
 * The file "Report a problem" writes to EXPORT (technical-design-release-readiness.md §4.1): build,
 * device, the open note, settings, the last marks read, timings and the session's errors. The
 * user's text is in it only when they tick "Include the text of this page": otherwise every text
 * preview in the marker diagnostics is emptied and note paths are cut to the note's file name.
 */
import type {DiagnosticSnapshot} from './diagnosticLog';
import type {ErrorEntry} from './errorRing';

export type ReportBuild = {label: string; version: string; versionCode: number; commit: string; snPluginLib: string};

export type ReportDevice = {
  model: string | null;
  manufacturer: string | null;
  /** Android version (and firmware fingerprint where the host gives one). */
  os: string | null;
  screen: {width: number; height: number; scale: number} | null;
};

export type ReportNote = {
  /** File name only, no folders. */
  name: string;
  pageCount: number | null;
  /** 1-based. */
  currentPage: number;
  pageSize: {width: number; height: number} | null;
  linked: {mode: string; count: number} | null;
};

export type ProblemReportInput = {
  createdAt: string;
  build: ReportBuild;
  device: ReportDevice;
  note: ReportNote | null;
  /** Why the note couldn't be read, when it couldn't. */
  noteError?: string;
  settings: unknown;
  markers: DiagnosticSnapshot & {pages: number[]};
  timings: {entryCount: number; droppedCount: number; summary: unknown; events: unknown};
  errors: {entries: ErrorEntry[]; droppedCount: number};
  /** The current page's textboxes' text, only when the user ticked it. */
  pageText: string[] | null;
};

export const REPORT_KIND = 'manuscript-report';

export function reportFileName(createdAt: string): string {
  return `manuscript-report-${createdAt.replace(/[:.]/g, '-')}.json`;
}

export function buildProblemReport(input: ProblemReportInput): Record<string, unknown> {
  const includeText = input.pageText !== null;
  return {
    kind: REPORT_KIND,
    version: 1,
    createdAt: input.createdAt,
    includesText: includeText,
    plugin: input.build,
    device: input.device,
    note: input.note,
    ...(input.noteError ? {noteError: input.noteError} : {}),
    // Settings hold folder paths (the last import, linked folders): cut to their names without text.
    settings: includeText ? input.settings : redactText(input.settings),
    errors: input.errors,
    markers: {
      pages: input.markers.pages,
      entryCount: input.markers.entries.length,
      droppedCount: input.markers.droppedCount,
      entries: includeText ? input.markers.entries : redactText(input.markers.entries),
    },
    timings: input.timings,
    ...(includeText ? {text: input.pageText} : {}),
  };
}

// Keys whose string values hold the user's words (previews, recognized text, quotes).
const TEXT_KEY = /text|preview|word|snippet|quote|title|recogni/i;
// Keys whose string values hold a path: only the file name stays.
const PATH_KEY = /path$/i;
// Keys that look like text keys but hold no words.
const NOT_TEXT = new Set(['textAlign', 'textBold', 'textLength', 'textRect', 'textLeftX', 'fontPath', 'typefaceStatus']);

/** A copy of `value` with the user's text emptied and paths cut to their file name. */
export function redactText(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(redactText);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && PATH_KEY.test(key)) {
        out[key] = fileName(item);
      } else if (!NOT_TEXT.has(key) && TEXT_KEY.test(key) && containsText(item)) {
        out[key] = emptyLike(item);
      } else {
        out[key] = redactText(item);
      }
    }
    return out;
  }
  return value;
}

function containsText(value: unknown): boolean {
  return typeof value === 'string' || (Array.isArray(value) && value.some(v => typeof v === 'string'));
}

function emptyLike(value: unknown): unknown {
  if (typeof value === 'string') {
    return value ? `[${value.length} characters]` : '';
  }
  return (value as unknown[]).map(v => (typeof v === 'string' ? `[${v.length} characters]` : redactText(v)));
}

export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** "Manuscript 0.3.0-alpha+a1b2c3d · build 473462 · Supernote A5 X · Android 8.1". */
export function versionLine(build: ReportBuild, device: ReportDevice): string {
  const model = [device.manufacturer, device.model].filter(Boolean).join(' ');
  return [`Manuscript ${build.label}`, build.versionCode ? `build ${build.versionCode}` : null, model || null, device.os]
    .filter(Boolean)
    .join(' · ');
}
