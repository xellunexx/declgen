import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { declgenApi, download, request } from './api';
import { useDeclgen } from './hooks/useDeclgen';
import { Badge, Button, Card, CodeView, Field } from './components/common';
import { DashboardTab } from './components/DashboardTab';
import { DocumentsTab } from './components/DocumentsTab';
import { InvoiceTab } from './components/InvoiceTab';
import {
  type BuildParams,
  collectBuildPayload,
  DeclarationTab,
} from './components/DeclarationTab';
import { ClassificationTab } from './components/ClassificationTab';
import { CatalogTab } from './components/CatalogTab';
import { ClientsTab } from './components/ClientsTab';
import { LlmTab } from './components/LlmTab';
import { HistoryTab } from './components/HistoryTab';
import { LogsDrawer } from './components/LogsDrawer';
import { NewImporterModal } from './components/NewImporterModal';

const NEW_CLIENT = 'Нова фирма / неизвестен вносител';
type TabId =
  | 'dashboard'
  | 'classification'
  | 'documents'
  | 'invoice'
  | 'declaration'
  | 'catalog'
  | 'clients'
  | 'xml'
  | 'trace'
  | 'llm'
  | 'history';
const TABS: Array<[TabId, string]> = [
  ['dashboard', 'Преглед'],
  ['classification', 'Класификация'],
  ['documents', 'Документи'],
  ['invoice', 'Фактура'],
  ['declaration', 'Декларация'],
  ['catalog', 'СТОКИ'],
  ['clients', 'Клиенти'],
  ['history', 'История'],
  ['xml', 'XML'],
  ['trace', 'TRACE'],
  ['llm', 'LLM хъб'],
];

function makeParams(
  state: ReturnType<typeof useDeclgen>['state'],
): BuildParams {
  const ctxPrev = (
    (state.declaration_context?.previous_documents as Array<{
      type?: string;
      referenceNumber?: string;
    }>) || []
  )[0];
  return {
    fxRate: String(state.fx_rate ?? ''),
    ak: String(state.ak_valuation ?? ''),
    bc: String(state.bc_valuation ?? ''),
    specAll: Boolean(state.spec_all ?? true),
    refs: structuredClone(state.spec_refs || []),
    prevDocType: String(state.prev_doc_type || ctxPrev?.type || 'N337'),
    prevDocRef: String(state.prev_doc_ref || ctxPrev?.referenceNumber || ''),
    autoIdent: Boolean(state.auto_ident ?? true),
  };
}

