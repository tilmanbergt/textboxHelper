// Renders the Notes tab's rows and sides (src/screens/manuscript/NotesList.tsx, NoteSide.tsx,
// technical-design-comments-images.md §5.2): comment side (Read, Correct, ‹ ›, Done ✓, Use as
// text ›, Drop with its question) and image side (‹ ›, Place Before/After, Update image, Drop).
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import type {NoteEntry} from '../../src/domain/manuscriptPages';
import type {NoteRow} from '../../src/domain/notes/noteRows';
import NoteSide from '../../src/screens/manuscript/NoteSide';
import NotesList from '../../src/screens/manuscript/NotesList';

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: () => undefined}));
// The picture stays loading: these tests are about the side's words and actions.
jest.mock('../../src/actions/penEditReview', () => ({loadPenEditStrokePoints: () => new Promise(() => undefined)}));

const mounted: renderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => mounted.splice(0).forEach(tree => tree.unmount()));
});

function labels(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAll(node => node.type === Text).map(node => String(node.props.children));
}

function press(tree: renderer.ReactTestRenderer, label: string): void {
  const text = tree.root.findAll(node => node.type === Text && String(node.props.children) === label)[0];
  let node: ReactTestInstance | null = text;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node?.props.onPress());
}

const rect = {left: 1150, top: 500, right: 1350, bottom: 560};
function entry(kind: 'comment' | 'image', extra: Partial<NoteRow> = {}): NoteEntry {
  return {
    key: `0:note:${kind}`,
    page: 0,
    row: {
      id: `pe-${kind}`,
      kind,
      page: 0,
      rect,
      note: {},
      paragraph: {uuid: 'p2', blockId: null, by: 'nearest'},
      at: {uuid: 'p2', page: 0, number: 2, words: 'The second paragraph …', rect: {left: 100, top: 450, right: 1100, bottom: 700}},
      pictureUri: null,
      ...extra,
    },
  };
}

function side(item: NoteEntry, penText = '') {
  const calls = {
    read: jest.fn(),
    save: jest.fn(),
    step: jest.fn(),
    done: jest.fn(),
    place: jest.fn(),
    useAsText: jest.fn(),
    updateImage: jest.fn(),
    drop: jest.fn(),
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <NoteSide
        entry={item}
        pageRects={[{left: 100, top: 450, right: 1100, bottom: 700}]}
        penState={{status: penText ? 'done' : 'waiting', text: penText, correctedText: null, edges: null}}
        busy={false}
        editing={false}
        onEditing={() => undefined}
        onRead={calls.read}
        onSaveText={calls.save}
        onStep={calls.step}
        onDone={calls.done}
        onPlace={calls.place}
        onUseAsText={calls.useAsText}
        onUpdateImage={calls.updateImage}
        onDrop={calls.drop}
      />,
    );
  });
  mounted.push(tree);
  return {tree, calls};
}

describe('Notes tab', () => {
  it('comment side: Read, ‹ ›, Done ✓, Use as text ›, Drop asks first', () => {
    const {tree, calls} = side(entry('comment'));
    expect(labels(tree)).toEqual(expect.arrayContaining(['Comment · ¶ 2', 'Belongs to', 'Not read yet.', 'Read', 'Correct', 'Use as text ›']));
    expect(labels(tree)).not.toContain('Update image');
    press(tree, 'Read');
    press(tree, '‹ Paragraph above');
    press(tree, 'Paragraph below ›');
    press(tree, 'Done');
    press(tree, 'Use as text ›');
    expect(calls.read).toHaveBeenCalled();
    expect(calls.step.mock.calls).toEqual([['above'], ['below']]);
    expect(calls.done).toHaveBeenCalledWith(true);
    expect(calls.useAsText).toHaveBeenCalled();
    press(tree, 'Drop');
    expect(labels(tree)).toContain('Drop comment? The handwriting stays.');
    expect(calls.drop).not.toHaveBeenCalled();
    press(tree, 'Drop');
    expect(calls.drop).toHaveBeenCalledTimes(1);
  });

  it('a done comment toggles back', () => {
    const {tree, calls} = side(entry('comment', {note: {done: true}}), 'see note');
    expect(labels(tree)).toContain('"see note"');
    press(tree, 'Done ✓');
    expect(calls.done).toHaveBeenCalledWith(false);
  });

  it('a gone paragraph says so', () => {
    const {tree} = side(entry('comment', {paragraph: {uuid: 'p2', blockId: null, by: 'nearest', gone: true}}));
    expect(labels(tree)).toContain('Your paragraph is gone: nearest one shown.');
  });

  it('image side: Place Before/After ¶ n, the later-version line, Update image, no Read', () => {
    const {tree, calls} = side(entry('image'));
    expect(labels(tree)).toEqual(expect.arrayContaining(['Image · after ¶ 2', 'Before ¶ 2', 'After ¶ 2', 'Written to the file in a later version.', 'Update image']));
    expect(labels(tree)).not.toContain('Read');
    press(tree, 'Before ¶ 2');
    press(tree, 'Update image');
    expect(calls.place).toHaveBeenCalledWith('before');
    expect(calls.updateImage).toHaveBeenCalled();
  });

  it.each([
    ['a done comment: its text, "done"', entry('comment', {note: {done: true}}), ['Comment · ¶ 2', '"check"', 'done']],
    ['an image', entry('image'), ['Image · after ¶ 2', 'image']],
  ] as const)('row: %s', (_name, item, expected) => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <NotesList
          entries={[item]}
          selectedKey={null}
          onSelect={() => undefined}
          penStates={{'pe-comment': {status: 'done', text: 'check', correctedText: null, edges: null}}}
          severalPages={false}
          resetKey="k"
        />,
      );
    });
    mounted.push(tree);
    expect(labels(tree)).toEqual(expect.arrayContaining([...expected]));
  });
});
