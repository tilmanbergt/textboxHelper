// Pure parts of the test notes every CI build carries (TESTING.md): commit messages with their
// "Device test:" block, the new CHANGELOG lines, and the Markdown. A simpler version of Kept GTD's:
// no feature areas, no scenario catalog. No I/O here, so scripts/test-test-notes.mjs can test them.
// Design: docs/dev/history/technical-design-release-scaffolding.md §4.2

import {compareVersions, isSemver, parseChangelog} from './versioning.mjs';

const BLOCK_START = /^device test:/i;
// Git trailers at the end of a message (Co-Authored-By, Claude-Session, Signed-off-by, ...).
const TRAILER = /^[A-Za-z][A-Za-z-]*: \S/;

/** The message without the trailer paragraph at its end (lines like "Co-Authored-By: ..."). */
function withoutTrailers(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  while (start > 0 && TRAILER.test(lines[start - 1].trim()) && !BLOCK_START.test(lines[start - 1].trim())) start--;
  // Only a whole trailing paragraph counts as trailers.
  if (start < end && (start === 0 || !lines[start - 1].trim())) return lines.slice(0, start);
  return lines.slice(0, end);
}

/**
 * A commit message split into its subject and its "Device test:" block: from the first line that
 * starts with "Device test:" to the end, without trailers. Text on that line after the colon
 * belongs to the block ("Device test: none - docs only"). none: the block says there is nothing
 * to test.
 */
export function parseCommitMessage(message) {
  const lines = withoutTrailers(message.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n'));
  const subject = (lines[0] ?? '').trim();
  const start = lines.findIndex((l, i) => i > 0 && BLOCK_START.test(l.trim()));
  if (start < 0) return {subject, deviceTest: null, none: false};
  const first = lines[start].trim().replace(BLOCK_START, '').trim();
  const rest = lines.slice(start + 1);
  const deviceTest = [first, ...rest].join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return {subject, deviceTest, none: /^none\b/i.test(deviceTest)};
}

/**
 * The lines CHANGELOG [Unreleased] gained, each under the "### Section" it is in:
 * [{section, lines: [...]}]. A line that was already there (anywhere in [Unreleased]) is not new.
 */
export function changelogAdded(beforeText, afterText) {
  const unreleased = text =>
    parseChangelog(text ?? '').find(r => r.version === 'Unreleased')?.markdown.split('\n') ?? [];
  const old = new Set(unreleased(beforeText).map(l => l.trim()).filter(Boolean));
  const out = [];
  let section = '';
  for (const line of unreleased(afterText)) {
    if (line.startsWith('### ')) {
      section = line.slice(4).trim();
      continue;
    }
    if (!line.trim() || old.has(line.trim())) continue;
    let group = out[out.length - 1];
    if (!group || group.section !== section) out.push((group = {section, lines: []}));
    group.lines.push(line);
  }
  return out;
}

/** The newest release tag (vX.Y.Z, never a beta tag) among `tags`, or null. */
export function lastReleaseTag(tags) {
  const versions = tags.map(t => t.trim()).filter(t => t.startsWith('v') && isSemver(t.slice(1)));
  if (!versions.length) return null;
  return versions.sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0];
}

/**
 * TESTING.md. commits: newest first, [{sha, subject, deviceTest, none}]; newShas: the commits of
 * the newest push (marked NEW); changelog: changelogAdded(). Empty sections are left out.
 */
export function renderTestNotes({label, branch, baseDesc, commits, newShas = new Set(), changelog = []}) {
  const out = [];
  const newCount = commits.filter(c => newShas.has(c.sha)).length;
  out.push(`# Manuscript ${label} - what to test`, '');
  const counts = `${commits.length} commit${commits.length === 1 ? '' : 's'}` + (newCount ? `, ${newCount} new in this push` : '');
  out.push(`Branch ${branch} · ${baseDesc} · ${counts}`, '');

  if (commits.length) {
    out.push('## Device tests (newest first)', '');
    for (const c of commits) {
      const mark = newShas.has(c.sha) ? 'NEW · ' : '';
      const warn = c.deviceTest === null ? '   ⚠ no Device test block' : '';
      if (c.none) {
        out.push(`### ${mark}${c.sha.slice(0, 7)} ${c.subject}`, '', `Device test: ${c.deviceTest}`, '');
        continue;
      }
      out.push(`### ${mark}${c.sha.slice(0, 7)} ${c.subject}${warn}`);
      if (c.deviceTest !== null) out.push('', c.deviceTest);
      out.push('');
    }
  }

  if (changelog.length) {
    out.push('## User-visible changes (new in CHANGELOG [Unreleased])', '');
    for (const g of changelog) {
      if (g.section) out.push(`**${g.section}**`);
      out.push(...g.lines, '');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
