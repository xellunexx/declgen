import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseState } from '../core/case-state.js';
import { DeclgenService } from '../electron/backend/declgen-service.js';
import { read, flat, has } from './source-contract.js';

// UI files are vite-compiled and cannot be imported by node:test; their contracts are
// asserted on formatting-insensitive source (see source-contract.ts).

test('invoice and H1 drafts are dirty/revision scoped rather than overwritten by polling', () => {
  const invoice = read('src/components/InvoiceTab.tsx');
  const declaration = read('src/components/DeclarationTab.tsx');
  assert.ok(has(invoice, 'if (scopeChanged || !dirty)'));
  assert.ok(has(invoice, 'baseRevision'));
  assert.ok(has(invoice, 'updateInvoice(normalized, caseId, baseRevision)'));
  assert.ok(has(declaration, 'if (scopeChanged || !dirty)'));
  assert.ok(has(declaration, 'saveH1Context(next, caseId, baseRevision)'));
});

test('H1 editor preserves arrival code and valid zero-like context values', () => {
  const declaration = read('src/components/DeclarationTab.tsx');
  assert.ok(
    has(
      declaration,
      "container_indicator: String(initial.container_indicator ?? '')",
    ),
  );
  assert.ok(
    has(
      declaration,
      "arrival_code: String(at.IdeOfMeaOfTraAtArrivalCode ?? '')",
    ),
  );
  assert.ok(!has(declaration, "IdeOfMeaOfTraAtArrivalCode: '30'"));
});

test('build parameter drafts are case/revision scoped and can become stale', () => {
  const app = read('src/App.tsx');
  assert.ok(has(app, 'buildDraftBase'));
  assert.ok(has(app, 'buildParamsStale'));
  assert.ok(has(app, 'base.caseId || stateCaseId, base.revision'));
  assert.ok(has(app, 'resetBuildParams'));
});

test('case changes clear XML/TRACE and task/revision transitions refresh derived views', () => {
  const hook = read('src/hooks/useDeclgen.ts');
  assert.ok(has(hook, "setXml('')"));
  assert.ok(has(hook, "setTrace('')"));
  assert.ok(has(hook, 'taskFinished'));
  assert.ok(has(hook, 'refreshCaseViews()'));
});

test('new-importer validation failure cannot fall through to submit', () => {
  const modal = read('src/components/NewImporterModal.tsx');
  assert.ok(has(modal, 'valid.ok === false || valid.errors?.length'));
  assert.ok(has(modal, 'return;'));
  assert.ok(has(modal, 'submitNewImporter(payload, caseId, baseRevision)'));
});

test('approval UI reflects backend readiness', () => {
  const app = read('src/App.tsx');
  assert.ok(has(app, 'approvalReady = Boolean(d.state.readiness?.ready)'));
  assert.ok(has(app, 'disabled={!approvalReady'));
});

test('approval exports a frozen snapshot and freezes the live case only after final copy', () => {
  const service = flat(read('electron/backend/declgen-service.ts'));
  const copyIndex = service.indexOf(
    flat('await fs.copyFile(approvedXml,final)'),
  );
  const liveApproveIndex = service.indexOf(
    flat('this.case.markApproved(); this.case.markExported()'),
    copyIndex,
  );
  assert.ok(copyIndex > 0, 'final Alpha copy not found');
  assert.ok(
    liveApproveIndex > copyIndex,
    'live case must freeze only after the filesystem export succeeds',
  );
  assert.ok(
    service.includes(
      flat(
        'const frozenState=new CaseState(this.case.toJSON()); frozenState.markApproved(); frozenState.markExported()',
      ),
    ),
  );
  assert.ok(service.includes(flat('approved-snapshot.json')));
});

test('shared modal implements dialog semantics, focus trap/restore and Escape', () => {
  const common = read('src/components/common.tsx');
  assert.ok(has(common, 'role="dialog"'));
  assert.ok(has(common, 'aria-modal="true"'));
  assert.ok(has(common, "event.key === 'Escape'"));
  assert.ok(has(common, "event.key !== 'Tab'"));
  assert.ok(has(common, 'previouslyFocused.current?.focus()'));
});

// --- behavioural checks (service layer is node-importable and is where the contracts live) ---

test('mutating endpoints reject a stale case_id or base_revision', async () => {
  const svc = new DeclgenService();
  svc.persist = async () => {};
  svc.case = new CaseState({
    case_revision: 3,
    built_from_revision: 3,
    validated_revision: 3,
    built_fingerprint: 'fp',
    stage: 'READY',
  });
  assert.throws(() => svc.assertCaseVersion('some-other-case', 3), /сменен/);
  assert.throws(() => svc.assertCaseVersion(svc.caseId, 2), /ревизия/);
  assert.doesNotThrow(() => svc.assertCaseVersion(svc.caseId, 3));
});

test('APPROVED/EXPORTED case freezes mutating endpoints', async () => {
  const svc = new DeclgenService();
  svc.persist = async () => {};
  svc.case = new CaseState({
    case_revision: 4,
    built_from_revision: 4,
    validated_revision: 4,
    built_fingerprint: 'fp',
    stage: 'EXPORTED',
    approved: true,
  });
  await assert.rejects(
    svc.updateDeclItems([{ item_no: 1, patch: { price: '1' } }], svc.caseId, 4),
    /замразен/,
  );
});

test('readiness is false while a READY case still has review blockers', () => {
  const svc = new DeclgenService();
  svc.case = new CaseState({
    case_revision: 1,
    built_from_revision: 1,
    validated_revision: 1,
    built_fingerprint: 'fp',
    stage: 'READY',
  });
  svc.invoice = { lines: [{ no: 1, description: 'x' }] };
  svc.issues = [];
  svc.report = {
    grouping: [{ item: 1, group: 'g', line_nos: ['1'], descriptions: ['x'] }],
  };
  const pending = svc.readiness();
  assert.equal(pending.ready, false);
  assert.ok(
    pending.blockers.some((b: string) => b.includes('класификационни')),
  );
  svc.report = {
    grouping: [
      {
        item: 1,
        group: 'g',
        line_nos: ['1'],
        descriptions: ['x'],
        classification_state: 'confirmed',
      },
    ],
  };
  assert.equal(svc.readiness().ready, true);
});
