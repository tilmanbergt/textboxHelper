// src/supernote/permissions.ts
import {PluginManager} from 'sn-plugin-lib';

// Pro Projekt anpassen – siehe Tabelle oben.
// noteDraft:      ['plugin.permission.FILE:READ', 'plugin.permission.FILE:WRITE', 'plugin.permission.INTERNET']
// textboxHelper:  ['plugin.permission.FILE:READ', 'plugin.permission.FILE:WRITE']
// SuperCollector: ['plugin.permission.FILE:READ', 'plugin.permission.FILE:WRITE']
const REQUIRED_PERMISSIONS: string[] = [
  'plugin.permission.FILE:READ',
  'plugin.permission.FILE:WRITE',
];

/**
 * Prüft alle benötigten Berechtigungen und fragt fehlende beim Nutzer an.
 * Gibt false zurück, sobald eine Berechtigung abgelehnt wurde.
 */
export async function ensurePermissions(
  permissions: string[] = REQUIRED_PERMISSIONS,
): Promise<boolean> {
  for (const permission of permissions) {
    try {
      const status = await PluginManager.hasPermission(permission);
      if (status === 1) {
        continue;
      }
      const result = await PluginManager.requestPermission(
        permission,
        'Wird benötigt, um Notizinhalte zu lesen/schreiben.',
      );
      if (result === 0) {
        console.warn(`[Permissions] ${permission} wurde abgelehnt`);
        return false;
      }
    } catch (error) {
      console.error(`[Permissions] Fehler bei ${permission}:`, error);
      return false;
    }
  }
  return true;
}
