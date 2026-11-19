#!/usr/bin/env node
// Tests for the pure parts of the mark pictures (scripts/lib/markSpec.mjs, scripts/lib/pngGray.mjs)
// and for the spec itself. Plain node:assert, run by npm run check.
import assert from 'node:assert/strict';
import {MARKS} from '../docs/user/marks/marks.mjs';
import {entryHash, manifestProblems, specProblems} from './lib/markSpec.mjs';
import {decodePng, encodeGrayPng, toGrayPng} from './lib/pngGray.mjs';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

const entry = {id: 'delete', before: ['the big old red car'], marks: [{type: 'strike', from: 2, to: 2}], after: ['the big red car']};

test('the spec in docs/user/marks/marks.mjs has no problems', () => {
  assert.deepEqual(specProblems(MARKS), []);
});

test('specProblems: unknown mark type, missing field, word out of range, double id', () => {
  const problems = specProblems([
    entry,
    {...entry, marks: [{type: 'blob'}]},
    {...entry, id: 'b', marks: [{type: 'strike', from: 1}]},
    {...entry, id: 'c', marks: [{type: 'strike', from: 0, to: 9}]},
  ]);
  assert.ok(problems.some(p => p.includes('used twice')));
  assert.ok(problems.some(p => p.includes('unknown mark type "blob"')));
  assert.ok(problems.some(p => p.includes('strike needs "to"')));
  assert.ok(problems.some(p => p.includes('to 9 is not a word')));
});

test('specProblems: before and after need lines, ids are lower-case', () => {
  const problems = specProblems([{id: 'Bad Id', before: [], after: [], marks: []}]);
  assert.equal(problems.length, 3);
});

test('entryHash changes with the entry and with the drawing code', () => {
  const base = entryHash(entry, 'code');
  assert.equal(base, entryHash({...entry}, 'code'));
  assert.notEqual(base, entryHash({...entry, after: ['the red car']}, 'code'));
  assert.notEqual(base, entryHash(entry, 'other code'));
});

test('entryHash: CRLF and LF drawing code hash the same', () => {
  assert.equal(entryHash(entry, 'a\r\nb\r\n'), entryHash(entry, 'a\nb\n'));
});

test('manifestProblems: up to date is quiet', () => {
  const manifest = {delete: {hash: entryHash(entry, 'code')}};
  assert.deepEqual(manifestProblems([entry], 'code', manifest, ['delete.png', 'delete-icon.png']), []);
});

test('manifestProblems: missing icon, stale hash, orphaned file and manifest entry', () => {
  const manifest = {delete: {hash: 'old'}, gone: {hash: 'x'}};
  const problems = manifestProblems([entry], 'code', manifest, ['delete.png', 'gone.png']);
  assert.ok(problems.some(p => p.startsWith('delete-icon.png is missing')));
  assert.ok(problems.some(p => p.includes('"delete" is out of date')));
  assert.ok(problems.some(p => p.startsWith('gone.png belongs to no entry')));
  assert.ok(problems.some(p => p.includes('lists "gone"')));
});

test('pngGray: a grey image survives encode and decode, and toGrayPng keeps it', () => {
  const gray = Buffer.from([0, 128, 255, 64, 32, 200]);
  const png = encodeGrayPng(3, 2, gray);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  const again = decodePng(toGrayPng(png));
  assert.equal(again.width, 3);
  assert.equal(again.height, 2);
});

if (failed > 0) {
  console.error(`test-marks: ${failed} failed`);
  process.exit(1);
}
console.log('test-marks: all passed');
