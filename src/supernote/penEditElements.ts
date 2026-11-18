import {PluginCommAPI, PluginNoteAPI, TextBox, type Element} from 'sn-plugin-lib';
import {NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {PEN_EDIT_NUMBER_FONT_SIZE, penEditUserData, type PenEditRole} from '../domain/penEditTags';
import {ELEMENT_TYPE_GEO, MAIN_LAYER, TEXT_TYPE_NORMAL, type Point, type Rect} from '../domain/textboxModel';

/**
 * The page elements a pen-edit tag adds (technical-design-pen-edits.md §3.2): the badges (geometry
 * polygons: a circle or a diamond) and the number textboxes inside them, all carrying `userData`. The rules follow
 * Kept GTD's supernote/markIcons.ts: `insertPageElements` (insertGeometry can't carry userData),
 * one retry after error 105, then save the note (unsaved inserts were lost when the note closed).
 * Never throws.
 */

const ICON_PEN = {penColor: 0x00, penType: 10, penWidth: 200};
const BUSY_ERROR = '105';
const RETRY_DELAY_MS = 500;

export type TagNumber = {role: Extract<PenEditRole, 'marknum' | 'snippetnum'>; rect: Rect; number: number};
export type TagBadge = {role: Extract<PenEditRole, 'snippet' | 'markring'>; points: Point[]};

export type TagElementsRequest = {
  page: number;
  id: string;
  badges: TagBadge[];
  numbers: TagNumber[];
};

export type TagElementsResult = {
  placed: boolean;
  retried: boolean;
  saved: boolean;
  error: string | null;
  /** Of insertMs: creating the elements (the last attempt). */
  createMs: number;
  insertMs: number;
  saveMs: number;
};

type Response<T> = {success?: boolean; result?: T; error?: {code?: number; message?: string}} | null | undefined;

function errText(response: Response<unknown>, fallback: string): string {
  return response?.error ? `${response.error.code ?? ''}: ${response.error.message ?? ''}` : fallback;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function recycle(elements: Element[]): void {
  for (const element of elements) {
    try {
      PluginCommAPI.recycleElement(element.uuid);
    } catch {
      // silent: a failed recycle only keeps a cached element a little longer
    }
  }
}

async function create(type: number): Promise<Element> {
  const created = (await PluginCommAPI.createElement(type)) as Response<Element>;
  if (!created?.success || !created.result) {
    throw new Error('createElement: ' + errText(created, 'failed'));
  }
  return created.result;
}

/**
 * All elements of one tag, created at once: each `createElement` is a round trip to the host
 * (the host needs it for every new element, so a template can't be copied), and sent together
 * they overlap instead of queueing one after the other.
 */
async function buildElements(request: TagElementsRequest): Promise<Element[]> {
  const types = [
    ...request.badges.map(() => ELEMENT_TYPE_GEO),
    ...request.numbers.map(() => TEXT_TYPE_NORMAL),
  ];
  const results = await Promise.allSettled(types.map(type => create(type)));
  const built = results
    .filter((result): result is PromiseFulfilledResult<Element> => result.status === 'fulfilled')
    .map(result => result.value);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    recycle(built);
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }

  request.badges.forEach((badge, index) => {
    const icon = built[index];
    icon.pageNum = request.page;
    icon.layerNum = MAIN_LAYER;
    icon.userData = penEditUserData(request.id, badge.role);
    icon.geometry = {
      ...(icon.geometry ?? {}),
      ...ICON_PEN,
      type: 'GEO_polygon',
      points: badge.points,
    } as Element['geometry'];
  });

  request.numbers.forEach((number, index) => {
    const element = built[request.badges.length + index];
    element.pageNum = request.page;
    element.layerNum = MAIN_LAYER;
    element.userData = penEditUserData(request.id, number.role);
    const textBox = element.textBox ?? new TextBox();
    textBox.fontSize = PEN_EDIT_NUMBER_FONT_SIZE;
    textBox.fontPath = NOTE_SYSTEM_FONT_PATH;
    textBox.textContentFull = String(number.number);
    textBox.textRect = number.rect;
    textBox.textAlign = 0;
    textBox.textBold = 1;
    textBox.textItalics = 0;
    textBox.textFrameWidthType = 0;
    textBox.textFrameStyle = 0;
    textBox.textEditable = 0;
    textBox.textDigestData = null;
    element.textBox = textBox;
  });
  return built;
}

let lastCreateMs = 0;

async function insertOnce(request: TagElementsRequest): Promise<string | null> {
  const createStart = Date.now();
  const elements = await buildElements(request);
  lastCreateMs = Date.now() - createStart;
  try {
    const response = (await PluginCommAPI.insertPageElements(elements, request.page, null)) as Response<boolean>;
    return response?.success ? null : 'insertPageElements: ' + errText(response, 'failed');
  } finally {
    recycle(elements);
  }
}

async function saveCurrentNote(): Promise<boolean> {
  try {
    const response = (await PluginNoteAPI.saveCurrentNote()) as Response<boolean>;
    return !!response?.success && response.result !== false;
  } catch (error) {
    console.warn('[PenEditElements] saveCurrentNote threw', String(error));
    return false;
  }
}

/** Puts the badges and the numbers onto `page` of the open note, then saves it. */
export async function insertTagElements(request: TagElementsRequest): Promise<TagElementsResult> {
  let retried = false;
  let error: string | null = null;
  const insertStart = Date.now();
  lastCreateMs = 0;
  try {
    error = await insertOnce(request);
    if (error && error.includes(BUSY_ERROR)) {
      retried = true;
      await sleep(RETRY_DELAY_MS);
      error = await insertOnce(request);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const placed = error === null;
  const insertMs = Date.now() - insertStart;
  const saveStart = Date.now();
  const saved = placed ? await saveCurrentNote() : false;
  const saveMs = Date.now() - saveStart;
  if (placed) {
    console.log('[PenEditElements] placed', JSON.stringify({id: request.id, page: request.page, numbers: request.numbers.length, retried, saved}));
  } else {
    console.warn('[PenEditElements] not placed', JSON.stringify({id: request.id, error}));
  }
  return {placed, retried, saved, error, createMs: lastCreateMs, insertMs, saveMs};
}

/**
 * Writes the tag onto the user's own strokes: the snippet's handwriting and the replace mark.
 * Element uuids don't survive a read, so this `userData` is how the review finds them again.
 * Never throws; `tagged` is false when the host refused (the review then matches by place).
 */
export async function tagUserStrokes(
  page: number,
  id: string,
  strokes: Array<{element: Element; role: Extract<PenEditRole, 'stroke' | 'mark'>}>,
): Promise<{tagged: boolean; error: string | null; ms: number}> {
  const start = Date.now();
  if (strokes.length === 0) {
    return {tagged: true, error: null, ms: 0};
  }
  try {
    strokes.forEach(({element, role}) => {
      element.userData = penEditUserData(id, role);
    });
    const response = (await PluginCommAPI.modifyPageElements(
      strokes.map(item => item.element),
      page,
      null,
    )) as Response<number[]>;
    const error = response?.success ? null : 'modifyPageElements: ' + errText(response, 'failed');
    return {tagged: error === null, error, ms: Date.now() - start};
  } catch (caught) {
    return {tagged: false, error: caught instanceof Error ? caught.message : String(caught), ms: Date.now() - start};
  }
}