export default function App() {
  const d = useDeclgen();
  const [tab, setTab] = useState<TabId>('dashboard');
  const tabIds = useMemo(() => TABS.map(([id]) => id), []);

  function focusTab(next: TabId) {
    setTab(next);
    requestAnimationFrame(() =>
      document.getElementById(`tab-${next}`)?.focus(),
    );
  }
  function onTabListKeyDown(e: ReactKeyboardEvent) {
    const i = tabIds.indexOf(tab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(tabIds[(i + 1) % tabIds.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(tabIds[(i - 1 + tabIds.length) % tabIds.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(tabIds[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(tabIds[tabIds.length - 1]);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        setTab((cur) => {
          const i = tabIds.indexOf(cur);
          return tabIds[
            (i + (e.shiftKey ? -1 : 1) + tabIds.length) % tabIds.length
          ];
        });
      } else if (e.ctrlKey && /^[0-9]$/.test(e.key)) {
        const i = e.key === '0' ? 9 : Number(e.key) - 1;
        if (tabIds[i]) {
          e.preventDefault();
          setTab(tabIds[i]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabIds]);
  const [showNewImporter, setShowNewImporter] = useState(false);
  const [buildParams, setBuildParams] = useState<BuildParams>(() =>
    makeParams({}),
  );
  const [buildParamsDirty, setBuildParamsDirty] = useState(false);
  const buildDraftBase = useRef({ caseId: '', revision: 0 });
  const buildScope = useRef('');

  const stateCaseId = String(d.state.case_id || '');
  const stateRevision = Number(d.state.case_revision || 0);
  const canonicalParamsSignature = JSON.stringify(makeParams(d.state));

  useEffect(() => {
    const scopeChanged = buildScope.current !== stateCaseId;
    if (scopeChanged || !buildParamsDirty) {
      buildScope.current = stateCaseId;
      setBuildParams(makeParams(d.state));
      buildDraftBase.current = { caseId: stateCaseId, revision: stateRevision };
      if (scopeChanged) setBuildParamsDirty(false);
    }
  }, [
    stateCaseId,
    stateRevision,
    canonicalParamsSignature,
    buildParamsDirty,
    d.state,
  ]);

  const buildParamsStale =
    buildParamsDirty &&
    (buildDraftBase.current.caseId !== stateCaseId ||
      buildDraftBase.current.revision !== stateRevision);
  const currentClient = d.state.client_id || NEW_CLIENT;
  const clientOptions = useMemo(
    () => [NEW_CLIENT, ...d.clients.filter((x) => x !== NEW_CLIENT)],
    [d.clients],
  );
  const taskActive = Boolean(d.state.task?.active);
  const approvalReady = Boolean(d.state.readiness?.ready);

  function changeBuildParams(next: BuildParams) {
    if (!buildParamsDirty)
      buildDraftBase.current = { caseId: stateCaseId, revision: stateRevision };
    setBuildParamsDirty(true);
    setBuildParams(next);
  }
  function resetBuildParams() {
    setBuildParams(makeParams(d.state));
    setBuildParamsDirty(false);
    buildDraftBase.current = { caseId: stateCaseId, revision: stateRevision };
  }

  async function chooseClient(clientId: string) {
    const result = await d.run(() =>
      declgenApi.selectClient(clientId, String(d.state.direction || 'IM')),
    );
    if (result.ok === false)
      window.alert(result.error || 'Клиентът не може да бъде избран.');
    await d.refreshCatalog(clientId);
  }
  async function chooseDirection(direction: string) {
    const result = await d.run(() =>
      declgenApi.selectClient(currentClient, direction),
    );
    if (result.ok === false)
      window.alert(result.error || 'Посоката не може да бъде сменена.');
  }
  async function extract() {
    if (!Object.keys(d.state.dossier || {}).length) {
      setTab('documents');
      window.alert('Първо заредете папка или файлове в Документи.');
      return;
    }
    const result = await d.run(() => declgenApi.extract());
    if (result.ok === false)
      window.alert(result.error || 'Грешка при извличане.');
    setTab('dashboard');
  }

  async function build() {
    if (!d.state.invoice) {
      window.alert('Първо извлечете фактура с ①.');
      setTab('documents');
      return;
    }
    if (buildParamsStale) {
      window.alert(
        'Параметрите за build са започнати върху по-стара ревизия. Отворете Декларация → Отказ на промените и въведете корекцията отново.',
      );
      setTab('declaration');
      return;
    }
    if (currentClient === NEW_CLIENT && !d.state.general_submitted) {
      setShowNewImporter(true);
      return;
    }
    const base = buildDraftBase.current;
    const result = await d.run(() =>
      declgenApi.build(
        collectBuildPayload(buildParams),
        base.caseId || stateCaseId,
        base.revision,
      ),
    );
    if (result.ok === false)
      return window.alert(result.error || 'Грешка при генериране.');
    setBuildParamsDirty(false);
    setTab('dashboard');
    await d.refreshXmlTrace();
  }

  async function approve() {
    if (!approvalReady) {
      window.alert(
        `Export-ът е блокиран:\n${(d.state.readiness?.blockers || ['Случаят не е READY.']).map((x) => `• ${x}`).join('\n')}`,
      );
      return;
    }
    const tag = window.prompt(
      'Суфикс за името на XML файла:',
      d.state.invoice?.invoice_number || 'draft',
    );
    if (tag === null) return;
    const result = await d.run(() =>
      declgenApi.approve(tag, stateCaseId, stateRevision),
    );
    if (result.ok)
      window.alert(
        `Декларацията е одобрена и копирана в:\n${result.file_path || 'Alpha export directory'}`,
      );
    else window.alert(result.error || 'Грешка при одобрение.');
  }

  async function clearCase() {
    if (!window.confirm('Изчистване на текущата поръчка и досие?')) return;
    const hasContent =
      Boolean(d.state.invoice) ||
      Boolean(d.xml) ||
      Object.keys(d.state.dossier || {}).length > 0;
    if (hasContent && window.confirm('Запази текущия случай в История?')) {
      const s = await d.run(() => declgenApi.historySave());
      if (s.ok === false) {
        window.alert(
          s.error || 'Записът в историята не успя — поръчката НЕ е изчистена.',
        );
        return;
      }
    }
    const res = await d.run(() => declgenApi.clear());
    if (res.ok === false)
      return window.alert(res.error || 'Случаят не можа да бъде изчистен.');
    d.resetCaseViews();
    setBuildParams(makeParams({}));
    setBuildParamsDirty(false);
    setShowNewImporter(false);
    setTab('dashboard');
  }
  async function casePackage() {
    const buildRes = await request('/api/case_package', 'POST');
    if (buildRes.ok === false)
      return window.alert(buildRes.error || 'Неуспешно пакетиране.');
    const saved = await download(
      '/api/download/case_package',
      `declgen-case-${d.state.invoice?.invoice_number || 'draft'}.zip`,
    );
    if (saved.ok && saved.filePath)
      window.alert(`Case package:\n${saved.filePath}`);
    else if (saved.error) window.alert(saved.error);
  }
  async function wanAction() {
    if (d.state.wan_url) {
      await navigator.clipboard.writeText(d.state.wan_url);
      window.alert(
        `WAN адресът е копиран:\n${d.state.wan_url}${d.state.wan_urls?.lan ? `\n\nLAN: ${d.state.wan_urls.lan}` : ''}`,
      );
      return;
    }
    const res = await declgenApi.toggleWan('start');
    if (res.ok === false) window.alert(res.error || 'WAN не можа да стартира.');
    await d.refreshState();
  }

  function renderTab() {
    const staleOutput = Boolean(d.state.has_decl && !approvalReady);
    switch (tab) {
      case 'dashboard':
        return (
          <DashboardTab
            dashboard={d.dashboard}
            state={d.state}
            onNavigate={(t) => setTab(t as TabId)}
          />
        );
      case 'documents':
        return (
          <DocumentsTab state={d.state} run={d.run} refresh={d.refreshState} />
        );
      case 'invoice':
        return (
          <InvoiceTab
            invoice={d.state.invoice}
            caseId={stateCaseId}
            revision={stateRevision}
            run={d.run}
            refresh={d.refreshState}
          />
        );
      case 'declaration':
        return (
          <DeclarationTab
            state={d.state}
            params={buildParams}
            paramsDirty={buildParamsDirty}
            paramsStale={buildParamsStale}
            onParamsChange={changeBuildParams}
            onResetParams={resetBuildParams}
            onParamsBaseSync={(caseId, revision) => {
              buildDraftBase.current = { caseId, revision };
            }}
            onStateRefresh={d.refreshState}
          />
        );
      case 'classification':
        return (
          <ClassificationTab
            rows={d.classification}
            dirty={d.classificationDirty}
            caseId={stateCaseId}
            revision={stateRevision}
            refresh={async () => {
              await d.refreshState();
              await d.refreshClassification();
              await d.refreshXmlTrace();
            }}
          />
        );
      case 'catalog':
        return (
          <CatalogTab
            entries={d.catalog}
            refresh={async () => {
              await d.refreshCatalog();
              await d.refreshClassification();
            }}
          />
        );
      case 'clients':
        return (
          <ClientsTab
            clients={d.clients}
            detail={d.clientDetail}
            loadDetail={d.loadClientDetail}
            refresh={d.refreshClients}
          />
        );
      case 'xml':
        return (
          <Card
            title="Генериран XML"
            action={<Button onClick={() => void d.refreshXmlTrace()}>↻</Button>}
          >
            {staleOutput && (
              <div className="callout warning">
                Този XML не е READY за export:{' '}
                {(d.state.readiness?.blockers || []).join(' · ')}
              </div>
            )}
            <CodeView text={d.xml} placeholder="XML ще се появи след ②." />
          </Card>
        );
      case 'trace':
        return (
          <Card
            title="Case TRACE"
            action={<Button onClick={() => void d.refreshXmlTrace()}>↻</Button>}
          >
            {staleOutput && (
              <div className="callout warning">
                TRACE е за не-READY/стара декларация.
              </div>
            )}
            <CodeView text={d.trace} placeholder="TRACE ще се появи след ②." />
          </Card>
        );
      case 'llm':
        return <LlmTab status={d.llmStatus} refresh={d.refreshLlm} />;
      case 'history':
        return <HistoryTab />;
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>declgen</strong>
          <span>митническа декларация · human gate</span>
        </div>
        <div className="step-title">1 · ДОСИЕ И КЛИЕНТ</div>
        <Field label="Клиент">
          <select
            value={currentClient}
            onChange={(e) => void chooseClient(e.target.value)}
          >
            {clientOptions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Посока">
          <select
            value={String(d.state.direction || 'IM')}
            onChange={(e) => void chooseDirection(e.target.value)}
          >
            <option value="IM">Внос (BG415A / IM)</option>
            <option value="EX">Износ (BG515C / EX)</option>
          </select>
        </Field>
        <Button
          kind="primary"
          disabled={taskActive || d.busy || d.state.stage === 'EXPORTED'}
          onClick={() => void extract()}
        >
          ① Извлечи документите
        </Button>
        <Button
          kind="danger"
          disabled={!taskActive}
          onClick={() => void declgenApi.stopTask()}
        >
          ■ Стоп задача
        </Button>
        <Button onClick={() => void clearCase()}>🧹 Нова поръчка</Button>
        <div className="step-title">2 · ПРЕГЛЕД И СГЛОБЯВАНЕ</div>
        <Button
          kind="primary"
          disabled={
            taskActive ||
            d.busy ||
            !d.state.invoice ||
            buildParamsStale ||
            d.state.stage === 'EXPORTED'
          }
          onClick={() => void build()}
        >
          ② Генерирай декларация
        </Button>
        <label className="check">
          <input
            type="checkbox"
            checked={buildParams.autoIdent}
            onChange={(e) =>
              changeBuildParams({ ...buildParams, autoIdent: e.target.checked })
            }
          />{' '}
          Авто-идентификация на нови стоки
        </label>
        {currentClient === NEW_CLIENT && d.state.general_submitted && (
          <Button onClick={() => setShowNewImporter(true)}>
            ✎ H1 данни за нова фирма
          </Button>
        )}
        <div className="step-title">3 · ФИНАЛЕН КОНТРОЛ</div>
        <Button
          kind="success"
          disabled={!approvalReady || taskActive || d.busy}
          title={
            approvalReady
              ? 'READY'
              : (d.state.readiness?.blockers || []).join('\n')
          }
          onClick={() => void approve()}
        >
          ③ Одобри → Alpha
        </Button>
        <Button disabled={!d.state.has_decl} onClick={() => void casePackage()}>
          📦 Case package
        </Button>
        <div className="sidebar-spacer" />
        <button
          className={`wan-pill wan-${d.state.wan_status || 'off'}`}
          onClick={() => void wanAction()}
          title={d.state.wan_url || ''}
        >
          <span>●</span>
          {d.state.wan_url
            ? 'WAN споделен линк — копирай'
            : 'WAN: само локално'}
        </button>
        <div className="task-box">
          {taskActive ? (
            <>
              <span className="spinner" />{' '}
              <strong>{d.state.task?.active}</strong>
              <small>{d.state.task?.progress || 'изпълнение…'}</small>
            </>
          ) : (
            <>
              <span>{approvalReady ? '✓' : '•'}</span>
              <span>
                {d.state.task?.status === 'error'
                  ? d.state.task.error
                  : `${d.state.stage || 'NEW'} · rev ${stateRevision}`}
              </span>
            </>
          )}
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="connection">
            <Badge tone={d.connected ? 'success' : 'danger'}>
              {d.connected ? 'Ядро: връзка OK' : 'Ядро: няма връзка'}
            </Badge>
          </div>
          <div className="api-config">
            <Badge tone={approvalReady ? 'success' : 'neutral'}>
              {approvalReady
                ? 'Готово за одобрение'
                : `${d.state.stage || 'NEW'} · ред. ${stateRevision}`}
            </Badge>
          </div>
        </header>
        <nav
          className="tabs"
          role="tablist"
          aria-label="Инструменти"
          onKeyDown={onTabListKeyDown}
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'classification' &&
              (d.state.unresolved_count || 0) > 0 ? (
                <span className="tab-count">{d.state.unresolved_count}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div
          className="workspace"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {renderTab()}
        </div>
      </main>
      <LogsDrawer logs={d.logs} />
      {showNewImporter && (
        <NewImporterModal
          invoice={d.state.invoice}
          caseId={stateCaseId}
          revision={stateRevision}
          onClose={() => setShowNewImporter(false)}
          onSubmitted={async () => {
            const latest = await d.refreshState();
            if (latest.ok === false) return;
            buildDraftBase.current = {
              caseId: String(latest.case_id || ''),
              revision: Number(latest.case_revision || 0),
            };
            const result = await d.run(() =>
              declgenApi.build(
                collectBuildPayload(buildParams),
                buildDraftBase.current.caseId,
                buildDraftBase.current.revision,
              ),
            );
            if (result.ok === false)
              window.alert(result.error || 'Грешка при генериране.');
            else setBuildParamsDirty(false);
            setTab('dashboard');
            await d.refreshXmlTrace();
          }}
        />
      )}
    </div>
  );
}
