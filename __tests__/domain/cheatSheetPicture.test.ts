// The cheat sheet goes onto the page as a picture (technical-design-release-readiness.md §6.2): a
// picture is never read as an edit mark, only strokes and straight lines on the main layer are.
import {isSupportedEditMarkerElement} from '../../src/domain/markerStrokes';
import {ELEMENT_TYPE_STROKE, MAIN_LAYER, type PageElementData} from '../../src/domain/textboxModel';

const TYPE_PICTURE = 200;

describe('cheat sheet picture', () => {
  it('a picture element is not an edit mark; a stroke is', () => {
    const picture = {type: TYPE_PICTURE, layerNum: MAIN_LAYER, uuid: 'p', numInPage: 1} as unknown as PageElementData;
    const stroke = {type: ELEMENT_TYPE_STROKE, layerNum: MAIN_LAYER, uuid: 's', numInPage: 2} as unknown as PageElementData;
    expect(isSupportedEditMarkerElement(picture)).toBe(false);
    expect(isSupportedEditMarkerElement(stroke)).toBe(true);
  });
});
