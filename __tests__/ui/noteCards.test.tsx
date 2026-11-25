// The tag's cards with Comment · Image (technical-design-comments-images.md §3.4): "No mark found"
// keeps the new text as a note; "Not a clear mark" keeps the waiting text, never the strokes just
// selected; and the "Comment or Image" card itself.
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import PenEditOutcomeScreen from '../../src/screens/penEdit/PenEditOutcomeScreen';
import NoteKindCard from '../../src/screens/penEdit/NoteKindCard';

const mockConvert = jest.fn(async () => undefined);
jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: () => undefined}));
jest.mock('../../src/actions/sidemarkConvert', () => ({convertSidemark: (...args: unknown[]) => mockConvert(...(args as []))}));
jest.mock('../../src/actions/penEditReview', () => ({
  loadPenEditStrokePoints: async () => [[0, 0, 10, 10]],
  startSelectMark: async () => undefined,
  stopSelectMark: async () => undefined,
}));

function labels(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAll(node => node.type === Text).map(node => String(node.props.children));
}

async function press(tree: renderer.ReactTestRenderer, label: string): Promise<void> {
  const text = tree.root.findAll(node => node.type === Text && String(node.props.children) === label)[0];
  let node: ReactTestInstance | null = text;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  await act(async () => {
    node?.props.onPress();
  });
}

async function render(element: React.ReactElement): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(element);
  });
  return tree;
}

beforeEach(() => mockConvert.mockClear());

describe('the tag cards offer Comment · Image', () => {
  it('"No mark found": Select mark now · Comment · Image · Later; Comment keeps the new text as a comment', async () => {
    const onClose = jest.fn();
    const tree = await render(<PenEditOutcomeScreen outcome={{kind: 'noMark', id: 'pe-new'}} onClose={onClose} />);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Select mark now', 'Comment', 'Image', 'Later']));
    expect(labels(tree)).toContain('Comment and Image belong to the paragraph beside them.');
    await press(tree, 'Comment');
    expect(mockConvert).toHaveBeenCalledWith('pe-new', 'comment');
    expect(onClose).toHaveBeenCalled();
  });

  it('"Not a clear mark": Image keeps the waiting text (its id), not the strokes just selected', async () => {
    const tree = await render(
      <PenEditOutcomeScreen outcome={{kind: 'markNotClear', id: 'pe-waiting', strokes: [[5, 5, 9, 9]], reason: 'Not a mark.'}} onClose={() => undefined} />,
    );
    expect(labels(tree)).toEqual(expect.arrayContaining(['Try again', 'Cancel', 'Or keep the waiting text as:', 'Comment', 'Image']));
    await press(tree, 'Image');
    expect(mockConvert).toHaveBeenCalledWith('pe-waiting', 'image');
  });

  it('"Comment or Image": Comment · Image · Cancel; a choice writes, Cancel does not', async () => {
    const onChoose = jest.fn(async () => null);
    const onCancel = jest.fn();
    const onDone = jest.fn();
    const tree = await render(<NoteKindCard onChoose={onChoose} onCancel={onCancel} onDone={onDone} onFailed={() => undefined} />);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Comment', 'Image', 'Cancel']));
    await press(tree, 'Image');
    expect(onChoose).toHaveBeenCalledWith('image');
    expect(onDone).toHaveBeenCalled();
    const second = await render(<NoteKindCard onChoose={onChoose} onCancel={onCancel} onDone={onDone} onFailed={() => undefined} />);
    await press(second, 'Cancel');
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
