import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicDocumentSupported,
  extractWaybill,
} from '../core/extract.js';

test('FedEx waybill extracts the tracking number and gross mass', async () => {
  const text =
    'TRK#\n8770 0604 9480\nACTWGT: 18.50 KG\nDESC1:Parts for Smart Home Systems - locks';
  assert.equal(deterministicDocumentSupported({ text }), true);
  assert.deepEqual(extractWaybill({ text }), {
    waybill_number: '877006049480',
    pieces: null,
    gross_kg: 18.5,
    customs_value_usd: null,
    content: 'Parts for Smart Home Systems - locks',
    _warnings: ['deterministic FedEx waybill extraction'],
  });
});
