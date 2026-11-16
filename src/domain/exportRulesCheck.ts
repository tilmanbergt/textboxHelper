/**
 * Checks the export rules edited on the Rules screen: a class whose min size is above its max
 * size matches nothing, so the screen keeps scanning with the last valid rules and says which
 * class is wrong.
 */
import type {ExportClassificationConfig} from './exportConfig';

const CLASS_NAMES = {heading: 'Heading', paragraph: 'Paragraph', comment: 'Comment', meta: 'Meta'} as const;

export function exportRulesProblem(rules: ExportClassificationConfig): string | null {
  for (const key of Object.keys(CLASS_NAMES) as Array<keyof typeof CLASS_NAMES>) {
    if (rules[key].minFontSize > rules[key].maxFontSize) {
      return `${CLASS_NAMES[key]}: the min size is above the max size.`;
    }
  }
  return null;
}

/** The note file's name without folder and extension, for the screen header. */
export function noteNameOf(path: string): string {
  const name = path.split('/').slice(-1)[0] || path;
  return name.replace(/\.note$/i, '');
}
