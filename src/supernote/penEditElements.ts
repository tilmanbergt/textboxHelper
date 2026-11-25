import {PluginCommAPI, PluginNoteAPI, TextBox, type Element} from 'sn-plugin-lib';
import {NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {
  badgeNumberRect,
  boundsOfPoints,
  PEN_EDIT_NUMBER_FONT_SIZE,
  penEditNumberText,
  penEditUserData,
  parsePenEditUserData,
  snippetSign,
  type PenEditKind,
  type PenEditRole,
} from '../domain/penEditTags';
import {readPageElements, recycleElements} from './noteElements';
import {ELEMENT_TYPE_GEO, MAIN_LAYER, TEXT_TYPE_NORMAL, type Point, type Rect} from '../domain/textboxModel';
import {sdkErrorText, type SdkResponse} from './sdkResult';
import {recycleByUuid} from './sdkElements';

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

/** A small textbox in a sign: a number, "?" (text without a mark) or "C" (a comment). */
export type TagNumber = {role: Extract<PenEditRole, 'marknum' | 'snippetnum'>; rect: Rect; text: string};
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

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function create(type: number): Promise<Element> {
  const created = (await PluginCommAPI.createElement(type)) as SdkResponse<Element>;
  if (!created?.success || !created.result) {
    throw new Error('createElement: ' + sdkErrorText(created, 'failed'));
  }
  return created.result;
}

/**
 * All elements of one tag, created one after the other: the host needs `createElement` for every
 * new element, so a template can't be copied. Created at once they saved under 0.1 s on the
 * device, too little to risk concurrent host calls.
 */
async function buildElements(request: TagElementsRequest): Promise<Element[]> {
  const types = [
    ...request.badges.map(() => ELEMENT_TYPE_GEO),
    ...request.numbers.map(() => TEXT_TYPE_NORMAL),
  ];
  const built: Element[] = [];
  try {
    for (const type of types) {
      built.push(await create(type));
    }
  } catch (error) {
    recycleByUuid(built);
    throw error;
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
    textBox.textContentFull = number.text;
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
    const response = (await PluginCommAPI.insertPageElements(elements, request.page, null)) as SdkResponse<boolean>;
    return response?.success ? null : 'insertPageElements: ' + sdkErrorText(response, 'failed');
  } finally {
    recycleByUuid(elements);
  }
}

async function saveCurrentNote(): Promise<boolean> {
  try {
    const response = (await PluginNoteAPI.saveCurrentNote()) as SdkResponse<boolean>;
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
    )) as SdkResponse<number[]>;
    const error = response?.success ? null : 'modifyPageElements: ' + sdkErrorText(response, 'failed');
    return {tagged: error === null, error, ms: Date.now() - start};
  } catch (caught) {
    return {tagged: false, error: caught instanceof Error ? caught.message : String(caught), ms: Date.now() - start};
  }
}

/**
 * Select mark (technical-design-mark-dialogue.md §4.2): the snippet's "?" becomes its number (or
 * back to "?" when the mark couldn't be put on the page). One
 * read of the page's elements finds the snippet's number textbox by its `userData`; its text and
 * width change in place (`modifyPageElements`). Never throws; `error` says why it didn't change.
 */
export async function setSnippetNumber(
  notePath: string,
  page: number,
  id: string,
  number: number | null,
): Promise<{changed: boolean; error: string | null}> {
  let elements: Element[] = [];
  try {
    elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    const own = elements.filter(element => parsePenEditUserData(element.userData)?.id === id);
    const numberBox = own.find(element => parsePenEditUserData(element.userData)?.role === 'snippetnum');
    if (!numberBox?.textBox) {
      return {changed: false, error: 'the text\'s "?" is not on the page'};
    }
    const badge = own.find(element => parsePenEditUserData(element.userData)?.role === 'snippet');
    const badgeRect = boundsOfPoints(badge?.geometry?.points ?? []);
    numberBox.textBox.textContentFull = penEditNumberText(number);
    if (badgeRect) {
      numberBox.textBox.textRect = badgeNumberRect(badgeRect, number);
    }
    const response = (await PluginCommAPI.modifyPageElements([numberBox], page, null)) as SdkResponse<number[]>;
    const error = response?.success ? null : 'modifyPageElements: ' + sdkErrorText(response, 'failed');
    return {changed: error === null, error};
  } catch (caught) {
    return {changed: false, error: caught instanceof Error ? caught.message : String(caught)};
  } finally {
    await recycleElements(elements);
  }
}

/**
 * A sidemark changes between "?", comment and image (technical-design-comments-images.md §3.3):
 * its sign is replaced where it is now (a ring with "?", a bubble with "C", a frame). One read of
 * the page finds the old sign and its text by `userData`; they are deleted, then the new ones
 * inserted (inserting renumbers the page, so never the other way round) and the note saved. If the
 * new sign can't be inserted, the old one is put back. `fallback`: where the sign was tagged, for a
 * sign no longer found. Never throws; `error` says why nothing changed.
 */
export async function replaceSnippetSign(
  notePath: string,
  page: number,
  id: string,
  change: {from: PenEditKind; to: PenEditKind; fallback: Rect},
): Promise<{changed: boolean; error: string | null}> {
  let elements: Element[] = [];
  try {
    elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    const own = elements.filter(element => {
      const role = parsePenEditUserData(element.userData);
      return role?.id === id && (role.role === 'snippet' || role.role === 'snippetnum');
    });
    const badge = own.find(element => parsePenEditUserData(element.userData)?.role === 'snippet');
    const box = boundsOfPoints(badge?.geometry?.points ?? []) ?? change.fallback;
    const request = (kind: PenEditKind): TagElementsRequest => {
      const sign = snippetSign(kind, box, null);
      return {
        page,
        id,
        badges: [{role: 'snippet', points: sign.points}],
        numbers: sign.text !== null && sign.textRect ? [{role: 'snippetnum', rect: sign.textRect, text: sign.text}] : [],
      };
    };
    if (own.length > 0) {
      const response = (await PluginCommAPI.deletePageElements(own.map(element => element.numInPage), page, null)) as SdkResponse<boolean>;
      if (!response?.success) {
        return {changed: false, error: 'deletePageElements: ' + sdkErrorText(response, 'failed')};
      }
    }
    const placed = await insertTagElements(request(change.to));
    if (!placed.placed) {
      const back = own.length > 0 ? await insertTagElements(request(change.from)) : null;
      if (back && !back.placed) {
        console.warn('[PenEditElements] old sign not put back', JSON.stringify({id, error: back.error}));
      }
      return {changed: false, error: placed.error};
    }
    return {changed: true, error: null};
  } catch (caught) {
    return {changed: false, error: caught instanceof Error ? caught.message : String(caught)};
  } finally {
    await recycleElements(elements);
  }
}
