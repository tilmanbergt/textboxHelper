export type StyleRequirement = 'any' | 'yes' | 'no';

export type RoleRuleConfig = {
  minFontSize: number;
  maxFontSize: number;
  bold: StyleRequirement;
  italic: StyleRequirement;
  border: StyleRequirement;
};

export type ExportClassificationConfig = {
  heading: RoleRuleConfig;
  paragraph: RoleRuleConfig;
  comment: RoleRuleConfig;
  meta: RoleRuleConfig;
  treatTitleTextBoxesAsHeadings: boolean;
};

export type EditableRoleRuleConfig = {
  minFontSize: string;
  maxFontSize: string;
  bold: StyleRequirement;
  italic: StyleRequirement;
  border: StyleRequirement;
};

export type EditableExportClassificationConfig = {
  heading: EditableRoleRuleConfig;
  paragraph: EditableRoleRuleConfig;
  comment: EditableRoleRuleConfig;
  meta: EditableRoleRuleConfig;
  treatTitleTextBoxesAsHeadings: boolean;
};

export const DEFAULT_EXPORT_CLASSIFICATION_CONFIG: ExportClassificationConfig = {
  heading: {
    minFontSize: 40,
    maxFontSize: 40,
    bold: 'yes',
    italic: 'no',
    border: 'any',
  },
  paragraph: {
    minFontSize: 32,
    maxFontSize: 32,
    bold: 'no',
    italic: 'no',
    border: 'no',
  },
  comment: {
    minFontSize: 32,
    maxFontSize: 32,
    bold: 'any',
    italic: 'yes',
    border: 'no',
  },
  meta: {
    minFontSize: 24,
    maxFontSize: 24,
    bold: 'any',
    italic: 'any',
    border: 'any',
  },
  treatTitleTextBoxesAsHeadings: false,
};

function editableRuleFromRule(rule: RoleRuleConfig): EditableRoleRuleConfig {
  return {
    minFontSize: String(rule.minFontSize),
    maxFontSize: String(rule.maxFontSize),
    bold: rule.bold,
    italic: rule.italic,
    border: rule.border,
  };
}

export function createEditableConfig(
  config: ExportClassificationConfig = DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
): EditableExportClassificationConfig {
  return {
    heading: editableRuleFromRule(config.heading),
    paragraph: editableRuleFromRule(config.paragraph),
    comment: editableRuleFromRule(config.comment),
    meta: editableRuleFromRule(config.meta),
    treatTitleTextBoxesAsHeadings: config.treatTitleTextBoxesAsHeadings,
  };
}

function parsePositiveInteger(value: string, label: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a whole number.`);
  }

  return parsed;
}

function parseRule(
  rule: EditableRoleRuleConfig,
  label: string,
): RoleRuleConfig {
  const minFontSize = parsePositiveInteger(rule.minFontSize, `${label} min size`);
  const maxFontSize = parsePositiveInteger(rule.maxFontSize, `${label} max size`);

  if (minFontSize > maxFontSize) {
    throw new Error(`${label} min size cannot be greater than max size.`);
  }

  return {
    minFontSize,
    maxFontSize,
    bold: rule.bold,
    italic: rule.italic,
    border: rule.border,
  };
}

export function parseEditableConfig(
  config: EditableExportClassificationConfig,
): ExportClassificationConfig {
  return {
    heading: parseRule(config.heading, 'Heading'),
    paragraph: parseRule(config.paragraph, 'Paragraph'),
    comment: parseRule(config.comment, 'Comment'),
    meta: parseRule(config.meta, 'Meta'),
    treatTitleTextBoxesAsHeadings: config.treatTitleTextBoxesAsHeadings,
  };
}
