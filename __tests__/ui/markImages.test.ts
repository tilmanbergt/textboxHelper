// The bundled pictures (src/ui/generated/markImages.ts, written by scripts/gen-mark-images.mjs)
// and the help entries (src/domain/markHelp.ts) must name the same marks.
import {MARK_HELP} from '../../src/domain/markHelp';
import {MARK_IMAGES} from '../../src/ui/generated/markImages';

describe('mark help pictures', () => {
  it('every help entry has a picture and an icon', () => {
    for (const entry of MARK_HELP) {
      expect(MARK_IMAGES[entry.id]?.picture.uri).toMatch(/^data:image\/png;base64,/);
      expect(MARK_IMAGES[entry.id]?.icon.uri).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('every picture belongs to a help entry', () => {
    const ids = new Set(MARK_HELP.map(entry => entry.id));
    expect(Object.keys(MARK_IMAGES).filter(id => !ids.has(id))).toEqual([]);
  });

  it('pictures have their size', () => {
    for (const {picture, icon} of Object.values(MARK_IMAGES)) {
      expect(picture.width).toBe(960);
      expect(picture.height).toBeGreaterThan(100);
      expect(icon.width).toBeGreaterThan(50);
    }
  });
});
