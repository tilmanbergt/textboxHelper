// Renders Import from URL (src/screens/import/UrlImportScreen.tsx) with the download flow mocked:
// the last address is filled in, a recent address can be used, edited and forgotten, Download
// hands the saved file on, a failure shows its message and Try again, Cancel aborts.
import React from 'react';
import {Text, TextInput} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';

const mockDownload = jest.fn();
const mockForget = jest.fn((url: string) => mockRecent.filter(item => item !== url));
let mockRecent = ['http://192.168.1.42:8787/current.md', 'https://example.org/draft.txt'];

jest.mock('sn-plugin-lib', () => ({}));
jest.mock('react-native-fs', () => ({}));
jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: () => undefined}));
jest.mock('../../src/supernote/fileSelector', () => ({chooseTargetFolder: () => Promise.resolve(null)}));
jest.mock('../../src/actions/urlImport', () => ({
  downloadToFile: (...args: unknown[]) => mockDownload(...args),
  forgetRecentUrl: (url: string) => mockForget(url),
  setTargetFolder: () => undefined,
  urlImportSettings: () => ({recentUrls: mockRecent, targetFolder: '/storage/emulated/0/INBOX'}),
}));

import UrlImportScreen from '../../src/screens/import/UrlImportScreen';

function textNode(tree: renderer.ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return tree.root.findAll(node => node.type === Text && String(node.props.children) === label)[0];
}

function pressable(node: ReactTestInstance | undefined | null): ReactTestInstance | null {
  let current = node ?? null;
  while (current && typeof current.props.onPress !== 'function') {
    current = current.parent;
  }
  return current;
}

function press(tree: renderer.ReactTestRenderer, label: string, index = 0): void {
  const node = tree.root.findAll(item => item.props.accessibilityLabel === label || (item.type === Text && String(item.props.children) === label))[index];
  act(() => pressable(node)?.props.onPress());
}

function field(tree: renderer.ReactTestRenderer): ReactTestInstance {
  return tree.root.findByType(TextInput);
}

function render(onDownloaded = jest.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<UrlImportScreen onBack={jest.fn()} onClose={jest.fn()} onDownloaded={onDownloaded} />);
  });
  return tree;
}

describe('Import from URL', () => {
  beforeEach(() => {
    mockDownload.mockReset();
    mockRecent = ['http://192.168.1.42:8787/current.md', 'https://example.org/draft.txt'];
  });

  it('fills in the last address and lists the recent ones', () => {
    const tree = render();
    expect(field(tree).props.value).toBe('http://192.168.1.42:8787/current.md');
    expect(textNode(tree, '192.168.1.42:8787/current.md')).toBeDefined();
    expect(textNode(tree, 'example.org/draft.txt')).toBeDefined();
    expect(textNode(tree, 'INBOX')).toBeDefined();
  });

  it('uses, edits and forgets a recent address', () => {
    const tree = render();
    press(tree, 'Use https://example.org/draft.txt');
    expect(field(tree).props.value).toBe('https://example.org/draft.txt');
    act(() => field(tree).props.onChangeText('http://192.168.1.42:8787/current.md'));
    press(tree, 'Edit https://example.org/draft.txt');
    expect(field(tree).props.value).toBe('https://example.org/draft.txt');
    press(tree, 'Forget https://example.org/draft.txt');
    expect(mockForget).toHaveBeenCalledWith('https://example.org/draft.txt');
    expect(textNode(tree, 'example.org/draft.txt')).toBeUndefined();
  });

  it('hands the saved file on after a download', async () => {
    const file = {path: '/storage/emulated/0/INBOX/Walk.txt', name: 'Walk.txt', host: 'h', savedIn: 'target', bytes: 10, at: new Date()};
    mockDownload.mockResolvedValue({ok: true, file});
    const onDownloaded = jest.fn();
    const tree = render(onDownloaded);
    await act(async () => pressable(textNode(tree, 'Download'))?.props.onPress());
    expect(mockDownload.mock.calls[0][0]).toBe('http://192.168.1.42:8787/current.md');
    expect(mockDownload.mock.calls[0][1]).toBe('/storage/emulated/0/INBOX');
    expect(onDownloaded).toHaveBeenCalledWith(file);
  });

  it('shows a failure and offers Try again', async () => {
    mockDownload.mockResolvedValue({ok: false, message: '404 · No session is shared right now.'});
    const tree = render();
    await act(async () => pressable(textNode(tree, 'Download'))?.props.onPress());
    expect(JSON.stringify(tree.toJSON())).toContain('404 · No session is shared right now.');
    expect(textNode(tree, 'Try again')).toBeDefined();
  });

  it('refuses an address it cannot use without downloading', () => {
    const tree = render();
    act(() => field(tree).props.onChangeText('ftp://example.org/a.txt'));
    act(() => pressable(textNode(tree, 'Download'))?.props.onPress());
    expect(mockDownload).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Only http:// and https://');
  });

  it('turns Download into Cancel while it runs, and Cancel aborts', async () => {
    let signal: AbortSignal | undefined;
    mockDownload.mockImplementation((_url: string, _folder: string, given: AbortSignal) => {
      signal = given;
      return new Promise(resolve => given.addEventListener('abort', () => resolve({ok: false, message: 'Download cancelled. Nothing was saved.'})));
    });
    const tree = render();
    act(() => pressable(textNode(tree, 'Download'))?.props.onPress());
    expect(textNode(tree, 'Cancel')).toBeDefined();
    await act(async () => pressable(textNode(tree, 'Cancel'))?.props.onPress());
    expect(signal?.aborted).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('Download cancelled.');
  });
});
