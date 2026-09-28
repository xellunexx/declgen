import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionCancelled } from '../core/extract.js';
import { DeclgenService } from '../electron/backend/declgen-service.js';

test('ExtractionCancelled is reported as cancelled, not error', async () => {
  const svc = new DeclgenService();
  svc.persist = async () => {};
  const r = await svc.startTask('extract', async () => { throw new ExtractionCancelled('stopped before page 3'); });
  assert.equal(svc.task.status, 'cancelled');
  assert.equal(svc.task.error, '');
  assert.equal(r.ok, false);
});

test('progress() cancellation still reports cancelled', async () => {
  const svc = new DeclgenService();
  svc.persist = async () => {};
  const r = await svc.startTask('extract', async () => { svc.stop(); svc.progress('x'); });
  assert.equal(svc.task.status, 'cancelled');
  assert.equal(r.ok, false);
});

test('real extraction error still reports error', async () => {
  const svc = new DeclgenService();
  svc.persist = async () => {};
  await assert.rejects(svc.startTask('extract', async () => { throw new Error('LLM unreachable'); }));
  assert.equal(svc.task.status, 'error');
  assert.equal(svc.task.error, 'LLM unreachable');
});
