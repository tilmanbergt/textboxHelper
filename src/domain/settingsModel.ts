/**
 * What the plugin remembers between sessions (technical-design-calmer-screens.md §3.9): the import
 * settings, the export scope and rules, the edit-marker calibration, and how the Outline treats
 * headings (technical-design-outline-sections.md §8). Stored as JSON in the
 * plugin folder by storage/settingsFile.ts.
 *
 * Reading is field by field: a missing or invalid value takes its default, the rest of the file
 * still counts, and unknown keys are ignored. So a file from an older or newer version, or one
 * edited by hand, never resets everything. The page range of an export is not stored: it belongs
 * to one note.
 */
import {
  DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
  type ExportClassificationConfig,
  type RoleRuleConfig,
  type StyleRequirement,
} from './exportConfig';
import type {ExportScope} from './exportClassification';
import {
  DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  pathFromInboxRelative,
  type TextboxImportRoleStyle,
  type TextboxImportSettings,
} from './importSettings';
import {HEADING_LEVELS, type HeadingLevel} from './headingText';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION, type TextboxMeasurementCalibration} from './textboxLayout';

export type ExportSettings = {
  scope: ExportScope;
  includeComments: boolean;
  rules: ExportClassificationConfig;
};

/** How the Outline treats headings. */
export type OutlineSettings = {
  /** The level of a textbox under a NOTE title without #s. */
  defaultHeadingLevel: HeadingLevel;
  /** Heading levels that get a NOTE title, so they show in the note's table of contents. */
  titleLevels: HeadingLevel[];
  /** NOTE title style per heading level: 1 black, 2 light grey, 3 dark grey, 4 shadow. */
  titleStyles: Record<HeadingLevel, number>;
};

export type PluginSettings = {
  version: 1;
  import: TextboxImportSettings;
  export: ExportSettings;
  markers: {calibration: TextboxMeasurementCalibration};
  outline: OutlineSettings;
};

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  defaultHeadingLevel: 1,
  titleLevels: [1, 2],
  titleStyles: {1: 1, 2: 3, 3: 2},
};

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  version: 1,
  import: DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  export: {
    scope: 'currentPage',
    includeComments: false,
    rules: DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
  },
  markers: {calibration: DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION},
  outline: DEFAULT_OUTLINE_SETTINGS,
};

