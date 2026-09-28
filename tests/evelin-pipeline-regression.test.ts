import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nextLrn } from '../core/clients.js';
import { extractWaybill } from '../core/extract.js';
import { Catalog } from '../core/catalog.js';
import { buildDeclaration } from '../core/transform.js';

test('Evelin pipeline keeps Alpha lengths and current shipment descriptions', async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'declgen-lrn-'));
  const lrn = await nextLrn(
    { client_id: 'fixture', representative: { tin: 'BGA131374246ZZZZ3' } },
    new Date('2026-09-23'),
    state,
  );
  assert.equal(lrn.length, 22);
  assert.match(lrn, /^260000013137424H000001$/);

  const waybill = extractWaybill({
    text: 'WAYBILL 49 2943 1474\n47.0 KG / Dimensions(CM): L:1 W:1 H:1 3\nPiecesCust Decl Shpt Wgt',
  });
  assert.deepEqual(
    {
      number: waybill.waybill_number,
      pieces: waybill.pieces,
      gross: waybill.gross_kg,
    },
    { number: '4929431474', pieces: 3, gross: 47 },
  );

  const root = 'declgen-data',
    client = JSON.parse(
      await fs.readFile(`${root}/clients/evelin29.json`, 'utf8'),
    );
  const catalog = await Catalog.load(`${root}/catalog`, 'evelin29');
  const invoice = {
    invoice_number: '2026091801A',
    invoice_date: '2026-09-18',
    currency: 'USD',
    grand_total: 505.67,
    total_net_weight_kg: 41.5508,
    total_gross_weight_kg: 47,
    pieces: 3,
    price_term: 'CIP',
    price_term_place: 'Radomir',
    seller: {
      company: 'Shaanxi Sciencarin Bio - Tech Co.,Ltd',
      country: 'CN',
      address: "Yicuiyuan,No.11 Tangyan South Road,Xi'an, China",
      postcode: '710077',
      city: "Xi'an",
    },
    buyer: { country: 'BG' },
    lines: [
      {
        no: 1,
        description: 'Lactobacillus rhamnosus',
        hs_code: '3002490000',
        qty: 0.3,
        qty_unit: 'Kg',
        unit_price: 26.5,
        subtotal: 7.95,
      },
      {
        no: 2,
        description: 'Bifidobacterium lactis',
        hs_code: '3002490000',
        qty: 0.3,
        qty_unit: 'Kg',
        unit_price: 31.8,
        subtotal: 9.54,
      },
      {
        no: 3,
        description: 'Stevia Extract',
        hs_code: '2938909090',
        qty: 6,
        qty_unit: 'Kg',
        unit_price: 17.7,
        subtotal: 106.2,
      },
    ],
  };
  const [d] = await buildDeclaration(invoice, client, catalog, {
    lrn,
    previous_documents: [
      { type: 'N337', referenceNumber: '26BG005100000000U0 / 1' },
    ],
    transport_documents: [{ type: 'N740', referenceNumber: '4929431474' }],
  });
  assert.equal(d.EXPORTER.Name, 'SHAANXI SCIENCARIN BIOTECH CO., LTD.');
  assert.equal(d.GOODSSHIPMENT.GOODITEM[0].PACKAGING.ShippingMarks, 'Колет');
  assert.match(
    d.GOODSSHIPMENT.GOODITEM[0].Commodity.descriptionOfGoods,
    /0,6 кг/,
  );
  assert.match(
    d.GOODSSHIPMENT.GOODITEM[1].Commodity.descriptionOfGoods,
    /Stevia Extract/,
  );
});
