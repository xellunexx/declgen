import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseState, fingerprint } from '../core/case-state.js';

test('confirmed change after build makes output stale', () => {
  const c = new CaseState();
  c.selectInput();
  c.markExtracted();
  c.bump('resolved facts');
  const fp = fingerprint({ invoice: 1 });
  c.markBuilt(fp);
  c.markValidated(true);
  c.markReady([]);
  assert.equal(c.stage, 'READY');
  assert.deepEqual(c.readyBlockers(), []);
  c.bump('human H1 correction');
  assert.equal(c.stage, 'STALE');
  assert.ok(c.readyBlockers().some((x) => x.includes('ревизия')));
});

test('approval requires current built and validated revision', () => {
  const c = new CaseState();
  c.bump('resolved');
  assert.throws(() => c.markApproved());
  c.markBuilt(fingerprint({ x: 1 }));
  c.markValidated(true);
  c.markReady([]);
  c.markApproved();
  assert.equal(c.stage, 'APPROVED');
  c.markExported();
  assert.equal(c.stage, 'EXPORTED');
});

test('fingerprint proves post-build drift independently of revision counter', () => {
  const c = new CaseState();
  c.bump('resolved');
  const built = fingerprint({ invoice: { total: 10 }, context: {} });
  c.markBuilt(built);
  assert.deepEqual(c.driftBlockers(built), []);
  assert.ok(
    c.driftBlockers(fingerprint({ invoice: { total: 11 }, context: {} }))
      .length > 0,
  );
});

test('exported case is frozen and cannot be revised or rebuilt', () => {
  const c = new CaseState();
  c.bump('resolved');
  c.markBuilt(fingerprint({ x: 1 }));
  c.markValidated(true);
  c.markReady([]);
  c.markApproved();
  c.markExported();
  assert.throws(() => c.bump('late invoice edit'), /замразен/);
  assert.throws(() => c.markBuilt(fingerprint({ x: 2 })), /замразен/);
  assert.ok(c.readyBlockers().some((x) => x.includes('замразен')));
});

test('approval only occurs from READY, not merely matching revisions', () => {
  const c = new CaseState();
  c.bump('resolved');
  c.markBuilt(fingerprint({ x: 1 }));
  c.markValidated(true);
  assert.equal(c.stage, 'VALIDATED');
  assert.throws(() => c.markApproved(), /expected READY/);
});
