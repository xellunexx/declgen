import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../core/catalog.js';
import { buildDeclaration } from '../core/transform.js';
import { check } from '../core/conformance.js';
import { reconcileInvoiceDeclaration } from '../core/workflow.js';

const template = {
  client_id: 'test',
  sender_code: 'BGA123456789ZZZZ1',
  recipient: 'MISV.BG',
  recipient_code: 'BG005100',
  declarant_tin: 'BGC123456789ZZZZ1',
  importer_tin: 'BGC123456789ZZZZ1',
  lodging_office: 'BG005100',
  representative: { tin: 'BGA123456789ZZZZ1', status: '2' },
  defaults: {
    declaration_code: 'H1',
    add_declaration_type: 'A',
    nature_of_transaction: '11',
    mode_of_trans_at_border: '3',
    nat_of_means: 'BG',
    container_ind: '0',
    inland_mode: '3',
  },
  location_of_goods: {
    typeOfLocation: 'D',
    qualifierOfIdentification: 'Z',
    ADDRESS: {
      City: 'Sofia',
      Country: 'BG',
      StreetAndNumber: 'Test 1',
      Postcode: '1000',
    },
  },
};
const invoice = {
  invoice_number: 'INV-1',
  invoice_date: '2026-09-01',
  currency: 'EUR',
  grand_total: 30,
  pieces: 7,
  price_term: 'FCA',
  price_term_place: 'Sofia',
  seller: { company: 'Seller', country: 'CN' },
  buyer: { company: 'Buyer', country: 'BG' },
  lines: [
    {
      no: 1,
      description: 'Widget A',
      hs_code: '8537109899',
      quantity: 1,
      unit: 'PCE',
      total_amount: 10,
      origin: 'CN',
    },
    {
      no: 2,
      description: 'Widget B',
      hs_code: '8537109899',
      quantity: 1,
      unit: 'PCE',
      total_amount: 20,
      origin: 'CN',
    },
  ],
};
const catalog = new Catalog([
  {
    key: 'widget-a',
    aliases: ['Widget A'],
    bg_name: 'Уиджет А',
    hs: { hs6: '853710', cn: '98', taric: '99' },
    origin: 'CN',
    source: 'human_verified',
  },
  {
    key: 'widget-b',
    aliases: ['Widget B'],
    bg_name: 'Уиджет Б',
    hs: { hs6: '853710', cn: '98', taric: '99' },
    origin: 'CN',
    source: 'human_verified',
  },
]);

test('package invariant: header packages distribute across items by gross share', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_packages: 7,
    total_gross_kg: 3,
    line_masses: { '1': 1, '2': 2 },
  });
  assert.equal(d.DECHEA.TotalPackages, '7');
  const pkgs = d.GOODSSHIPMENT.GOODITEM.map((it: any) =>
    Number(it.PACKAGING.NumberOfPackages),
  );
  // 1:2 gross split → 2.33 / 4.67 shares → largest remainder → [2, 5].
  assert.deepEqual(pkgs, [2, 5]);
  assert.equal(
    pkgs.reduce((a: number, b: number) => a + b, 0),
    7,
  );
});

test('packing line_masses reach declaration items', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_packages: 7,
    total_gross_kg: 3,
    line_masses: { '1': 1, '2': 2 },
  });
  assert.equal(
    d.GOODSSHIPMENT.GOODITEM[0].Commodity.GOODSMEASURE.NetMassKg,
    '1.000000',
  );
  assert.equal(
    d.GOODSSHIPMENT.GOODITEM[1].Commodity.GOODSMEASURE.NetMassKg,
    '2.000000',
  );
});

