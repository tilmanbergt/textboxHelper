/**
 * The addresses Import from URL remembers (technical-design-import-from-url.md §1): newest first,
 * each once, at most five. Pure; stored in settings.json by the settings model.
 */

export const MAX_RECENT_URLS = 5;

/** `url` moved (or added) to the front; an equal address further down goes. */
export function pushRecentUrl(list: readonly string[], url: string): string[] {
  return [url, ...list.filter(item => item !== url)].slice(0, MAX_RECENT_URLS);
}

export function removeRecentUrl(list: readonly string[], url: string): string[] {
  return list.filter(item => item !== url);
}

/** The stored list as far as it is usable: strings only, no blanks or repeats, at most five. */
export function parseRecentUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim() && !result.includes(item.trim())) {
      result.push(item.trim());
    }
  }
  return result.slice(0, MAX_RECENT_URLS);
}
