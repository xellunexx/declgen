import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTextItems, logicalRows } from '../core/pdf.js';

const item = (str: string, x: number, y: number, w = 3.35, size = 6.7) => ({
  str,
  transform: [1, 0, 0, size, x, y],
  width: w,
});

// Regression: packing lists like PI20260311002 emit one pdf.js item per glyph
// with whitespace as separate items carrying bogus widths. Joining items with
// ' ' produced "H u n a n" and the packing parser found no rows.
test('per-glyph items merge into words; space items are word boundaries', () => {
  const items: any[] = [];
  let x = 50;
  for (const word of ['Hunan', 'Xianglu']) {
    for (const ch of word) {
      items.push(item(ch, x, 800));
      x += 3.4;
    }
    items.push(item(' ', x, 800, 150)); // bogus width, seen in the wild
    x += 4;
  }
  const chunks = mergeTextItems(items);
  assert.deepEqual(
    chunks.map((c) => c.t),
    ['Hunan', 'Xianglu'],
  );
});

test('word-level items with a real gap stay separate', () => {
  const chunks = mergeTextItems([
    item('Total:', 50, 800, 20),
    item('100.00', 80, 800, 25),
  ]);
  assert.deepEqual(
    chunks.map((c) => c.t),
    ['Total:', '100.00'],
  );
});

test('different y rows produce different chunks', () => {
  const chunks = mergeTextItems([item('a', 50, 800), item('b', 50, 780)]);
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((c) => c.y),
    [800, 780],
  );
});

// Regression: invoice/packing-list cells wrap across y-lines (vertically
// centered cells put name text above AND below the data line). Without
// reassembly the LLM saw 'pcs'/'200mm' as standalone rows.
test('wrapped cell lines merge into their logical row', () => {
  const L = (y: number, cells: [number, string][]) => ({
    y,
    cells: cells.map(([x0, t]) => ({ x0, x1: x0 + t.length * 3, t })),
  });
  const lines = [
    L(810, [
      [80, 'Roller for small'],
      [150, 'steel and'],
    ]),
    L(800, [
      [50, '6'],
      [210, 'pcs'],
      [240, '1'],
      [270, '$385.0'],
      [330, '4016991090'],
    ]),
    L(790, [
      [80, 'pipes'],
      [150, 'plastic'],
    ]),
    L(785, [
      [80, 'Air Hose'],
      [150, 'DN38'],
    ]),
    L(775, [
      [50, '7'],
      [210, 'pcs'],
      [240, '2'],
      [270, '$159.0'],
      [330, '4016991090'],
    ]),
  ];
  const grid = logicalRows(lines as any);
  const [row6, row7] = grid.slice(1);
  assert.equal(
    row6.join(' | '),
    '6 | Roller for small pipes | steel and plastic | pcs | 1 | $385.0 | 4016991090',
  );
  assert.equal(
    row7.join(' | '),
    '7 | Air Hose | DN38 | pcs | 2 | $159.0 | 4016991090',
  );
});

// Packing lists emit package/pallet detail on separate y-lines with no item
// number; those rows must fold into the preceding numbered product row so the
// LLM sees one row per product with its weights.
test('unnumbered package rows fold into the previous numbered row', () => {
  const L = (y: number, cells: [number, string][]) => ({
    y,
    cells: cells.map(([x0, t]) => ({ x0, x1: x0 + t.length * 3, t })),
  });
  const lines = [
    L(800, [
      [50, '3'],
      [90, 'Roller for air hose'],
      [180, '0.8*0.5*1.2M'],
      [280, '1'],
      [300, 'PCS'],
    ]),
    L(780, [
      [340, '1'],
      [360, 'Pallet'],
      [420, '1300*1280*1500'],
      [520, '200'],
      [560, '225'],
    ]),
    L(760, [
      [50, '4'],
      [90, 'Air Hose'],
      [180, 'DN38 40m length'],
      [280, '2'],
      [300, 'PCS'],
    ]),
  ];
  const grid = logicalRows(lines as any);
  assert.equal(grid.length, 3);
  const row3 = grid[1];
  assert.ok(row3.join(' ').includes('Pallet'));
  assert.ok(row3.join(' ').includes('200'));
  const row4 = grid[2];
  assert.ok(row4.join(' ').includes('DN38 40m length'));
});
