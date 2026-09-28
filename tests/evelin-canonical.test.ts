import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { emitText, parseImportText } from '../core/xmlio.js';
import { check } from '../core/conformance.js';

const base = 'declgen-data';

test('Evelin 1661 fixture is the enforceable import profile', async () => {
  const [xml, clientText, catalogText] = await Promise.all([
    fs.readFile(
      `${base}/evidence/evelin29/H1_BG005100_1661_CANONICAL.XML`,
      'utf8',
    ),
    fs.readFile(`${base}/clients/evelin29.json`, 'utf8'),
    fs.readFile(`${base}/catalog/clients/evelin29.canonical.json`, 'utf8'),
  ]);
  const client = JSON.parse(clientText),
    entries = JSON.parse(catalogText),
    declaration = parseImportText(xml);
  assert.deepEqual(
    Buffer.from(emitText(declaration, client), 'utf8'),
    Buffer.from(xml, 'utf8'),
    'fixture must round-trip byte-for-byte through the Evelin AlphaAgent serializer',
  );
  assert.equal(declaration.GOODSSHIPMENT.GOODITEM.length, 18);
  assert.equal(
    client.canonical_h1.fixture,
    'evidence/evelin29/H1_BG005100_1661_CANONICAL.XML',
  );
  assert.equal(client.canonical_h1.max_description_length, 268);
  assert.deepEqual(
    client.canonical_h1.item_supporting_documents.map((x: any) => x.type),
    ['N325', '1999', '1999', '1999', '1999'],
  );
  assert.equal(
    check(declaration, client).filter((x) => x.level === 'ERROR').length,
    0,
  );
  const casMismatch = structuredClone(declaration);
  casMismatch.GOODSSHIPMENT.GOODITEM[2].Commodity.CommodityCode.taricCode =
    '00';
  assert.ok(
    check(casMismatch, client).some(
      (x) => x.where === 'item[3].CAS' && x.level === 'ERROR',
    ),
    'a known CAS with an incompatible HS must be blocked',
  );
  assert.equal(entries.length, 19);
  for (const entry of entries) {
    assert.match(`${entry.hs.hs6}${entry.hs.cn}${entry.hs.taric}`, /^\d{10}$/);
    assert.ok(
      entry.declaration_description.trim(),
      'canonical description required',
    );
    for (const cas of entry.cas_numbers)
      assert.match(
        entry.declaration_description,
        new RegExp(cas.replace(/-/g, '\\-')),
      );
  }
  for (const item of declaration.GOODSSHIPMENT.GOODITEM) {
    const hs = `${item.Commodity.CommodityCode.harmonizedSystemSubheadingCode}${item.Commodity.CommodityCode.combinedNomenclatureCode}${item.Commodity.CommodityCode.taricCode}`;
    assert.ok(
      entries.some(
        (entry: any) =>
          `${entry.hs.hs6}${entry.hs.cn}${entry.hs.taric}` === hs &&
          entry.declaration_description === item.Commodity.descriptionOfGoods,
      ),
      `fixture association missing for ${hs}`,
    );
  }
});
