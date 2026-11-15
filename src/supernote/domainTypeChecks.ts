import type {Point as SdkPoint, Rect as SdkRect} from 'sn-plugin-lib';
import type {Point, Rect} from '../domain/textboxModel';

/**
 * Compile-time checks only: every SDK value must still be assignable to the domain type that
 * stands in for it (`src/domain/textboxModel.ts`). After an sn-plugin-lib update, a type error
 * here names the shape that changed. Nothing in this file runs.
 */
export type DomainTypeChecks = [
  SdkRect extends Rect ? true : never,
  SdkPoint extends Point ? true : never,
];

export const DOMAIN_TYPES_MATCH_SDK: DomainTypeChecks = [true, true];
