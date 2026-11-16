/**
 * Reads a View's laid-out height through `onLayout` (taken from Kept GTD). Put it on a `flex: 1`
 * box inside a bounded flex column; `height` is null until the first layout pass, so there is
 * always one render before the real number is known. A height of 0 (a hidden box) is ignored, so
 * the last real height stays.
 */
import {useCallback, useState} from 'react';
import type {LayoutChangeEvent} from 'react-native';

export function useMeasuredHeight(): [(e: LayoutChangeEvent) => void, number | null] {
  const [height, setHeight] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.height;
    if (measured <= 0) {
      return;
    }
    setHeight(prev => (prev === measured ? prev : measured));
  }, []);
  return [onLayout, height];
}
