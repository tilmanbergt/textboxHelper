/**
 * The page shapes the pure logic works with. Each type is a structural subset of the matching
 * sn-plugin-lib type, so SDK values pass into domain functions without conversion, while domain/
 * itself never imports the SDK. `src/supernote/domainTypeChecks.ts` makes the type check fail if
 * the two drift apart.
 */

/** A rectangle in page pixels (sn-plugin-lib `Rect`). */
export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** A point in page pixels (sn-plugin-lib `Point`). */
export type Point = {
  x: number;
  y: number;
};

/** The text box of a page element (sn-plugin-lib `TextBox`). */
export type TextboxData = {
  fontSize: number;
  fontPath: string | null;
  textContentFull: string | null;
  textRect: Rect;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

/** Position and size of a title or link on the page (sn-plugin-lib `Title`, `Link`). */
export type FrameData = {
  X: number;
  Y: number;
  width: number;
  height: number;
};

/** The parts of a page element (sn-plugin-lib `Element`) the pure logic reads. */
export type PageElementData = {
  uuid: string;
  type: number;
  layerNum: number;
  numInPage: number;
  textBox: TextboxData | null;
  title: FrameData | null;
  link: FrameData | null;
  picture: {rect: Rect} | null;
  geometry: {type: string; points: Point[]} | null;
  /** Free text a plugin can attach; the plugin marks its own page elements with it. */
  userData?: string | null;
};

/** A page element known to carry a text box. */
export type TextElementData = PageElementData & {textBox: TextboxData};

/** Element type of a normal textbox. */
export const TEXT_TYPE_NORMAL = 500;
/** Element type of a handwritten stroke (sn-plugin-lib `Element.TYPE_STROKE`). */
export const ELEMENT_TYPE_STROKE = 0;
/** Element type of a geometry such as a straight line (sn-plugin-lib `Element.TYPE_GEO`). */
export const ELEMENT_TYPE_GEO = 700;
/** A NOTE heading (title) over a textbox (host facts §3). */
export const ELEMENT_TYPE_TITLE = 100;
/** The main layer; textbox tools only touch elements on it. */
export const MAIN_LAYER = 0;
/** Font size assumed when a textbox doesn't name one. */
export const DEFAULT_FONT_SIZE = 32;
