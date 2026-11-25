// Plain-node checks for scripts/lib/testNotes.mjs. Run: node scripts/test-test-notes.mjs (part of npm run check).
import assert from 'node:assert/strict';
import {changelogAdded, lastReleaseTag, parseCommitMessage, renderTestNotes} from './lib/testNotes.mjs';

let n = 0;
function t(name, fn) {
  fn();
  n++;
}

t('commit message: no block', () => {
  assert.deepEqual(parseCommitMessage('Fix paging\n\nSome details.\n'), {subject: 'Fix paging', deviceTest: null, none: false});
  assert.deepEqual(parseCommitMessage('Only a subject'), {subject: 'Only a subject', deviceTest: null, none: false});
});

t('commit message: multi-line block to the end, CRLF', () => {
  const msg = 'Show the review\r\n\r\nBody text.\r\n\r\nDevice test:\r\n1. Open Manuscript.\r\n   -> Review opens.\r\n2. Tap Apply.\r\n\r\n';
  const c = parseCommitMessage(msg);
  assert.equal(c.subject, 'Show the review');
  assert.equal(c.deviceTest, '1. Open Manuscript.\n   -> Review opens.\n2. Tap Apply.');
  assert.equal(c.none, false);
});

t('commit message: trailers after the block are not part of it', () => {
  const msg =
    'Version labels\n\nBody.\n\nDevice test:\n1. Build.\n   -> Label shown.\n\n' +
    'Co-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/x\n';
  assert.equal(parseCommitMessage(msg).deviceTest, '1. Build.\n   -> Label shown.');
  // Without a block, trailers don't make one.
  assert.equal(parseCommitMessage('X\n\nBody.\n\nSigned-off-by: A <a@b>').deviceTest, null);
  // A last step that only looks like a trailer stays when it is not its own paragraph.
  assert.equal(parseCommitMessage('X\n\nDevice test:\n1. Open.\nResult: shown').deviceTest, '1. Open.\nResult: shown');
});

t('commit message: none on the same line, any case', () => {
  const c = parseCommitMessage('Docs\n\ndevice TEST: none - docs only\n\nCo-Authored-By: C <c@d>');
  assert.equal(c.deviceTest, 'none - docs only');
  assert.equal(c.none, true);
  assert.equal(parseCommitMessage('X\n\nDevice test: Open the card.\nCheck the list.').deviceTest, 'Open the card.\nCheck the list.');
});

t('commit message: "Device test:" in the subject or mid-sentence is not a block', () => {
  assert.equal(parseCommitMessage('Device test: rename\n\nbody').deviceTest, null);
  assert.equal(parseCommitMessage('X\n\nThe Device test: below is gone.').deviceTest, null);
});

t('changelog: only new lines of [Unreleased], under their section', () => {
  const before = '# C\n\n## [Unreleased]\n\n### Added\n- A\n\n## [0.1.0] - 2026-10-01\n- old\n';
  const after = '# C\n\n## [Unreleased]\n\n### Added\n- A\n- B\n\n### Fixed\n- C\n\n## [0.1.0] - 2026-10-01\n- old\n';
  assert.deepEqual(changelogAdded(before, after), [
    {section: 'Added', lines: ['- B']},
    {section: 'Fixed', lines: ['- C']},
  ]);
  assert.deepEqual(changelogAdded('', '## [Unreleased]\n- X\n'), [{section: '', lines: ['- X']}]);
  assert.deepEqual(changelogAdded(after, after), []);
});

t('last release tag: semver only, beta tags ignored', () => {
  assert.equal(lastReleaseTag(['v0.2.0', 'v0.10.0', 'v0.11.0-beta.1', 'v0.10.1', 'other', '']), 'v0.10.1');
  assert.equal(lastReleaseTag(['v0.3.0-beta.2', 'x']), null);
  assert.equal(lastReleaseTag([]), null);
});

t('render: new marks, warnings, none, changelog', () => {
  const md = renderTestNotes({
    label: '0.3.0-alpha+a1b2c3d',
    branch: 'feature/x',
    baseDesc: 'compared with main (merge base 9f8e7d6)',
    commits: [
      {sha: 'a1b2c3d4e5', subject: 'Show the review', deviceTest: '1. Open Manuscript.\n   -> Review opens.', none: false},
      {sha: 'b2c3d4e5f6', subject: 'Rename helper', deviceTest: null, none: false},
      {sha: 'c3d4e5f6a7', subject: 'Docs', deviceTest: 'none - docs only', none: true},
    ],
    newShas: new Set(['a1b2c3d4e5']),
    changelog: [{section: 'Added', lines: ['- B']}],
  });
  assert.ok(
    md.startsWith(
      '# Manuscript 0.3.0-alpha+a1b2c3d - what to test\n\nBranch feature/x · compared with main (merge base 9f8e7d6) · 3 commits, 1 new in this push\n',
    ),
  );
  assert.ok(md.includes('### NEW · a1b2c3d Show the review\n\n1. Open Manuscript.\n   -> Review opens.\n'));
  assert.ok(md.includes('### b2c3d4e Rename helper   ⚠ no Device test block\n'));
  assert.ok(md.includes('### c3d4e5f Docs\n\nDevice test: none - docs only\n'));
  assert.ok(md.includes('## User-visible changes (new in CHANGELOG [Unreleased])\n\n**Added**\n- B\n'));
  assert.ok(!/\n{3,}/.test(md));
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

t('render: nothing since the base', () => {
  const md = renderTestNotes({label: 'unbuilt', branch: 'main', baseDesc: 'compared with release v0.2.2', commits: []});
  assert.equal(md, '# Manuscript unbuilt - what to test\n\nBranch main · compared with release v0.2.2 · 0 commits\n');
});

console.log(`test-notes: ${n} groups passed`);
