import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTextItems } from '../core/pdf.js';

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
