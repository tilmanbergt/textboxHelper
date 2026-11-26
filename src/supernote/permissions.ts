/**
 * Asks for the plugin's file permissions (read and write) before any button is wired: every screen
 * reads or writes note elements. Returns false as soon as one is declined.
 *
 * The host's permission bridge can hang without answering (Kept GTD host facts §4); a timeout like
 * Kept GTD's supernote/pluginPermissions.ts is still to come (backlog).
 */
import {PluginManager} from 'sn-plugin-lib';

const REQUIRED_PERMISSIONS: string[] = [
  'plugin.permission.FILE:READ',
  'plugin.permission.FILE:WRITE',
];

const PERMISSION_REASON = 'Manuscript reads and changes the textboxes of your notes and imports text files.';

export async function ensurePermissions(permissions: string[] = REQUIRED_PERMISSIONS): Promise<boolean> {
  for (const permission of permissions) {
    try {
      const status = await PluginManager.hasPermission(permission);
      if (status === 1) {
        continue;
      }
      const result = await PluginManager.requestPermission(permission, PERMISSION_REASON);
      if (result === 0) {
        console.warn(`[Permissions] ${permission} was declined`);
        return false;
      }
    } catch (error) {
      console.error(`[Permissions] ${permission} failed:`, error);
      return false;
    }
  }
  return true;
}
