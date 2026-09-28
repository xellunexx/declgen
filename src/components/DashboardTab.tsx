import type { AppState, Dashboard } from '../types';
import { Badge, Card, Empty } from './common';

export function DashboardTab({ dashboard, state, onNavigate }: { dashboard: Dashboard; state: AppState; onNavigate?: (tab: string) => void }) {
  // Click-through: every blocker/warning opens the hub that owns the fix. Heuristic, declared, honest.
  const hubFor = (text: string): string => {
    const t = text.toLowerCase();
    if (t.includes('класификац')) return 'classification';
    if (t.includes('опаковачен лист') || t.includes('packing')) return 'documents';
    if (t.includes('conformance') || t.includes('декларация')) return 'declaration';
    if (t.includes('фактур') || t.includes('нето') || t.includes('нет kg')) return 'invoice';
    if (t.includes('документ') || t.includes('досие') || t.includes('source')) return 'documents';
    if (t.includes('клиент') || t.includes('фирма')) return 'clients';
    if (t.includes('каталог') || t.includes('сток')) return 'catalog';
    if (t.includes('llm') || t.includes('модел')) return 'llm';
    return 'declaration';
  };
  const hubLabel: Record<string, string> = { classification: 'Класификация', declaration: 'Декларация', invoice: 'Фактура', documents: 'Документи', clients: 'Клиенти', catalog: 'СТОКИ', llm: 'LLM хъб' };
  // Render warnings with a concrete next step — “what to do” is part of the message.
  const hintFor = (text: string): string => {
    const t = text.toLowerCase();
    if (t.includes('hs от фактурата')) return ' → потвърдете го в Класификация (или ✔ Потвърди всички)';
    if (t.includes('разпределена пропорционално') || t.includes('надвишава сбора')) return ' → разликата е включена в цените на позициите — проверете ги в Декларация';
    if (t.includes('нямат съответствие')) return ' → игнорирани редове от packing list (обикновено TOTAL) — действие не е нужно';
    if (t.includes('нямат нето тегло')) return ' → попълнете нето теглото на тези редове в Декларация (Потвърди позициите)';
    if (t.includes('не съответства на фактурата')) return ' → изберете правилния packing list в Документи';
    if (t.includes('по-малко от нето')) return ' → проверете бруто/нето теглата в packing list (Документи)';
    if (t.includes('колети не е число')) return ' → проверете броя колети в Документи';
    if (t.includes('packing') || t.includes('нет kg') || t.includes('нето')) return ' → проверете packing list документа в Документи';
    if (t.includes('курс') || t.includes('bnb') || t.includes('бнб')) return ' → въведете курса ръчно в Декларация → Курс';
    return ` → отворете ${hubLabel[hubFor(text)] || 'Декларация'}`;
  };
  const dossier = dashboard.dossier || {}; const invoice = dashboard.invoice || {}; const blockers = dashboard.blockers || state.readiness?.blockers || []; const warnings = dashboard.warnings || [];
  const reconciliation = dashboard.reconciliation || []; const changes = dashboard.changes || []; const readiness = state.readiness || dashboard.readiness;
  let heroTone: 'neutral' | 'info' | 'warning' | 'danger' | 'success' = 'neutral'; let heroTitle = 'Очаква се зареждане на документи'; let heroText = 'Заредете досие и стартирайте ① Извлечи документите.';
  if ((dossier.files_count || 0) > 0 && !state.invoice?.invoice_number) { heroTone = 'info'; heroTitle = 'Досието е заредено'; heroText = 'Документите са готови за извличане и проверка.'; }
  if (state.invoice?.invoice_number && !state.has_decl) { heroTone = 'info'; heroTitle = `Фактура № ${state.invoice.invoice_number} е извлечена`; heroText = 'Проверете данните и генерирайте декларация с ②.'; }
  if (state.has_decl && readiness?.ready) { heroTone = 'success'; heroTitle = 'Декларацията е READY за финално одобрение'; heroText = 'Build и conformance са за текущата ревизия и няма блокери.'; }
  else if (state.has_decl && (state.unresolved_count || 0) > 0) { heroTone = 'warning'; heroTitle = `Декларацията чака ${state.unresolved_count} човешки решения`; heroText = 'Отворете Класификация и потвърдете рисковите позиции.'; }
  else if (state.has_decl && blockers.length) { heroTone = 'danger'; heroTitle = 'Декларацията НЕ е готова за export'; heroText = blockers[0] || 'Има блокиращо условие.'; }
  else if (state.has_decl) { heroTone = 'warning'; heroTitle = `Декларация · ${state.stage || 'невалидирана'}`; heroText = 'Изчакайте/пуснете conformance за текущата ревизия.'; }

  return <div className="stack gap-lg"><div className={`hero hero-${heroTone}`}><div><Badge tone={heroTone === 'neutral' ? 'neutral' : heroTone}>{readiness?.ready ? 'READY' : (state.has_decl ? 'DECL' : 'CASE')}</Badge></div><div><h2>{heroTitle}</h2><p>{heroText}</p></div></div>
    <div className="kpi-grid"><Card title="Клиент"><div className="kpi">{dashboard.client?.name || state.client_id || '—'}</div><small>{dashboard.client?.eori || 'EORI —'}</small></Card><Card title="Досие"><div className="kpi">{dossier.files_count || Object.keys(state.dossier || {}).length}</div><small>файла</small></Card><Card title="Фактура"><div className="kpi">{invoice.number || state.invoice?.invoice_number || '—'}</div><small>{invoice.lines_count || state.invoice?.lines?.length || 0} позиции</small></Card><Card title="Ревизия"><div className="kpi">{state.case_revision ?? 0}</div><small>{state.stage || 'NEW'}</small></Card></div>
    <div className="two-col"><Card title="Блокери">{blockers.length ? <ul className="issue-list danger">{blockers.map((x, i) => <li key={i} role="button" tabIndex={0} title="Отвори съответния хъб" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.(hubFor(x))} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate?.(hubFor(x)); }}>{x} <span style={{ opacity: 0.55 }}>→</span></li>)}</ul> : <div className="ok-line">✓ Няма блокери.</div>}</Card><Card title="Предупреждения">{warnings.length ? <ul className="issue-list warning">{warnings.slice(0, 20).map((x, i) => <li key={i} role="button" tabIndex={0} title="Отвори съответния хъб" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.(hubFor(x))} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate?.(hubFor(x)); }}>{x}<span style={{ opacity: 0.55 }}>{hintFor(x)}</span></li>)}</ul> : <div className="ok-line">✓ Няма предупреждения.</div>}</Card></div>
    <div className="two-col"><Card title="Фактура → декларация">{reconciliation.length ? <div className="table-scroll"><table><thead><tr><th>Поле</th><th>Източник</th><th>Декларация</th><th>Δ</th><th>Статус</th></tr></thead><tbody>{reconciliation.map((r, i) => <tr key={i}><td>{r.metric}</td><td>{r.source}</td><td>{r.decl}</td><td>{r.diff}</td><td><Badge tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'OK' : 'Разлика'}</Badge></td></tr>)}</tbody></table></div> : <Empty>Няма изчислено съпоставяне.</Empty>}</Card>
    <Card title="Произход на класификацията">{changes.length ? <div className="table-scroll"><table><thead><tr><th>#</th><th>Фактура HS</th><th>Декларация HS</th><th>Основание</th><th>Описание</th></tr></thead><tbody>{changes.map((c, i) => <tr key={i}><td>{c.line_no}</td><td>{c.inv_hs || '—'}</td><td>{c.decl_hs || '—'}</td><td>{c.reason || '—'}</td><td>{c.desc || '—'}</td></tr>)}</tbody></table></div> : <Empty>Няма класификационни промени.</Empty>}</Card></div>
  </div>;
}