test('doubled name+desc cells dedupe inside {components} descriptions', async () => {
  const tpl = {
    ...template,
    canonical_h1: { max_description_length: 268 },
  };
  const cat = new Catalog([
    {
      key: 'probiotics',
      aliases: [
        'Lactobacillus plantarum',
        'Bifidobacterium longum subsp. infantis',
      ],
      bg_name: 'Пробиотици',
      hs: { hs6: '300249', cn: '00', taric: '20' },
      origin: 'CN',
      source: 'human_verified',
      declaration_description_template:
        'Пробиотични култури за хранителни добавки - {net_kg} кг /{components}/',
    },
  ]);
  const inv = {
    ...invoice,
    grand_total: 30,
    total_goods_value: 30,
    lines: [
      {
        no: 1,
        description: 'Lactobacillus plantarum Lactobacillus plantarum',
        hs_code: '3002493090',
        quantity: 2,
        unit: 'KG',
        unit_price: 10,
        total_amount: 20,
        origin: 'CN',
      },
      {
        no: 2,
        description:
          'Bifidobacterium longum subsp. infantis Bifidobacterium longum subsp. infantis',
        hs_code: '3002493090',
        quantity: 1,
        unit: 'KG',
        unit_price: 10,
        total_amount: 10,
        origin: 'CN',
      },
    ],
  };
  const [d] = await buildDeclaration(inv, tpl, cat, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
  });
  const desc = d.GOODSSHIPMENT.GOODITEM[0].Commodity.descriptionOfGoods;
  assert.equal(desc.includes('plantarum Lactobacillus'), false);
  assert.equal(
    desc.includes(
      'Lactobacillus plantarum, Bifidobacterium longum subsp. infantis',
    ),
    true,
  );
  assert.ok(desc.length <= 268);
});

test('wrapped desc-cell spillover collapses to the product name', async () => {
  const cat = new Catalog([
    {
      key: 'extracts',
      aliases: ['Dandelion Root Extract'],
      bg_name: 'Екстракти',
      hs: { hs6: '130219', cn: '70', taric: '00' },
      origin: 'CN',
      source: 'human_verified',
      declaration_description_template: 'Екстракти - {net_kg} кг /{components}/',
    },
  ]);
  const inv = {
    ...invoice,
    grand_total: 20,
    total_goods_value: 20,
    lines: [
      {
        no: 1,
        // name cell + wrapped desc cell → name repeated around a stray word
        description: 'Dandelion Root Extract Extract Dandelion Root Extract',
        hs_code: '1302199099',
        quantity: 2,
        unit: 'KG',
        unit_price: 10,
        total_amount: 20,
        origin: 'CN',
      },
    ],
  };
  const [d] = await buildDeclaration(inv, template, cat, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
  });
  const desc = d.GOODSSHIPMENT.GOODITEM[0].Commodity.descriptionOfGoods;
  assert.equal(desc.includes('Dandelion Root Extract'), true);
  assert.equal(desc.includes('Extract Extract'), false);
});

test('charge rows never become goods items; embedded freight folds into prices by weight', async () => {
  const inv = {
    ...invoice,
    total_goods_value: 30,
    grand_total: 1030,
    shipping_cost: 0,
    lines: [
      ...invoice.lines,
      {
        no: 3,
        description: 'Shipping Cost',
        hs_code: '9999990000',
        quantity: 1,
        unit: 'PCE',
        unit_price: 1000,
        total_amount: 1000,
        origin: 'CN',
      },
    ],
  };
  const [d, report] = await buildDeclaration(inv, template, catalog, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
  });
  assert.equal(d.GOODSSHIPMENT.GOODITEM.length, 2);
  assert.equal(
    report.grouping.some((g: any) =>
      (g.line_nos || []).map(String).includes('3'),
    ),
    false,
  );
  assert.equal(
    report.warnings.some((w: string) => /служебни разходи/.test(w)),
    true,
  );
  // The 1000 charge folds into the item prices by gross-weight share — the
  // canonical presentation: Σ ItemPrice == TotalAmountInvoiced == grand_total,
  // and no AK addition is emitted for embedded freight.
  const priceSum = d.GOODSSHIPMENT.GOODITEM.reduce(
    (a: number, it: any) => a + Number(it.Commodity.ItemPrice),
    0,
  );
  const statSum = d.GOODSSHIPMENT.GOODITEM.reduce(
    (a: number, it: any) => a + Number(it.StatisticalValue),
    0,
  );
  assert.ok(Math.abs(priceSum - 1030) < 0.02);
  assert.ok(Math.abs(statSum - 1030) < 0.02);
  assert.equal(d.DECHEA.TotalAmountInvoiced, '1030.00');
  for (const it of d.GOODSSHIPMENT.GOODITEM)
    assert.equal(
      it.CUSTOMSVALUATION.AdditionsAndDeductions.some(
        (a: any) => a.code === 'AK',
      ),
      false,
    );
  // Reconciliation must not report the excluded charge as a missing total or
  // count the charge row among goods positions.
  const rec = reconcileInvoiceDeclaration(inv, d);
  const totalsRow = rec.rows.find((r: any) => r[0] === 'Крайна сума');
  const posRow = rec.rows.find((r: any) => r[0] === 'Позиции');
  assert.equal(totalsRow?.[4], true);
  assert.equal(posRow?.[1], '2');
  assert.equal(posRow?.[4], true);
  assert.equal(rec.ok, true);
});

