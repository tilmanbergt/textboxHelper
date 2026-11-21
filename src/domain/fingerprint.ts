/**
 * A short fingerprint of a text (technical-design-source-link.md §2.3): FNV-1a 32-bit over the
 * UTF-16 code units, plus the length. Only to notice that a file changed outside the plugin since
 * it was last read or written; not for security. Pure.
 */
// FNV-1a is defined with xor and an unsigned 32-bit wrap, so the bit operators are the point here.
/* eslint-disable no-bitwise */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}
/* eslint-enable no-bitwise */
