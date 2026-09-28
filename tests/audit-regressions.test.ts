import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('invoice and H1 drafts are dirty/revision scoped rather than overwritten by polling', () => {
  const invoice = read('src/components/InvoiceTab.tsx');
  const declaration = read('src/components/DeclarationTab.tsx');
  assert.match(invoice, /if \(scopeChanged \|\| !dirty\)/);
  assert.match(invoice, /baseRevision/);
  assert.match(invoice, /updateInvoice\(normalized, caseId, baseRevision\)/);
  assert.match(declaration, /if \(scopeChanged \|\| !dirty\)/);
  assert.match(declaration, /saveH1Context\(next, caseId, baseRevision\)/);
});

test('H1 editor preserves arrival code and valid zero-like context values', () => {
  const declaration = read('src/components/DeclarationTab.tsx');
  assert.match(declaration, /container_indicator: String\(initial\.container_indicator \?\? ''\)/);
  assert.match(declaration, /arrival_code: String\(at\.IdeOfMeaOfTraAtArrivalCode \?\? ''\)/);
  assert.doesNotMatch(declaration, /IdeOfMeaOfTraAtArrivalCode:\s*['"]30['"]/);
});

test('build parameter drafts are case/revision scoped and can become stale', () => {
  const app = read('src/App.tsx');
  assert.match(app, /buildDraftBase/);
  assert.match(app, /buildParamsStale/);
  assert.match(app, /base\.caseId \|\| stateCaseId, base\.revision/);
  assert.match(app, /resetBuildParams/);
});

test('case changes clear XML/TRACE and task/revision transitions refresh derived views', () => {
  const hook = read('src/hooks/useDeclgen.ts');
  assert.match(hook, /setXml\(''\)/);
  assert.match(hook, /setTrace\(''\)/);
  assert.match(hook, /taskFinished/);
  assert.match(hook, /refreshCaseViews\(\)/);
});

test('new-importer validation failure cannot fall through to submit', () => {
  const modal = read('src/components/NewImporterModal.tsx');
  assert.match(modal, /valid\.ok === false \|\| valid\.errors\?\.length/);
  assert.match(modal, /return;/);
  assert.match(modal, /submitNewImporter\(payload, caseId, baseRevision\)/);
});

test('approval UI reflects backend readiness and backend uses revision preconditions', () => {
  const app = read('src/App.tsx');
  const service = read('electron/backend/declgen-service.ts');
  assert.match(app, /approvalReady = Boolean\(d\.state\.readiness\?\.ready\)/);
  assert.match(app, /disabled=\{!approvalReady/);
  assert.match(service, /assertCaseVersion\(caseId,baseRevision\)/);
  assert.match(service, /currentBlockers\(\)/);
  assert.match(service, /driftBlockers\(fp\)/);
});

test('approval exports a frozen snapshot and freezes the live case only after final copy', () => {
  const service = read('electron/backend/declgen-service.ts');
  const copyIndex = service.indexOf('await fs.copyFile(approvedXml,final)');
  const liveApproveIndex = service.indexOf('this.case.markApproved(); this.case.markExported()', copyIndex);
  assert.ok(copyIndex > 0, 'final Alpha copy not found');
  assert.ok(liveApproveIndex > copyIndex, 'live case must freeze only after the filesystem export succeeds');
  assert.match(service, /const frozenState=new CaseState\(this\.case\.toJSON\(\)\); frozenState\.markApproved\(\); frozenState\.markExported\(\)/);
  assert.match(service, /approved-snapshot\.json/);
});

test('shared modal implements dialog semantics, focus trap/restore and Escape', () => {
  const common = read('src/components/common.tsx');
  assert.match(common, /role="dialog"/);
  assert.match(common, /aria-modal="true"/);
  assert.match(common, /event\.key === 'Escape'/);
  assert.match(common, /event\.key !== 'Tab'/);
  assert.match(common, /previouslyFocused\.current\?\.focus\(\)/);
});