test('valuation additions emit AlphaAgent A&D shape and cent-anchor', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
    valuation_freight_total: '100.01',
  });
  for (const it of d.GOODSSHIPMENT.GOODITEM) {
    const codes = it.CUSTOMSVALUATION.AdditionsAndDeductions.map(
      (a: any) => a.code,
    );
    // AlphaAgent-accepted shape: AK only when freight>0, then BC and FF always.
    assert.deepEqual(codes, ['AK', 'BC', 'FF']);
  }
  const akSum = d.GOODSSHIPMENT.GOODITEM.reduce(
    (a: number, it: any) =>
      a +
      Number(
        it.CUSTOMSVALUATION.AdditionsAndDeductions.find(
          (x: any) => x.code === 'AK',
        ).amount,
      ),
    0,
  );
  assert.ok(Math.abs(akSum - 100.01) < 0.005);
});

test('declaration_context previous_documents reach GOODSSHIPMENT', async () => {
  const [d] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
    declaration_context: {
      declaration_type: 'IM',
      previous_documents: [
        { type: 'N337', referenceNumber: '26BG005100693131U2' },
      ],
    },
  });
  const [d2] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 3,
    previous_documents: [
      { type: 'N337', referenceNumber: '26BG005100699433U4 / 13' },
    ],
  });
  assert.equal(
    d2.GOODSSHIPMENT.PreviousDocument[0].referenceNumber,
    '26BG005100699433U4 / 13',
  );
  const prev = d.GOODSSHIPMENT.PreviousDocument;
  assert.equal(prev.length, 1);
  assert.equal(prev[0].type, 'N337');
  assert.equal(prev[0].referenceNumber, '26BG005100693131U2');
  const issues = check(d, {
    canonical_h1: { required_previous_document_type: 'N337' },
  });
  assert.equal(
    issues.some(
      (i) => i.where === 'GOODSSHIPMENT.PreviousDocument' && i.level === 'ERROR',
    ),
    false,
  );
});

test('human-verified catalog build has no classification placeholder', async () => {
  const [d, report] = await buildDeclaration(invoice, template, catalog, {
    lrn: '26000000123456789H000001',
    total_packages: 7,
    total_gross_kg: 3,
    line_masses: { '1': 1, '2': 2 },
  });
  assert.equal(
    report.grouping.every((g: any) => g.classification_state === 'confirmed'),
    true,
  );
  assert.equal(
    check(d).some((i) => i.where.includes('.desc') && i.level === 'ERROR'),
    false,
  );
});

