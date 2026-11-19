/**
 * What the status line says about a caught error (DEVELOPMENT-POLICY §4). Errors thrown by this
 * plugin's own code carry a sentence for the user; anything else (an empty message, a stack, a
 * multi-line host dump) is replaced by `fallback`. The caller logs the raw error.
 */
const MAX_MESSAGE_LENGTH = 200;

export function userMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const message = error.message.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH || message.includes('\n')) {
    return fallback;
  }
  return message.replace(/^Error:\s*/, '');
}

/** The file name of a device path, for status lines ("Backup: page-3-….json"). */
export function fileNameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
