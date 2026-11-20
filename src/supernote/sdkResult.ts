/**
 * Turning sn-plugin-lib's `{success, result, error}` answers into results or errors, and a
 * timeout for host calls that can hang. The SDK calls themselves stay with their callers.
 */

export function assertApiSuccess<T>(
  response: { success?: boolean; result?: T; error?: { message?: string } } | null | undefined,
  fallback: string,
): T {
  if (response?.success) {return response.result as T;}
  throw new Error(response?.error?.message || fallback);
}

export function assertBooleanSuccess(
  response: { success?: boolean; result?: boolean; error?: { message?: string } } | null | undefined,
  fallback: string,
): void {
  if (!response?.success || response.result !== true) {
    throw new Error(response?.error?.message || fallback);
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    promise
      .then(r => {
        clearTimeout(timer);
        resolve(r);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export function tryApiResult<T>(result: any): T | null {
  if (!result?.success) {
    return null;
  }

  return (result.result as T) ?? null;
}

/** An sn-plugin-lib answer as the plugin reads it; every field may be missing. */
export type SdkResponse<T> =
  | {success?: boolean; result?: T; error?: {code?: number; message?: string}}
  | null
  | undefined;

/** A failed answer's error as one short text ("105: busy"), or `fallback` when it has none. */
export function sdkErrorText(response: SdkResponse<unknown>, fallback: string): string {
  return response?.error ? `${response.error.code ?? ''}: ${response.error.message ?? ''}` : fallback;
}
