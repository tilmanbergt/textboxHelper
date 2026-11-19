// The pure parts of scripts/marks.mjs (technical-design-mark-help.md §2): checking the spec in
// docs/user/marks/marks.mjs, a hash per entry so only changed pictures are drawn again, and the
// problems `npm run marks -- --check` reports. No file access; tested by scripts/test-marks.mjs.

import {createHash} from 'node:crypto';

const MARK_FIELDS = {
  strike: ['from', 'to'],
  loop: [],
  verticals: ['from', 'to'],
  caret: ['dir', 'at'],
  sideways: ['dir', 'after'],
  step: ['gap'],
  swap: ['a', 'b'],
  write: ['text'],
};

/** What is wrong with the spec, as sentences; empty when it is fine. */
export function specProblems(entries) {
  const problems = [];
  const ids = new Set();
  for (const entry of entries) {
    const where = `marks.mjs "${entry.id ?? '?'}"`;
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id ?? '')) problems.push(`${where}: id must be lower-case letters, digits and "-".`);
    if (ids.has(entry.id)) problems.push(`${where}: the id is used twice.`);
    ids.add(entry.id);
    if (!Array.isArray(entry.before) || entry.before.length === 0) problems.push(`${where}: "before" needs at least one line.`);
    if (!Array.isArray(entry.after) || entry.after.length === 0) problems.push(`${where}: "after" needs at least one line.`);
    for (const mark of entry.marks ?? []) {
      const fields = MARK_FIELDS[mark.type];
      if (!fields) {
        problems.push(`${where}: unknown mark type "${mark.type}".`);
        continue;
      }
      for (const field of fields) {
        if (mark[field] === undefined) problems.push(`${where}: ${mark.type} needs "${field}".`);
      }
      const line = entry.before?.[mark.line ?? 0];
      const words = line === undefined ? 0 : line.split(' ').filter(Boolean).length;
      for (const field of ['from', 'to', 'gap']) {
        if (typeof mark[field] === 'number' && (mark[field] < 0 || mark[field] >= words)) {
          problems.push(`${where}: ${mark.type} ${field} ${mark[field]} is not a word of line ${mark.line ?? 0}.`);
        }
      }
    }
  }
  return problems;
}

/**
 * The hash of one picture's inputs: its spec entry and the drawing code. Line endings are made
 * equal first, so a Windows checkout (CRLF) gives the same hash as the committed files.
 */
export function entryHash(entry, drawingSource) {
  const source = drawingSource.replace(/\r\n/g, '\n');
  return createHash('sha256').update(JSON.stringify(entry)).update('\n').update(source).digest('hex').slice(0, 16);
}

/**
 * Problems of the committed pictures against the spec: a picture missing or drawn from an older
 * spec or drawing code, a picture no entry wants any more. `manifest` maps id → {hash};
 * `files` lists the PNG file names in docs/user/images/marks.
 */
export function manifestProblems(entries, drawingSource, manifest, files) {
  const problems = [];
  const wanted = new Set();
  for (const entry of entries) {
    for (const name of [`${entry.id}.png`, `${entry.id}-icon.png`]) {
      wanted.add(name);
      if (!files.includes(name)) problems.push(`${name} is missing: run npm run marks.`);
    }
    const known = manifest[entry.id];
    if (!known) problems.push(`"${entry.id}" is not in manifest.json: run npm run marks.`);
    else if (known.hash !== entryHash(entry, drawingSource)) problems.push(`"${entry.id}" is out of date: run npm run marks.`);
  }
  for (const name of files) {
    if (name.endsWith('.png') && !wanted.has(name)) problems.push(`${name} belongs to no entry in marks.mjs: delete it.`);
  }
  for (const id of Object.keys(manifest)) {
    if (!entries.some(entry => entry.id === id)) problems.push(`manifest.json lists "${id}", which marks.mjs no longer has: run npm run marks.`);
  }
  return problems;
}
