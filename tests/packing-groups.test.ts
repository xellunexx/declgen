import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMasses } from '../core/packing.js';

const invLine = (no: number, description: string, qty = 1) => ({
  no,
  description,
  qty,
});
const plLine = (no: number, description: string, qty: number, net?: number) => ({
  no,
  description,
  qty,
  net_kg: net ?? null,
});
const invoice = (lines: any[]) => ({ lines });
const packing = (lines: any[], extra: any = {}) => ({
  total_net_weight_kg: 100,
  total_gross_weight_kg: 120,
  lines,
  ...extra,
});

test('merged crate weight is distributed across product rows by quantity', () => {
  const inv = invoice([
    invLine(1, 'Adapter drill pipe 89mm to API 3 1/2 REG', 2),
    invLine(2, 'Drill pipe 89mm to API 4 1/2 REG 8 inch Hammer', 2),
    invLine(3, 'Drill pipe 89mm to API 2 3/8 REG 5 inch Hammer', 2),
  ]);
  const pl = packing([
    plLine(1, 'Adapter Drill pipe 89 to API 3 1/2 REG', 2, 97),
    plLine(2, 'Drill pipe 89 to API 4 1/2 REG', 2),
    plLine(3, 'Drill pipe 89 to API 2 3/8 REG', 2),
  ]);
  const [patch, warns] = extractMasses(inv, pl);
  const m = patch.line_masses as Record<string, number>;
  assert.ok(m['1'] > 0 && m['2'] > 0 && m['3'] > 0);
  assert.ok(Math.abs(m['1'] + m['2'] + m['3'] - 97) < 1e-6);
  assert.equal(warns.some((w: string) => w.includes('нямат нето тегло')), false);
});

test('one invoice line billed once but packed as several bundles accumulates', () => {
  const inv = invoice([
    invLine(1, 'Dept Detector 200m, simple version'),
    invLine(2, 'Drill rod 89*4500*6.5, double slots', 50),
    invLine(3, 'Casing clamp For 125mm casing tube'),
  ]);
  const pl = packing([
    plLine(1, 'Dept Detector 200m simple version', 1, 320),
    plLine(2, '89*4500*6.5, double slots', 20, 1239),
    plLine(3, 'Drill rod 89*4500*6.5, double slots', 15, 929),
    plLine(4, '89*4500*6.5, double slots', 15),
    plLine(5, 'Casing clamp For 125mm casing tube', 1, 17),
  ]);
  const [patch, warns] = extractMasses(inv, pl);
  const m = patch.line_masses as Record<string, number>;
  assert.equal(m['1'], 320);
  assert.equal(m['3'], 17);
  // 1239 + 929 weighted bundles, plus the unweighted 15-rod bundle's share
  // of the crate it continues.
  assert.ok(m['2'] >= 2168 - 1e-6, `line 2 mass ${m['2']}`);
  assert.equal(warns.some((w: string) => w.includes('нямат нето тегло')), false);
});

test('unweighted row between two weighted rows with no family link stays unbound', () => {
  const inv = invoice([
    invLine(1, 'Dept Detector 200m, simple version'),
    invLine(2, 'Yuchai Engine 77.3KW 2400 r/min'),
    invLine(3, 'Casing clamp For 125mm casing tube'),
  ]);
  const pl = packing([
    plLine(1, 'Dept Detector waterproof 200m simple version', 1, 320),
    plLine(2, 'Yuchai Engine Rated Power 77.3KW speed:2400 r/min', 1),
    plLine(3, 'Casing clamp For 125mm casing tube', 1, 17),
  ]);
  const [patch, warns] = extractMasses(inv, pl);
  const m = patch.line_masses as Record<string, number>;
  assert.equal(m['1'], 320);
  assert.equal(m['3'], 17);
  assert.equal(m['2'], undefined);
  assert.ok(warns.some((w: string) => w.includes('нямат нето тегло')));
});

test('conflicting size tokens prevent number-match mis-pairing', () => {
  const inv = invoice([
    invLine(1, 'Casing clamp For 125mm casing tube'),
    invLine(2, 'For 200mm casing tube'),
  ]);
  const pl = packing([
    // Same numbering position as invoice row 2 but a different size — must
    // not land on row 2 via line-number matching.
    plLine(2, 'Casing clamp For 125mm casing tube', 1, 17),
    plLine(3, 'For 200mm casing tube', 1, 20),
  ]);
  const [patch] = extractMasses(inv, pl);
  const m = patch.line_masses as Record<string, number>;
  assert.equal(m['1'], 17);
  assert.equal(m['2'], 20);
});

test('unmatched weighted packing rows are reported, not silently dropped', () => {
  const inv = invoice([
    invLine(1, 'Dept Detector 200m, simple version'),
    invLine(2, 'Casing clamp For 125mm casing tube'),
    invLine(3, 'Water swivel for 1000H rig, 89mm drill rods'),
  ]);
  const pl = packing([
    plLine(1, 'Dept Detector 200m simple version', 1, 320),
    plLine(2, 'Casing clamp For 125mm casing tube', 1, 17),
    plLine(3, 'Water swivel for 1000H rig,89mm drill rods', 1, 25.3),
    plLine(4, 'Unrelated spare part XL-9000', 4, 55),
  ]);
  const [patch, warns] = extractMasses(inv, pl);
  const m = patch.line_masses as Record<string, number>;
  assert.equal(m['1'], 320);
  assert.equal(m['2'], 17);
  assert.equal(m['3'], 25.3);
  assert.ok(warns.some((w: string) => w.includes('нямат съответствие')));
});
