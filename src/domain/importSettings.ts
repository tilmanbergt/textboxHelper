/**
 * Settings of the text import: the chosen file, layout, paragraph separator, heading styles,
 * margins, insert mode, their defaults, and where the text file is read from.
 *
 * Text files are read from INBOX only (the device folder's exact name). The file is chosen with
 * the Supernote file selector, which is limited to INBOX; `filename` is its path relative to
 * INBOX, so files in subfolders work. An empty `filename` means no file is chosen yet.
 */

export type TextboxImportLayoutMode =
  | 'continuous'
  | 'paragraphTextboxes';

export type TextboxImportParagraphSeparator =
  | 'blankLine'
  | 'line';

export type TextboxImportRoleStyle = {
  fontSize: number;
  bold: boolean;
};

export type TextboxImportStructureSettings = {
  layoutMode: TextboxImportLayoutMode;
  paragraphSeparator: TextboxImportParagraphSeparator;
  detectMarkdownHeadings: boolean;
  paragraph: TextboxImportRoleStyle;
  heading1: TextboxImportRoleStyle;
  heading2: TextboxImportRoleStyle;
  heading3: TextboxImportRoleStyle;
};

export type TextboxImportInsertMode =
  | 'auto'
  | 'currentPage'
  | 'afterCurrentPage';

export type TextboxImportSettings = {
  /** Path relative to INBOX; '' = no file chosen. */
  filename: string;
  fontSize: number;
  structure: TextboxImportStructureSettings;
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  insertMode: TextboxImportInsertMode;
};

export const DEFAULT_TEXTBOX_IMPORT_SETTINGS: TextboxImportSettings = {
  filename: '',
  fontSize: 36,
  structure: {
    layoutMode: 'continuous',
    paragraphSeparator: 'blankLine',
    detectMarkdownHeadings: true,
    paragraph: {
      fontSize: 36,
      bold: false,
    },
    heading1: {
      fontSize: 52,
      bold: true,
    },
    heading2: {
      fontSize: 46,
      bold: true,
    },
    heading3: {
      fontSize: 40,
      bold: true,
    },
  },
  marginLeft: 100,
  marginTop: 100,
  marginRight: 200,
  marginBottom: 200,
  insertMode: 'auto',
};

export const IMPORT_FOLDER = '/storage/emulated/0/INBOX';

/** The same storage under the other names Android uses for it. */
const STORAGE_ROOTS = ['/storage/emulated/0/', '/sdcard/', '/storage/self/primary/'];

export function resolveTextboxImportPath(settings: TextboxImportSettings): string {
  const filename = settings.filename.trim().replace(/^\/+/, '');
  if (!filename) {
    throw new Error('Choose a text file first.');
  }
  return `${IMPORT_FOLDER}/${filename}`;
}

/**
 * The path a file selector returned, relative to INBOX, or null when the file is outside INBOX
 * or not a .txt file (the selector is limited to INBOX and .txt, this checks it anyway).
 */
export function importPathRelativeToInbox(absolutePath: string): string | null {
  const path = absolutePath.trim().replace(/\/{2,}/g, '/');
  for (const root of STORAGE_ROOTS) {
    const prefix = `${root}INBOX/`;
    if (path.length > prefix.length && path.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
      const relative = path.slice(prefix.length);
      if (relative.split('/').includes('..') || !/\.txt$/i.test(relative)) {
        return null;
      }
      return relative;
    }
  }
  return null;
}

export type HeadingStyleKey = 'heading1' | 'heading2' | 'heading3';

/** The paragraph font size is kept in two places (continuous text, paragraph style); both change. */
export function withParagraphFontSize(settings: TextboxImportSettings, fontSize: number): TextboxImportSettings {
  return {
    ...settings,
    fontSize,
    structure: {...settings.structure, paragraph: {...settings.structure.paragraph, fontSize}},
  };
}

export function withHeadingFontSize(
  settings: TextboxImportSettings,
  key: HeadingStyleKey,
  fontSize: number,
): TextboxImportSettings {
  return {...settings, structure: {...settings.structure, [key]: {...settings.structure[key], fontSize}}};
}

export function headingsAreBold(settings: TextboxImportSettings): boolean {
  const {heading1, heading2, heading3} = settings.structure;
  return heading1.bold && heading2.bold && heading3.bold;
}

export function withHeadingsBold(settings: TextboxImportSettings, bold: boolean): TextboxImportSettings {
  const {structure} = settings;
  return {
    ...settings,
    structure: {
      ...structure,
      heading1: {...structure.heading1, bold},
      heading2: {...structure.heading2, bold},
      heading3: {...structure.heading3, bold},
    },
  };
}

/** The layout values reset by "Reset to defaults" on the Layout screen. */
export function withDefaultLayout(settings: TextboxImportSettings): TextboxImportSettings {
  const d = DEFAULT_TEXTBOX_IMPORT_SETTINGS;
  return {
    ...withParagraphFontSize(settings, d.fontSize),
    marginLeft: d.marginLeft,
    marginTop: d.marginTop,
    marginRight: d.marginRight,
    marginBottom: d.marginBottom,
  };
}
