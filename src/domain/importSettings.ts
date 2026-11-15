/**
 * Settings of the text import: layout, paragraph separator, heading styles, source folder, insert
 * mode, their defaults, and where the text file is read from.
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

export type TextboxImportSourceFolder = 'inbox' | 'myStyle';

export type TextboxImportInsertMode =
  | 'auto'
  | 'currentPage'
  | 'afterCurrentPage';

export type TextboxImportSettings = {
  sourceFolder: TextboxImportSourceFolder;
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
  sourceFolder: 'inbox',
  filename: 'import.txt',
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

export function resolveTextboxImportFolder(
  sourceFolder: TextboxImportSourceFolder,
): string {
  if (sourceFolder === 'inbox') {
    return '/storage/emulated/0/Inbox';
  }

  return '/storage/emulated/0/MyStyle/TextboxHelper/inbox';
}

export function resolveTextboxImportPath(
  settings: TextboxImportSettings,
): string {
  const safeFilename = settings.filename.trim();

  if (!safeFilename) {
    throw new Error('Enter a filename before previewing.');
  }

  return `${resolveTextboxImportFolder(settings.sourceFolder)}/${safeFilename}`;
}
