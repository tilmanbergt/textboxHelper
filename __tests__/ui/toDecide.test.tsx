// Renders the three sides of To decide (src/screens/manuscript/ToDecideSide.tsx,
// technical-design-mark-dialogue.md §5.3) and their actions: place open (Here with its edges),
// "?" (Select mark ›, Insert right here) and unclear (a reading, then Here; Ignore).
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import type {DecideEntry} from '../../src/domain/manuscriptPages';
import type {ToDecideItem} from '../../src/domain/marks/toDecide';
import ToDecideSide from '../../src/screens/manuscript/ToDecideSide';

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/actions/penEditReview', () => ({loadPenEditStrokePoints: async () => null}));

function press(tree: renderer.ReactTestRenderer, label: string): void {
  const text = tree.root.findAll(node => node.type === Text && String(node.props.children) === label)[0];
  let node: ReactTestInstance | null = text;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node?.props.onPress());
}

const TEXT = 'the big red car and more words here';
const base: ToDecideItem = {kind: 'unclear', key: 'k', summary: '', reason: 'why', rect: {left: 100, top: 200, right: 150, bottom: 240}, strokes: [], words: '', readings: [], guess: null};
const at = {uuid: 'tb1', numInPage: 1, lineIndex: 0, start: 4, end: 7};

function render(item: ToDecideItem) {
  const calls = {here: jest.fn(), selectMark: jest.fn(), placeHere: jest.fn(), ignore: jest.fn(), drop: jest.fn()};
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ToDecideSide
        entry={{key: `0:${item.key}`, page: 0, item} as DecideEntry}
        pageRects={[{left: 100, top: 200, right: 1100, bottom: 248}]}
        pen={null}
        insert="small"
        busy={false}
        editing={false}
        onEditing={() => undefined}
        onSaveText={() => undefined}
        onHere={calls.here}
        onSelectMark={calls.selectMark}
        onPlaceHere={calls.placeHere}
        onIgnore={calls.ignore}
        onDrop={calls.drop}
        dropConfirm={null}
      />,
    );
  });
  return {tree, calls};
}

describe('To decide sides', () => {
  it('place open: the place with ‹ ›, the result with the new text, Here takes the moved edges', () => {
    const {tree, calls} = render({...base, kind: 'placeOpen', summary: 'Replacement 3', reason: 'Two lines.', guess: at, text: TEXT, penEditId: 'pe', number: 3});
    expect(JSON.stringify(tree.toJSON())).toContain('the small red car');
    press(tree, '›');
    press(tree, 'Here');
    expect(calls.here).toHaveBeenCalledWith([1]);
  });

  it('"?": Select mark ›, Insert right here, Drop', () => {
    const {tree, calls} = render({...base, kind: 'noMark', summary: 'Text ?', penEditId: 'pe', canPlaceHere: true});
    expect(JSON.stringify(tree.toJSON())).toContain('Where it is on the page');
    press(tree, 'Select mark ›');
    press(tree, 'Insert right here');
    press(tree, 'Drop');
    expect([calls.selectMark, calls.placeHere, calls.drop].map(call => call.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('unclear: a reading offered, its place, then Here; Ignore; Remove strokes', () => {
    const draft = {range: {kind: 'delete' as const, start: 4, end: 5}, operation: {id: 'op'} as never};
    const {tree, calls} = render({
      ...base,
      summary: 'Slash',
      words: 'big',
      ignore: {rect: base.rect as NonNullable<typeof base.rect>, hash: 'a'},
      removableNums: [5],
      options: [{label: 'Slash', reason: null, at: {...at, end: 5}, text: TEXT, draft}],
    });
    expect(JSON.stringify(tree.toJSON())).toContain('Under it');
    expect(JSON.stringify(tree.toJSON())).toContain('the ig red');
    press(tree, 'Here');
    expect(calls.here).toHaveBeenCalledWith(null, 0);
    press(tree, 'Ignore');
    press(tree, 'Remove strokes');
    expect([calls.ignore, calls.drop].map(call => call.mock.calls.length)).toEqual([1, 1]);
  });
});
