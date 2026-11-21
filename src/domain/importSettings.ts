/**
 * Settings of the text import: the chosen file, layout, paragraph separator, the styles of
 * paragraphs and headings, insert mode, whether the import is linked to its file, and their
 * defaults. The styles are also what the Outline's level changes and Clean up layout give a block;
 * the margins are the page layout's (`domain/pageLayout.ts`).
 *
 * A text file can come from any folder on the device (technical-design-source-link.md §3). It is
 * chosen with the Supernote file selector, which opens in the folder of the last file, else INBOX;
 * `filePath` is the absolute path. An empty `filePath` means no file is chosen yet.
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
  /** Absolute path of the text file; '' = no file chosen. */
  filePath: string;
  /**
   * In the Paragraph boxes layout: link the textboxes to the file, so changes can be written back
   * (technical-design-source-link.md §3).
   */
  linkToFile: boolean;
  /**
   * The NOTE title style over a linked file's name (technical-design-linked-files.md §1.5):
   * 1 black, 2 light grey, 3 dark grey, 4 shadow.
   */
  fileTitleStyle: number;
  fontSize: number;
  structure: TextboxImportStructureSettings;
  insertMode: TextboxImportInsertMode;
};

export const DEFAULT_TEXTBOX_IMPORT_SETTINGS: TextboxImportSettings = {
  filePath: '',
  linkToFile: true,
  fileTitleStyle: 1,
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
  insertMode: 'auto',
};

export const IMPORT_FOLDER = '/storage/emulated/0/INBOX';

export function resolveTextboxImportPath(settings: TextboxImportSettings): string {
  const path = settings.filePath.trim();
  if (!path) {
    throw new Error('Choose a text file first.');
  }
  return path;
}

/** Whether the import is linked to its file: only paragraph boxes map back to the file's blocks. */
export function isLinkedImport(settings: TextboxImportSettings): boolean {
  return settings.linkToFile && settings.structure.layoutMode === 'paragraphTextboxes';
}

/**
 * A path the file selector returned, cleaned up, or null when it is not a .txt file (the selector
 * is limited to .txt, this checks it anyway).
 */
export function chosenTextFilePath(path: string): string | null {
  const clean = path.trim().replace(/\/{2,}/g, '/');
  if (!clean.startsWith('/') || clean.split('/').includes('..') || !/[^/]\.txt$/i.test(clean)) {
    return null;
  }
  return clean;
}

/** The folder the file selector opens in: the last file's folder, else INBOX. */
export function importStartFolder(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  return slash > 0 ? filePath.slice(0, slash) : IMPORT_FOLDER;
}

/** The import setting's path from an older settings file, where it was relative to INBOX. */
export function pathFromInboxRelative(filename: string): string {
  const relative = filename.trim().replace(/^\/+/, '');
  return relative ? `${IMPORT_FOLDER}/${relative}` : '';
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

/** The styles reset by "Reset to defaults" in Settings → Layout. */
export function withDefaultStyles(settings: TextboxImportSettings): TextboxImportSettings {
  const d = DEFAULT_TEXTBOX_IMPORT_SETTINGS;
  const reset = withParagraphFontSize(settings, d.fontSize);
  return {
    ...reset,
    structure: {
      ...reset.structure,
      paragraph: d.structure.paragraph,
      heading1: d.structure.heading1,
      heading2: d.structure.heading2,
      heading3: d.structure.heading3,
    },
  };
}
