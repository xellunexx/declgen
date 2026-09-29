import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocument, extractCession } from '../core/extract.js';

const CESSION_TEXT = `ПОЛУЧАТЕЛ ЕВЕЛИН 29
ТИП НА ТРАНСПОРТА 40 ВЪЗДУШЕН ТРАНСПОРТ
ИДЕНТИФИКАЦИЯ НА ТРАНСП. СРЕДСТВО - ПОЛЕТ - QY9008
ДЕКЛАРАЦИЯ ЗА ВРЕМЕННО СКЛАДИРАНЕ 26BG005100716837U5 / 29
ПО ТОВАРИТЕЛНИЦА 4929613102
Данни в Декларация за Временно Складиране
Опаковка
БРОЙ Бруто кг. Описание
Колет 4 76.790000 PROANTHOCYANIDINS
ДО МБ ЛЕТИЩЕ СОФИЯ
Ц Е С И Я`;

test('cession letter is classified deterministically, not by the LLM', async () => {
  const cls = await classifyDocument({ text: CESSION_TEXT });
  assert.equal(cls.type, 'cession');
  assert.equal(cls.confidence, 1);
});

test('cession extraction pulls the ДВС MRN/item, flight, waybill and masses', () => {
  const c = extractCession({ text: CESSION_TEXT });
  assert.equal(c.mrn_item, '26BG005100716837U5 / 29');
  assert.equal(c.waybill_number, '4929613102');
  assert.equal(c.arrival_id, 'QY9008');
  assert.equal(c.arrival_code, '40');
  assert.equal(c.pieces, 4);
  assert.equal(c.gross_kg, 76.79);
  assert.equal(c.recipient, 'ЕВЕЛИН 29');
});

test('cession extraction throws on unrelated text instead of guessing', () => {
  assert.throws(
    () => extractCession({ text: 'completely unrelated letter' }),
    /no storage-declaration facts/,
  );
});
