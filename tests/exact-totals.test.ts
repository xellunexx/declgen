import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeclaration } from '../core/transform.js';
import { check } from '../core/conformance.js';
import { Catalog } from '../core/catalog.js';
import { read, has } from './source-contract.js';

// Regression: 2026-09-10 user feedback — penny-dust conformance errors blocked export
// ('sum ItemPrice 12792.37 != TotalAmountInvoiced 12792.40', 'sum item gross 51.260001 > header').
// Fix anchors totals exactly at the SOURCE (transform), absorbed into the biggest line.
test('IM build anchors money and gross totals exactly (no penny dust)', async () => {
  const lines: any[] = [];
  for (let i = 1; i <= 35; i++)
    lines.push({
      no: i,
      description: `Good ${i}`,
      hs_code: '8471300000',
      origin: 'CN',
      quantity: i,
      unit: 'pcs',
      unit_price: Number((i * 10.43).toFixed(2)),
      subtotal: Number((i * i * 10.43).toFixed(2)),
    });
  const lineSum = lines.reduce((a, l) => a + l.subtotal, 0);
  const invoice: any = {
    invoice_number: 'T-DUST-1',
    invoice_date: '2026-01-01',
    currency: 'USD',
    seller: { company: 'Seller Co', country: 'CN' },
    buyer: { company: 'Buyer OOD', country: 'BG' },
    price_term: 'EXW',
    grand_total: Number((lineSum + 15.7).toFixed(2)), // delta forces proportional distribution
    total_net_weight_kg: 46.4,
    total_gross_weight_kg: 51.26,
    pieces: 5,
    lines,
  };
  const [d] = await buildDeclaration(
    invoice,
    {} as any,
    new Catalog() as any,
    {},
  );
  const items = d.GOODSSHIPMENT.GOODITEM as any[];
  const sumPrice = items.reduce(
    (a, it) => a + Number(it.Commodity.ItemPrice),
    0,
  );
  assert.equal(
    sumPrice.toFixed(2),
    d.DECHEA.TotalAmountInvoiced,
    'Σ ItemPrice must equal header to the cent',
  );
  const sumGross = items.reduce(
    (a, it) => a + Number(it.Commodity.GOODSMEASURE.GrossMassKg),
    0,
  );
  assert.ok(
    Math.abs(sumGross - Number(d.DECHEA.TotalGrossMassKg)) <= 5e-7,
    `Σ gross ${sumGross} vs header ${d.DECHEA.TotalGrossMassKg}`,
  );
  const totalsIssues = check(d).filter((i) =>
    String(i.where || '').startsWith('totals'),
  );
  assert.deepEqual(
    totalsIssues,
    [],
    'conformance must not emit totals/totals.gross issues',
  );
});

test('declaration items are human-editable via service surface (contract wiring)', () => {
  const service = read('electron/backend/declgen-service.ts');
  const tab = read('src/components/DeclarationTab.tsx');
  const api = read('src/api.ts');
  assert.ok(has(service, 'async updateDeclItems('));
  assert.ok(has(service, "case 'POST /api/declaration/items_update'"));
  assert.ok(has(api, 'declItemsUpdate'));
  assert.ok(has(tab, 'declItemsUpdate('));
  assert.ok(has(tab, 'Потвърди позициите'));
});
