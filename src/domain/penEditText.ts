/**
 * Recognized handwriting -> the text a pen edit puts into a textbox (technical-design-pen-edits.md
 * §3.8). The recognizer returns one line per handwritten line; those breaks follow the writing,
 * not paragraphs, so they become spaces.
 */
export function normalizeRecognizedText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  let text = '';
  for (const line of lines) {
    if (text === '') {
      text = line;
    } else if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) {
      // A word split at the line end: "replace-" + "ment" -> "replacement".
      text = text.slice(0, -1) + line;
    } else {
      text = `${text} ${line}`;
    }
  }
  return text.replace(/[ \t]+/g, ' ').trim();
}
