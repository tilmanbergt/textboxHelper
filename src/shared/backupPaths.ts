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