/** Calibration values beyond this are a mistake, not a correction. */
const MAX_CALIBRATION_PX = 200;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;
const MAX_MARGIN = 1000;

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function roleStyle(value: unknown, fallback: TextboxImportRoleStyle): TextboxImportRoleStyle {
  const raw = asObject(value);
  return {
    fontSize: num(raw.fontSize, fallback.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    bold: bool(raw.bold, fallback.bold),
  };
}

function parseImport(value: unknown): TextboxImportSettings {
  const raw = asObject(value);
  const d = DEFAULT_TEXTBOX_IMPORT_SETTINGS;
  const structure = asObject(raw.structure);
  // An older file stored the path relative to INBOX (`filename`); a file chosen in the former second
  // import folder (MyStyle) can't be read any more.
  const filePath =
    typeof raw.filePath === 'string'
      ? raw.filePath
      : typeof raw.filename === 'string' && raw.sourceFolder !== 'myStyle'
      ? pathFromInboxRelative(raw.filename)
      : d.filePath;
  return {
    filePath,
    linkToFile: bool(raw.linkToFile, d.linkToFile),
    fileTitleStyle: [1, 2, 3, 4].includes(raw.fileTitleStyle as number) ? (raw.fileTitleStyle as number) : d.fileTitleStyle,
    fontSize: num(raw.fontSize, d.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    structure: {
      layoutMode: oneOf(structure.layoutMode, ['continuous', 'paragraphTextboxes'] as const, d.structure.layoutMode),
      paragraphSeparator: oneOf(
        structure.paragraphSeparator,
        ['blankLine', 'line'] as const,
        d.structure.paragraphSeparator,
      ),
      detectMarkdownHeadings: bool(structure.detectMarkdownHeadings, d.structure.detectMarkdownHeadings),
      paragraph: roleStyle(structure.paragraph, d.structure.paragraph),
      heading1: roleStyle(structure.heading1, d.structure.heading1),
      heading2: roleStyle(structure.heading2, d.structure.heading2),
      heading3: roleStyle(structure.heading3, d.structure.heading3),
    },
    marginLeft: num(raw.marginLeft, d.marginLeft, 0, MAX_MARGIN),
    marginTop: num(raw.marginTop, d.marginTop, 0, MAX_MARGIN),
    marginRight: num(raw.marginRight, d.marginRight, 0, MAX_MARGIN),
    marginBottom: num(raw.marginBottom, d.marginBottom, 0, MAX_MARGIN),
    insertMode: oneOf(raw.insertMode, ['auto', 'currentPage', 'afterCurrentPage'] as const, d.insertMode),
  };
}

const REQUIREMENTS = ['any', 'yes', 'no'] as const;

function rule(value: unknown, fallback: RoleRuleConfig): RoleRuleConfig {
  const raw = asObject(value);
  const minFontSize = num(raw.minFontSize, fallback.minFontSize, 0, 1000);
  const maxFontSize = num(raw.maxFontSize, fallback.maxFontSize, 0, 1000);
  const sizes =
    minFontSize <= maxFontSize
      ? {minFontSize, maxFontSize}
      : {minFontSize: fallback.minFontSize, maxFontSize: fallback.maxFontSize};
  return {
    ...sizes,
    bold: oneOf<StyleRequirement>(raw.bold, REQUIREMENTS, fallback.bold),
    italic: oneOf<StyleRequirement>(raw.italic, REQUIREMENTS, fallback.italic),
    border: oneOf<StyleRequirement>(raw.border, REQUIREMENTS, fallback.border),
  };
}

function parseExport(value: unknown): ExportSettings {
  const raw = asObject(value);
  const rules = asObject(raw.rules);
  const d = DEFAULT_PLUGIN_SETTINGS.export;
  return {
    scope: oneOf(raw.scope, ['currentPage', 'wholeNote', 'pageRange'] as const, d.scope),
    includeComments: bool(raw.includeComments, d.includeComments),
    rules: {
      heading: rule(rules.heading, d.rules.heading),
      paragraph: rule(rules.paragraph, d.rules.paragraph),
      comment: rule(rules.comment, d.rules.comment),
      meta: rule(rules.meta, d.rules.meta),
      treatTitleTextBoxesAsHeadings: bool(rules.treatTitleTextBoxesAsHeadings, d.rules.treatTitleTextBoxesAsHeadings),
    },
  };
}

function parseCalibration(value: unknown): TextboxMeasurementCalibration {
  const raw = asObject(asObject(value).calibration);
  const d = DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION;
  return {
    offsetX: num(raw.offsetX, d.offsetX, -MAX_CALIBRATION_PX, MAX_CALIBRATION_PX),
    offsetY: num(raw.offsetY, d.offsetY, -MAX_CALIBRATION_PX, MAX_CALIBRATION_PX),
    widthAdjustment: num(raw.widthAdjustment, d.widthAdjustment, -MAX_CALIBRATION_PX, MAX_CALIBRATION_PX),
  };
}

function parseOutline(value: unknown): OutlineSettings {
  const raw = asObject(value);
  const d = DEFAULT_OUTLINE_SETTINGS;
  const level = (item: unknown, fallback: HeadingLevel) => num(item, fallback, 1, 3) as HeadingLevel;
  const styles = asObject(raw.titleStyles);
  return {
    defaultHeadingLevel: level(raw.defaultHeadingLevel, d.defaultHeadingLevel),
    titleLevels: Array.isArray(raw.titleLevels)
      ? HEADING_LEVELS.filter(item => (raw.titleLevels as unknown[]).includes(item))
      : d.titleLevels,
    titleStyles: {
      1: num(styles[1], d.titleStyles[1], 1, 4),
      2: num(styles[2], d.titleStyles[2], 1, 4),
      3: num(styles[3], d.titleStyles[3], 1, 4),
    },
  };
}

/** The settings from the file's text; null or unreadable JSON gives the defaults. */
export function parseSettings(json: string | null): PluginSettings {
  let raw: Raw = {};
  if (json) {
    try {
      raw = asObject(JSON.parse(json));
    } catch {
      raw = {};
    }
  }
  return {
    version: 1,
    import: parseImport(raw.import),
    export: parseExport(raw.export),
    markers: {calibration: parseCalibration(raw.markers)},
    outline: parseOutline(raw.outline),
  };
}

export function serializeSettings(settings: PluginSettings): string {
  return JSON.stringify(settings, null, 2);
}
