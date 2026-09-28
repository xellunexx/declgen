import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../core/catalog.js';
import { buildDeclaration } from '../core/transform.js';
import { check } from '../core/conformance.js';

const template = {
  client_id: 'test', sender_code: 'BGA123456789ZZZZ1', recipient: 'MISV.BG', recipient_code: 'BG005100',
  declarant_tin: 'BGC123456789ZZZZ1', importer_tin: 'BGC123456789ZZZZ1', lodging_office: 'BG005100',
  representative: { tin: 'BGA123456789ZZZZ1', status: '2' },
  defaults: { declaration_code: 'H1', add_declaration_type: 'A', nature_of_transaction: '11', mode_of_trans_at_border: '3', nat_of_means: 'BG', container_ind: '0', inland_mode: '3' },
  location_of_goods: { typeOfLocation: 'D', qualifierOfIdentification: 'Z', ADDRESS: { City: 'Sofia', Country: 'BG', StreetAndNumber: 'Test 1', Postcode: '1000' } },
};
const invoice = {
  invoice_number: 'INV-1', invoice_date: '2026-09-01', currency: 'EUR', grand_total: 30, pieces: 7,
  price_term: 'FCA', price_term_place: 'Sofia', seller: { company: 'Seller', country: 'CN' }, buyer: { company: 'Buyer', country: 'BG' },
  lines: [
    { no: 1, description: 'Widget A', hs_code: '8537109899', quantity: 1, unit: 'PCE', total_amount: 10, origin: 'CN' },
    { no: 2, description: 'Widget B', hs_code: '8537109899', quantity: 1, unit: 'PCE', total_amount: 20, origin: 'CN' },
  ],
};
const catalog = new Catalog([
  { key: 'widget-a', aliases: ['Widget A'], bg_name: 'Уиджет А', hs: { hs6: '853710', cn: '98', taric: '99' }, origin: 'CN', source: 'human_verified' },
  { key: 'widget-b', aliases: ['Widget B'], bg_name: 'Уиджет Б', hs: { hs6: '853710', cn: '98', taric: '99' }, origin: 'CN', source: 'human_verified' },
]);

test('package invariant: header packages live on first item only', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, { lrn: '26000000123456789H000001', total_packages: 7, total_gross_kg: 3, line_masses: { '1': 1, '2': 2 } });
  assert.equal(d.DECHEA.TotalPackages, '7');
  assert.equal(d.GOODSSHIPMENT.GOODITEM[0].PACKAGING.NumberOfPackages, '7');
  assert.equal(d.GOODSSHIPMENT.GOODITEM[1].PACKAGING.NumberOfPackages, '0');
  const sum = d.GOODSSHIPMENT.GOODITEM.reduce((n, it) => n + Number(it.PACKAGING.NumberOfPackages), 0);
  assert.equal(sum, 7);
});

test('packing line_masses reach declaration items', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, { lrn: '26000000123456789H000001', total_packages: 7, total_gross_kg: 3, line_masses: { '1': 1, '2': 2 } });
  assert.equal(d.GOODSSHIPMENT.GOODITEM[0].Commodity.GOODSMEASURE.NetMassKg, '1.000000');
  assert.equal(d.GOODSSHIPMENT.GOODITEM[1].Commodity.GOODSMEASURE.NetMassKg, '2.000000');
});

test('human-verified catalog build has no classification placeholder', async () => {
  const [d, report] = await buildDeclaration(invoice, template, catalog, { lrn: '26000000123456789H000001', total_packages: 7, total_gross_kg: 3, line_masses: { '1': 1, '2': 2 } });
  assert.equal(report.grouping.every((g: any) => g.classification_state === 'confirmed'), true);
  assert.equal(check(d).some(i => i.where.includes('.desc') && i.level === 'ERROR'), false);
});
