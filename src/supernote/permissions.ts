/**
 * Asks for the plugin's file permissions (read and write) before any button is wired: every screen
 * reads or writes note elements. Returns false as soon as one is not granted: declined, or the
 * dialog closed without a choice (`domain/permissionResult.ts`); App's permission screen then
 * offers to ask again.
 *
 * The host's permission bridge can hang without answering (Kept GTD host facts §4); the start-up
 * check has no timeout yet (backlog). INTERNET is asked separately, only when Import from URL
 * downloads, with Kept GTD's bounds (`ensureInternetPermission`).
 */
import {PluginManager} from 'sn-plugin-lib';
import {isPermissionGranted} from '../domain/permissionResult';
import {withTimeout} from './sdkResult';

const REQUIRED_PERMISSIONS: string[] = [
  'plugin.permission.FILE:READ',
  'plugin.permission.FILE:WRITE',
];

const PERMISSION_REASON = 'Manuscript reads and changes the textboxes of your notes and imports text files.';

export async function ensurePermissions(permissions: string[] = REQUIRED_PERMISSIONS): Promise<boolean> {
  for (const permission of permissions) {
    try {
      const status = await PluginManager.hasPermission(permission);
      if (isPermissionGranted(status)) {
        continue;
      }
      const result = await PluginManager.requestPermission(permission, PERMISSION_REASON);
      if (!isPermissionGranted(result)) {
        console.warn(`[Permissions] ${permission} was not granted (answer ${result})`);
        return false;
      }
    } catch (error) {
      console.error(`[Permissions] ${permission} failed:`, error);
      return false;
    }
  }
  return true;
}

const INTERNET = 'plugin.permission.INTERNET';
const INTERNET_REASON = 'Manuscript downloads the one address you entered. Nothing from your device is sent.';
const HAS_PERMISSION_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 120000;

/** A grant is remembered for the plugin process, so the dialog comes at most once per session. */
let internetGranted = false;
/** A request already waiting for the user is shared, never asked twice at once. */
let internetRequest: Promise<boolean> | null = null;

async function askInternet(): Promise<boolean> {
  try {
    const status = await withTimeout(
      PluginManager.hasPermission(INTERNET),
      HAS_PERMISSION_TIMEOUT_MS,
      'The permission check did not answer.',
    );
    if (isPermissionGranted(status)) {
      return true;
    }
  } catch (error) {
    // A check that hangs or fails still lets the dialog decide.
    console.warn('[Permissions] INTERNET check failed:', String(error));
  }
  try {
    const answer = await withTimeout(
      PluginManager.requestPermission(INTERNET, INTERNET_REASON),
      REQUEST_TIMEOUT_MS,
      'The permission dialog did not answer.',
    );
    if (!isPermissionGranted(answer)) {
      console.warn(`[Permissions] INTERNET was not granted (answer ${answer})`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[Permissions] INTERNET request failed:', String(error));
    return false;
  }
}

/** True when the plugin may download now; asks the user right before the first download. */
export async function ensureInternetPermission(): Promise<boolean> {
  if (internetGranted) {
    return true;
  }
  if (!internetRequest) {
    internetRequest = askInternet().finally(() => {
      internetRequest = null;
    });
  }
  internetGranted = await internetRequest;
  return internetGranted;
}
