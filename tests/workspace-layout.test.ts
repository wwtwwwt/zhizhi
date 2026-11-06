import { expect, test } from 'vitest';
import { clampDialogSize, layoutSideItems, resizeCentered } from '../shared/workspace-layout';

test('resizing all corners moves opposite edges symmetrically and respects limits', () => {
  const viewport = { width: 1440, height: 900 }, initial = { width: 800, height: 500 };
  expect(resizeCentered(initial, 40, 25, 'se', viewport)).toEqual({ width: 880, height: 550 });
  expect(resizeCentered(initial, -40, -25, 'nw', viewport)).toEqual({ width: 880, height: 550 });
  expect(resizeCentered(initial, 40, -25, 'ne', viewport)).toEqual({ width: 880, height: 550 });
  expect(resizeCentered(initial, -40, 25, 'sw', viewport)).toEqual({ width: 880, height: 550 });
  expect(resizeCentered(initial, -1000, -1000, 'se', viewport)).toEqual({ width: 520, height: 220 });
  expect(resizeCentered(initial, 1000, 1000, 'se', viewport)).toEqual({ width: 1416, height: 865 });
  expect(clampDialogSize(initial, { width: 400, height: 500 })).toEqual({ width: 376, height: 465 });
});

test('side annotations align to blocks and resolve collisions independently of paragraph spacing', () => {
  const input = [{ id: 'a', top: 0, blockHeight: 24, height: 70 }, { id: 'b', top: 32, blockHeight: 24, height: 46 }, { id: 'c', top: 200, blockHeight: 100, height: 24 }];
  expect(layoutSideItems(input)).toEqual([{ id: 'a', top: 0, height: 70 }, { id: 'b', top: 76, height: 46 }, { id: 'c', top: 200, height: 100 }]);
  expect(input.map(i => i.top)).toEqual([0, 32, 200]); expect(layoutSideItems([])).toEqual([]);
});
