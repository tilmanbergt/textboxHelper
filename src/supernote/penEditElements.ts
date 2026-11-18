import {PluginCommAPI, PluginNoteAPI, TextBox, type Element} from 'sn-plugin-lib';
import {
  PEN_EDIT_NUMBER_FONT_SIZE,
  penEditUserData,
  tagIconPolygon,
  type PenEditKind,
  type PenEditRole,
} from '../domain/penEditTags';
import {ELEMENT_TYPE_GEO, MAIN_LAYER, TEXT_TYPE_NORMAL, type Rect} from '../domain/textboxModel';

/**
 * The page elements a pen-edit tag adds (technical-design-pen-edits.md §3.2): the tag icon (a
 * geometry polygon) and the small number textboxes, all carrying `userData`. The rules follow
 * Kept GTD's supernote/markIcons.ts: `insertPageElements` (insertGeometry can't carry userData),
 * one retry after error 105, then save the note (unsaved inserts were lost when the note closed).
 * Never throws.
 */

const ICON_PEN = {penColor: 0x00, penType: 10, penWidth: 200};
const BUSY_ERROR = '105';
const RETRY_DELAY_MS = 500;

export type TagNumber = {role: Extract<PenEditRole, 'marknum' | 'snippetnum'>; rect: Rect; number: number};

export type TagElementsRequest = {
  page: number;
  id: string;
  kind: PenEditKind;
  iconRect: Rect;
  numbers: TagNumber[];
};

export type TagElementsResult = {
  placed: boolean;
  retried: boolean;
  saved: boolean;
  error: string | null;
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

async function buildElements(request: TagElementsRequest): Promise<Element[]> {
  const built: Element[] = [];
  try {
    const icon = await create(ELEMENT_TYPE_GEO);
    built.push(icon);
    icon.pageNum = request.page;
    icon.layerNum = MAIN_LAYER;
    icon.userData = penEditUserData(request.id, 'snippet');
    icon.geometry = {
      ...(icon.geometry ?? {}),
      ...ICON_PEN,
      type: 'GEO_polygon',
      points: tagIconPolygon(request.kind, request.iconRect),
    } as Element['geometry'];

    for (const number of request.numbers) {
      const element = await create(TEXT_TYPE_NORMAL);
      built.push(element);
      element.pageNum = request.page;
      element.layerNum = MAIN_LAYER;
      element.userData = penEditUserData(request.id, number.role);
      const textBox = element.textBox ?? new TextBox();
      textBox.fontSize = PEN_EDIT_NUMBER_FONT_SIZE;
      textBox.fontPath = null;
      textBox.textContentFull = String(number.number);
      textBox.textRect = number.rect;
      textBox.textAlign = 0;
      textBox.textBold = 0;
      textBox.textItalics = 0;
      textBox.textFrameWidthType = 0;
      textBox.textFrameStyle = 0;
      textBox.textEditable = 0;
      textBox.textDigestData = null;
      element.textBox = textBox;
    }
  } catch (error) {
    recycle(built);
    throw error;
  }
  return built;
}

async function insertOnce(request: TagElementsRequest): Promise<string | null> {
  const elements = await buildElements(request);
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

/** Puts the tag icon and the numbers onto `page` of the open note, then saves it. */
export async function insertTagElements(request: TagElementsRequest): Promise<TagElementsResult> {
  let retried = false;
  let error: string | null = null;
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
  const saved = placed ? await saveCurrentNote() : false;
  if (placed) {
    console.log('[PenEditElements] placed', JSON.stringify({id: request.id, page: request.page, numbers: request.numbers.length, retried, saved}));
  } else {
    console.warn('[PenEditElements] not placed', JSON.stringify({id: request.id, error}));
  }
  return {placed, retried, saved, error};
}
