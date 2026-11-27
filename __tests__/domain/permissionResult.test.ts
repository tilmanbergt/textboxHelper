import {isPermissionGranted} from '../../src/domain/permissionResult';

describe('permission answers', () => {
  it('counts "allow this time only" and "always allow" as granted', () => {
    expect(isPermissionGranted(1)).toBe(true);
    expect(isPermissionGranted(2)).toBe(true);
  });

  it('counts "don\'t allow" and a dialog closed without a choice as not granted', () => {
    expect(isPermissionGranted(0)).toBe(false);
    expect(isPermissionGranted(-1)).toBe(false);
  });

  it('counts anything unreadable as not granted', () => {
    expect(isPermissionGranted(undefined)).toBe(false);
    expect(isPermissionGranted(null)).toBe(false);
    expect(isPermissionGranted('yes')).toBe(false);
  });
});
