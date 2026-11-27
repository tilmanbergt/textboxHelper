/**
 * What the host's permission answers mean (sn-plugin-lib's `PluginManager`):
 *
 * - `hasPermission`: 0 = not granted, 1 = granted.
 * - `requestPermission`: 0 = "Don't allow", 1 = "Allow this time only", 2 = "Always allow",
 *   -1 = the dialog was closed without a choice (nothing granted; the dialog comes again next time).
 *
 * Only a positive answer is a grant. Reading "not 0" as granted lets a dismissed dialog through,
 * and the host then refuses the first file call ("File write permission has not been requested").
 * Pure.
 */
export function isPermissionGranted(answer: unknown): boolean {
  const value = Number(answer);
  return Number.isFinite(value) && value > 0;
}
