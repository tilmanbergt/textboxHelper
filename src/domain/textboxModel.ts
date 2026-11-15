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
