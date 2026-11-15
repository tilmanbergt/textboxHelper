/**
 * Settings and types of the text import that the pure parsing and pagination need.
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
