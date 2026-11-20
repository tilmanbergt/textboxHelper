/**
 * Paths of the JSON backups written before a textbox or edit-marker action changes a note.
 *
 * Backups live in the plugin's own private folder (`PluginManager.getPluginDirPath()`).
 * Android paths use "/" only: a backslash is an ordinary file-name character there, so a
 * "\"-joined path names a sibling folder next to the plugin's own, which the plugin host
 * refuses as another plugin's private folder.
 */

export const BACKUP_DIR_NAME = 'textbox-action-backups';

/** The backup folder inside the plugin folder. */
export function buildBackupDir(pluginDir: string): string {
  return `${pluginDir.replace(/\/+$/, '')}/${BACKUP_DIR_NAME}`;
}

/** One backup file: `<backup folder>/<name>-<ISO time with ":" and "." replaced>.json`. */
export function buildBackupPath(pluginDir: string, name: string, createdAtIso: string): string {
  const safeTimestamp = createdAtIso.replace(/[:.]/g, '-');
  return `${buildBackupDir(pluginDir)}/${name}-${safeTimestamp}.json`;
}

/** The settings file the plugin remembers its settings in (domain/settingsModel.ts). */
export const SETTINGS_FILE_NAME = 'settings.json';

export function buildSettingsPath(pluginDir: string): string {
  return `${pluginDir.replace(/\/+$/, '')}/${SETTINGS_FILE_NAME}`;
}

/** Pen edits (technical-design-pen-edits.md §3.3): one index, one folder per entry. */
export const PEN_EDIT_DIR_NAME = 'pen-edits';

export function buildPenEditDir(pluginDir: string): string {
  return `${pluginDir.replace(/\/+$/, '')}/${PEN_EDIT_DIR_NAME}`;
}

export function buildPenEditIndexPath(pluginDir: string): string {
  return `${buildPenEditDir(pluginDir)}/index.json`;
}

export function buildPenEditEntryDir(pluginDir: string, id: string): string {
  return `${buildPenEditDir(pluginDir)}/${id}`;
}

/** Where an unreadable index is kept aside: `index.broken-<ISO time with ":" and "." replaced>.json`. */
export function buildBrokenPenEditIndexPath(pluginDir: string, createdAtIso: string): string {
  return `${buildPenEditDir(pluginDir)}/index.broken-${createdAtIso.replace(/[:.]/g, '-')}.json`;
}

/** The Outline's block statuses, kept in the plugin only (technical-design-manuscript.md §5.2). */
export function buildBlockStatusPath(pluginDir: string): string {
  return `${pluginDir}/block-status.json`;
}