test('static catalog descriptions cannot leak a previous shipment', async () => {
  const cat = new Catalog([
    {
      key: 'botanicals',
      aliases: [
        'White Birch Extract',
        'Dandelion Root Extract',
        'Chamomile extract',
        'Cinnamon Extract',
        'Aged garlic extract',
        'Nettle root Extract',
      ],
      bg_name: 'Екстракти',
      hs: { hs6: '130219', cn: '70', taric: '00' },
      origin: 'CN',
      source: 'human_verified',
      // Frozen text from an earlier case: 53,25 кг of white birch, dandelion,
      // chamomile… — nothing like the lines in this shipment, but the fuzzy
      // alias match still groups Cinnamon bark / Beet root / Garlic here.
      declaration_description:
        'Растителни екстракти за производството на хранителни добавки - 53,25 кг.\n/Бяла бреза, Глухарче, Лайка/',
    },
  ]);
  const inv = {
    ...invoice,
    grand_total: 60,
    total_goods_value: 60,
    lines: [
      {
        no: 1,
        description: 'Cinnamon bark Extract Cinnamon bark Extract',
        hs_code: '1302199099',
        quantity: 2,
        unit: 'KG',
        unit_price: 10,
        total_amount: 20,
        origin: 'CN',
      },
      {
        no: 2,
        description: 'Beet root Extract Beet root Extract',
        hs_code: '1302199099',
        quantity: 2,
        unit: 'KG',
        unit_price: 10,
        total_amount: 20,
        origin: 'CN',
      },
      {
        no: 3,
        description: 'Garlic Extract Garlic Extract',
        hs_code: '1302199099',
        quantity: 2,
        unit: 'KG',
        unit_price: 10,
        total_amount: 20,
        origin: 'CN',
      },
    ],
  };
  const [d] = await buildDeclaration(inv, template, cat, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 6,
  });
  const item = d.GOODSSHIPMENT.GOODITEM[0];
  const desc = item.Commodity.descriptionOfGoods;
  const net = Number(item.Commodity.GOODSMEASURE.NetMassKg);
  assert.equal(desc.includes('53,25'), false, 'stale mass leaked');
  assert.equal(desc.includes('Бяла бреза'), false, 'stale product leaked');
  assert.equal(
    desc.includes('- 6 кг'),
    true,
    'desc mass must match emitted NetMassKg',
  );
  assert.ok(desc.includes('Cinnamon bark Extract'));
  assert.ok(desc.includes('Beet root Extract'));
  assert.ok(desc.includes('Garlic Extract'));
  assert.equal(net, 6);
});

test('static descriptions stay verbatim when lines match the approved set', async () => {
  const cat = new Catalog([
    {
      key: 'botanicals',
      aliases: ['White Birch Extract', 'Dandelion Root Extract'],
      bg_name: 'Екстракти',
      hs: { hs6: '130219', cn: '70', taric: '00' },
      origin: 'CN',
      source: 'human_verified',
      declaration_description:
        'Растителни екстракти за производството на хранителни добавки - 6 кг.\n/Бяла бреза, Глухарче/',
    },
  ]);
  const inv = {
    ...invoice,
    grand_total: 60,
    total_goods_value: 60,
    lines: [
      {
        no: 1,
        description: 'White Birch Extract White Birch Extract',
        hs_code: '1302199099',
        quantity: 3,
        unit: 'KG',
        unit_price: 10,
        total_amount: 30,
        origin: 'CN',
      },
      {
        no: 2,
        description: 'Dandelion Root Extract Dandelion Root Extract',
        hs_code: '1302199099',
        quantity: 3,
        unit: 'KG',
        unit_price: 10,
        total_amount: 30,
        origin: 'CN',
      },
    ],
  };
  const [d] = await buildDeclaration(inv, template, cat, {
    lrn: '26000000123456789H000001',
    total_gross_kg: 6,
  });
  assert.equal(
    d.GOODSSHIPMENT.GOODITEM[0].Commodity.descriptionOfGoods,
    'Растителни екстракти за производството на хранителни добавки - 6 кг.\n/Бяла бреза, Глухарче/',
  );
});
