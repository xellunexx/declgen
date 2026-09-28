import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Catalog } from '../core/catalog.js';
import { CaseState } from '../core/case-state.js';
import { buildDeclaration } from '../core/transform.js';
import { DeclgenService } from '../electron/backend/declgen-service.js';

async function readyService() {
  const root = 'declgen-data', client = JSON.parse(await fs.readFile(`${root}/clients/evelin29.json`, 'utf8'));
  const catalog = await Catalog.load(`${root}/catalog`, 'evelin29');
  const invoice = { invoice_number: 'T-1', invoice_date: '2026-09-18', currency: 'EUR', grand_total: 123.69, total_net_weight_kg: 6.6, total_gross_weight_kg: 8, pieces: 1, price_term: 'CIP', price_term_place: 'Radomir',
    seller: { company: 'Shaanxi Sciencarin Bio - Tech Co.,Ltd', country: 'CN', address: 'Tangyan South Road', postcode: '710077', city: "Xi'an" }, buyer: { country: 'BG' },
    lines: [{ no: 1, description: 'Lactobacillus rhamnosus', hs_code: '3002490000', qty: .3, qty_unit: 'Kg', unit_price: 26.5, subtotal: 7.95 },
      { no: 2, description: 'Stevia Extract', hs_code: '2938909090', qty: 6, qty_unit: 'Kg', unit_price: 19.29, subtotal: 115.74 }] };
  const [decl] = await buildDeclaration(invoice, client, catalog, { lrn: '260000013137424H000001' });
  const svc = new DeclgenService();
  svc.persist = async () => {};
  svc.caseTemplate = client; svc.decl = decl; svc.report = {}; svc.issues = [];
  svc.case = new CaseState({ case_revision: 1, built_from_revision: 1, validated_revision: 1, built_fingerprint: 'fp-1', stage: 'READY' });
  return svc;
}

test('declaration item edit commits a new built+validated revision', async () => {
  const svc = await readyService();
  const r = await svc.updateDeclItems([{ item_no: 1, patch: { price: '12' } }], svc.caseId, 1);
  assert.equal(r.ok, true);
  assert.equal(svc.decl.GOODSSHIPMENT.GOODITEM[0].Commodity.ItemPrice, '12.00');
  assert.equal(svc.case.case_revision, 2);
  assert.equal(svc.case.built_from_revision, 2);
  assert.equal(svc.case.built_fingerprint, 'fp-1');
  assert.notEqual(svc.case.stage, 'STALE');
  assert.match(svc.xml, /12\.00/);
});

test('rejected declaration item batch leaves case untouched', async () => {
  const svc = await readyService();
  const before = structuredClone(svc.decl);
  await assert.rejects(svc.updateDeclItems([{ item_no: 1, patch: { price: '12' } }, { item_no: 2, patch: { gross_kg: '0.0001' } }], svc.caseId, 1), /брутото е под нетото/);
  assert.deepEqual(svc.decl, before);
  assert.equal(svc.case.case_revision, 1);
  assert.equal(svc.case.stage, 'READY');
});
