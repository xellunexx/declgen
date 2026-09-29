import { useEffect, useRef, useState } from 'react';
import { declgenApi } from '../api';
import type { AppState, SpecRef } from '../types';
import { Badge, Button, Card, ComboField, Empty, Field, Modal } from './common';
import { COUNTRIES, DEAL_TYPES, INCOTERMS } from '../refs';

// UI number formatting: never show raw f6 noise like "551.999999".
export function fmtKg(v: unknown): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n
    .toFixed(3)
    .replace(/\.\d*?[1-9]$/, (m) => m)
    .replace(/\.?0+$/, '');
}

type FlatContext = Record<string, string>;

function flattenContext(initial: Record<string, unknown>): FlatContext {
  const bt = (initial.border_transport || {}) as Record<string, unknown>;
  const dt = (initial.delivery_terms || {}) as Record<string, unknown>;
  const at = (initial.arrival_transport || {}) as Record<string, unknown>;
  return {
    lodging_office: String(initial.lodging_office ?? ''),
    nature_of_transaction: String(initial.nature_of_transaction ?? ''),
    border_mode: String(bt.mode ?? ''),
    border_nationality: String(bt.nationality ?? ''),
    inland_mode: String(initial.inland_mode ?? ''),
    container_indicator: String(initial.container_indicator ?? ''),
    arrival_id: String(at.IdeOfMeaOfTraAtArrival ?? ''),
    arrival_code: String(at.IdeOfMeaOfTraAtArrivalCode ?? ''),
    dispatch: String(initial.country_of_dispatch ?? ''),
    destination: String(initial.destination_country ?? ''),
    incoterm: String(dt.incotermCode ?? ''),
    terms_country: String(dt.country ?? ''),
    terms_location: String(dt.location ?? ''),
  };
}

function setOrDelete(
  target: Record<string, unknown>,
  key: string,
  value: string,
) {
  if (value === '') delete target[key];
  else target[key] = value;
}

type DocRow = { type: string; referenceNumber: string };

function docsFrom(initial: Record<string, unknown>): DocRow[] {
  return ((initial.previous_documents as DocRow[]) || []).map((d) => ({
    type: String(d?.type ?? ''),
    referenceNumber: String(d?.referenceNumber ?? ''),
  }));
}

function H1ContextModal({
  initial,
  caseId,
  revision,
  onClose,
  onSaved,
}: {
  initial: Record<string, unknown>;
  caseId: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ctx, setCtx] = useState<FlatContext>(() => flattenContext(initial));
  const [docs, setDocs] = useState<DocRow[]>(() => docsFrom(initial));
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const scopeRef = useRef(caseId);
  const signature = JSON.stringify(initial);

  useEffect(() => {
    const scopeChanged = scopeRef.current !== caseId;
    if (scopeChanged || !dirty) {
      scopeRef.current = caseId;
      setCtx(flattenContext(initial));
      setDocs(docsFrom(initial));
      setBaseRevision(revision);
      if (scopeChanged) setDirty(false);
    }
  }, [caseId, revision, signature, dirty, initial]);

  const fields: Array<[string, string]> = [
    ['lodging_office', 'Митническо учреждение'],
    ['nature_of_transaction', 'Вид сделка'],
    ['border_mode', 'Транспорт на границата'],
    ['border_nationality', 'Националност'],
    ['inland_mode', 'Вътрешен транспорт'],
    ['container_indicator', 'Контейнер 0/1'],
    ['arrival_id', 'МПС при пристигане'],
    ['arrival_code', 'Код на идентификатора'],
    ['dispatch', 'Държава изпращане'],
    ['destination', 'Държава получаване'],
    ['incoterm', 'Incoterm'],
    ['terms_country', 'Държава по Incoterm'],
    ['terms_location', 'Място по Incoterm'],
  ];

  async function save() {
    const next = structuredClone(initial) as Record<string, unknown>;
    setOrDelete(next, 'lodging_office', ctx.lodging_office);
    setOrDelete(next, 'nature_of_transaction', ctx.nature_of_transaction);
    setOrDelete(next, 'inland_mode', ctx.inland_mode);
    setOrDelete(next, 'container_indicator', ctx.container_indicator);
    setOrDelete(next, 'country_of_dispatch', ctx.dispatch);
    setOrDelete(next, 'destination_country', ctx.destination);

    const border = {
      ...((next.border_transport || {}) as Record<string, unknown>),
    };
    setOrDelete(border, 'mode', ctx.border_mode);
    setOrDelete(border, 'nationality', ctx.border_nationality);
    if (Object.keys(border).length) next.border_transport = border;
    else delete next.border_transport;
    const arrival = {
      ...((next.arrival_transport || {}) as Record<string, unknown>),
    };
    setOrDelete(arrival, 'IdeOfMeaOfTraAtArrival', ctx.arrival_id);
    setOrDelete(arrival, 'IdeOfMeaOfTraAtArrivalCode', ctx.arrival_code);
    if (Object.keys(arrival).length) next.arrival_transport = arrival;
    else delete next.arrival_transport;
    const delivery = {
      ...((next.delivery_terms || {}) as Record<string, unknown>),
    };
    setOrDelete(delivery, 'incotermCode', ctx.incoterm);
    setOrDelete(delivery, 'country', ctx.terms_country);
    setOrDelete(delivery, 'location', ctx.terms_location);
    if (Object.keys(delivery).length) next.delivery_terms = delivery;
    else delete next.delivery_terms;

    const prevDocs = docs
      .map((d) => ({
        type: d.type.trim().toUpperCase(),
        referenceNumber: d.referenceNumber.trim(),
      }))
      .filter((d) => d.type || d.referenceNumber);
    if (prevDocs.some((d) => !d.type || !d.referenceNumber))
      return window.alert(
        'Всеки предишен документ изисква и вид (напр. N337), и референция.',
      );
    if (prevDocs.length) next.previous_documents = prevDocs;
    else delete next.previous_documents;

    const res = await declgenApi.saveH1Context(next, caseId, baseRevision);
    if (res.ok === false)
      return window.alert(res.error || 'Грешка при запис на H1 контекст.');
    setDirty(false);
    onSaved();
    onClose();
  }

  return (
    <Modal title="H1 контекст за тази пратка" onClose={onClose} wide>
      {dirty && revision !== baseRevision && (
        <div className="callout warning">
          Каноничното състояние се промени, докато редактирате. Записът ще бъде
          отказан; затворете и отворете диалога отново.
        </div>
      )}
      <div className="form-grid">
        {fields.map(([key, label]) => {
          const combo =
            key === 'incoterm'
              ? INCOTERMS
              : key === 'nature_of_transaction'
                ? DEAL_TYPES
                : ['dispatch', 'destination', 'terms_country'].includes(key)
                  ? COUNTRIES
                  : null;
          return combo ? (
            <ComboField
              key={key}
              label={label}
              value={ctx[key] ?? ''}
              options={combo}
              onChange={(v) => {
                setDirty(true);
                setCtx((p) => ({ ...p, [key]: v }));
              }}
            />
          ) : (
            <Field key={key} label={label}>
              <input
                value={ctx[key] ?? ''}
                onChange={(e) => {
                  setDirty(true);
                  setCtx((p) => ({ ...p, [key]: e.target.value }));
                }}
              />
            </Field>
          );
        })}
      </div>
      <div className="subsection-head">
        <strong>Предишни документи (D.E. 2/7)</strong>
        <Button
          onClick={() => {
            setDirty(true);
            setDocs((p) => [...p, { type: 'N337', referenceNumber: '' }]);
          }}
        >
          ＋
        </Button>
      </div>
      {docs.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Вид</th>
                <th>Референция</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={d.type}
                      onChange={(e) => {
                        setDirty(true);
                        setDocs((p) =>
                          p.map((x, j) =>
                            j === i ? { ...x, type: e.target.value } : x,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      value={d.referenceNumber}
                      onChange={(e) => {
                        setDirty(true);
                        setDocs((p) =>
                          p.map((x, j) =>
                            j === i
                              ? { ...x, referenceNumber: e.target.value }
                              : x,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      kind="danger"
                      onClick={() => {
                        setDirty(true);
                        setDocs((p) => p.filter((_, j) => j !== i));
                      }}
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint">
          Профилът Evelin изисква N337 референция на предходно митническо
          оформление (напр. EX декларация).
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Отказ</Button>
        <Button
          kind="primary"
          disabled={!dirty || revision !== baseRevision}
          onClick={save}
        >
          Потвърди контекста
        </Button>
      </div>
    </Modal>
  );
}

type GoodsRow = {
  item_no?: unknown;
  hs_code?: unknown;
  decl_hs?: unknown;
  description?: unknown;
  net_kg?: unknown;
  gross_kg?: unknown;
  price?: unknown;
  statistical_value?: unknown;
  origin?: unknown;
};
const DECL_EDIT_FIELDS: Array<[string, string]> = [
  ['description', 'Описание'],
  ['net_kg', 'Нето'],
  ['gross_kg', 'Бруто'],
  ['price', 'Цена'],
  ['statistical_value', 'Стат. стойност'],
  ['origin', 'Произход'],
];

// Editable declaration positions: the human is source of truth; header totals follow the edit
// server-side and conformance re-runs immediately. HS stays owned by the Класификация hub.
function DeclItemsCard({
  goods,
  state,
  onStateRefresh,
}: {
  goods: GoodsRow[];
  state: AppState;
  onStateRefresh: () => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const scopeRef = useRef(String(state.case_id || ''));
  useEffect(() => {
    if (scopeRef.current !== String(state.case_id || '')) {
      scopeRef.current = String(state.case_id || '');
      setDrafts({});
    }
  }, [state.case_id]);
  const cell = (i: number, f: string, base: unknown) =>
    drafts[i]?.[f] ?? String(base ?? '');
  const setCell = (i: number, f: string, v: string, base: unknown) =>
    setDrafts((p) => {
      const n = { ...p };
      const row = { ...(n[i] || {}) };
      if (v === String(base ?? '')) delete row[f];
      else row[f] = v;
      if (Object.keys(row).length) n[i] = row;
      else delete n[i];
      return n;
    });
  const dirtyCount = Object.keys(drafts).length;
  async function save() {
    const items = Object.entries(drafts).map(([i, patch]) => ({
      item_no: Number((goods[Number(i)] as GoodsRow)?.item_no ?? Number(i) + 1),
      patch,
    }));
    setSaving(true);
    try {
      const res = await declgenApi.declItemsUpdate(
        items,
        String(state.case_id || ''),
        Number(state.case_revision || 0),
      );
      if (res.ok === false)
        return window.alert(res.error || 'Записът не успя.');
      setDrafts({});
      await onStateRefresh();
      window.alert(
        res.errors
          ? `Записано, но има ${res.errors} conformance грешки — вижте отдолу.`
          : 'Записано. Conformance: чисто.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card
      title={`Декларационни позиции (${goods.length})`}
      action={
        dirtyCount ? (
          <Button kind="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Запис…' : `Потвърди позициите (${dirtyCount})`}
          </Button>
        ) : undefined
      }
    >
      {!goods.length ? (
        <Empty>Няма позиционни редове. Натиснете ②.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="editable-table">
            <thead>
              <tr>
                <th>№</th>
                <th>HS</th>
                <th>Описание</th>
                <th>Нето</th>
                <th>Бруто</th>
                <th>Цена</th>
                <th>Стат. стойност</th>
                <th>Произход</th>
              </tr>
            </thead>
            <tbody>
              {goods.map((g, i) => (
                <tr key={i}>
                  <td>{String(g.item_no || i + 1)}</td>
                  <td>{String(g.hs_code || g.decl_hs || '—')}</td>
                  {DECL_EDIT_FIELDS.map(([f]) => (
                    <td key={f}>
                      <input
                        value={cell(i, f, (g as Record<string, unknown>)[f])}
                        onChange={(e) =>
                          setCell(
                            i,
                            f,
                            e.target.value,
                            (g as Record<string, unknown>)[f],
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export interface BuildParams {
  fxRate: string;
  ak: string;
  bc: string;
  specAll: boolean;
  refs: SpecRef[];
  prevDocType: string;
  prevDocRef: string;
  autoIdent: boolean;
}

export function DeclarationTab({
  state,
  params,
  paramsDirty,
  paramsStale,
  onParamsChange,
  onResetParams,
  onParamsBaseSync,
  onStateRefresh,
}: {
  state: AppState;
  params: BuildParams;
  paramsDirty: boolean;
  paramsStale: boolean;
  onParamsChange: (params: BuildParams) => void;
  onResetParams: () => void;
  onParamsBaseSync?: (caseId: string, revision: number) => void;
  onStateRefresh: () => Promise<unknown>;
}) {
  const { fxRate, ak, bc, specAll, refs, prevDocType, prevDocRef } = params;
  const [showContext, setShowContext] = useState(false);
  const [savingPrevDoc, setSavingPrevDoc] = useState(false);
  const goods = state.report?.goods_items || [];
  const ctxDocs =
    (state.declaration_context?.previous_documents as DocRow[]) || [];
  const docType = prevDocType.trim().toUpperCase();
  const savedDocRef = String(
    ctxDocs.find((d) => String(d?.type || '').toUpperCase() === docType)
      ?.referenceNumber || '',
  );
  const refConfirmed =
    !!docType && !!prevDocRef.trim() && savedDocRef === prevDocRef.trim();
  const cessionRef = String(state.cession?.mrn_item || '');
  async function confirmPrevDoc() {
    const ref = prevDocRef.trim();
    if (!docType || !ref)
      return window.alert(
        'Въведете вид (N337) и референция от цесията — MRN / позиция.',
      );
    const next = structuredClone(
      (state.declaration_context || {}) as Record<string, unknown>,
    );
    const docs = ((next.previous_documents as DocRow[]) || [])
      .map((d) => ({
        type: String(d?.type || '').trim().toUpperCase(),
        referenceNumber: String(d?.referenceNumber || '').trim(),
      }))
      .filter((d) => d.type && d.type !== docType);
    docs.push({ type: docType, referenceNumber: ref });
    next.previous_documents = docs;
    setSavingPrevDoc(true);
    try {
      const res = await declgenApi.saveH1Context(
        next,
        String(state.case_id || ''),
        Number(state.case_revision || 0),
      );
      if (res.ok === false)
        return window.alert(
          res.error || 'Грешка при запис на предишен документ.',
        );
      const fresh = (await onStateRefresh()) as AppState | undefined;
      onParamsBaseSync?.(
        String(fresh?.case_id || state.case_id || ''),
        Number(fresh?.case_revision ?? 0),
      );
    } finally {
      setSavingPrevDoc(false);
    }
  }
  async function clearPrevDoc() {
    if (!docType || !savedDocRef) return;
    if (!window.confirm(`Изчистване на записания ${docType} от случая?`))
      return;
    const next = structuredClone(
      (state.declaration_context || {}) as Record<string, unknown>,
    );
    const docs = ((next.previous_documents as DocRow[]) || []).filter(
      (d) => String(d?.type || '').toUpperCase() !== docType,
    );
    if (docs.length) next.previous_documents = docs;
    else delete next.previous_documents;
    setSavingPrevDoc(true);
    try {
      const res = await declgenApi.saveH1Context(
        next,
        String(state.case_id || ''),
        Number(state.case_revision || 0),
      );
      if (res.ok === false)
        return window.alert(
          res.error || 'Грешка при изчистване на предишен документ.',
        );
      const fresh = (await onStateRefresh()) as AppState | undefined;
      onParamsBaseSync?.(
        String(fresh?.case_id || state.case_id || ''),
        Number(fresh?.case_revision ?? 0),
      );
    } finally {
      setSavingPrevDoc(false);
    }
  }
  return (
    <div className="stack gap-lg">
      <Card
        title={
          <div className="inline">
            Параметри за генериране{' '}
            {paramsDirty && (
              <Badge tone={paramsStale ? 'danger' : 'warning'}>
                {paramsStale ? 'ОСТАРЯЛА ЧЕРНОВА' : 'НЕПОТВЪРДЕНО'}
              </Badge>
            )}
          </div>
        }
        action={
          <div className="inline">
            {paramsDirty && (
              <Button onClick={onResetParams}>Отказ на промените</Button>
            )}
            <Button onClick={() => setShowContext(true)}>H1 контекст…</Button>
          </div>
        }
      >
        {paramsStale && (
          <div className="callout danger">
            Случаят се промени след започване на тази чернова. Върнете текущите
            стойности и въведете корекциите отново.
          </div>
        )}
        <div className="form-grid">
          <Field label="Курс → EUR">
            <input
              value={fxRate}
              onChange={(e) =>
                onParamsChange({ ...params, fxRate: e.target.value })
              }
            />
          </Field>
          <Field label="AK фрахт">
            <input
              value={ak}
              onChange={(e) =>
                onParamsChange({ ...params, ak: e.target.value })
              }
            />
          </Field>
          <Field label="BC застраховка">
            <input
              value={bc}
              onChange={(e) =>
                onParamsChange({ ...params, bc: e.target.value })
              }
            />
          </Field>
          <Field label="Box 44 scope">
            <label className="check">
              <input
                type="checkbox"
                checked={specAll}
                onChange={(e) =>
                  onParamsChange({ ...params, specAll: e.target.checked })
                }
              />{' '}
              към всички HS кодове
            </label>
          </Field>
          <Field
            label="Предишен документ — вид"
            hint="N337 = декларация за временно складиране (цесия)"
          >
            <input
              value={prevDocType}
              onChange={(e) =>
                onParamsChange({ ...params, prevDocType: e.target.value })
              }
            />
          </Field>
          <Field
            label="Предишен документ — референция (цесия MRN)"
            hint="MRN / позиция от цесията на куриера, напр. 26BG005100713106U0 / 14"
          >
            <input
              value={prevDocRef}
              placeholder="напр. 26BG005100713106U0 / 14"
              onChange={(e) =>
                onParamsChange({ ...params, prevDocRef: e.target.value })
              }
            />
            <div className="inline">
              <Button
                kind={refConfirmed ? 'success' : 'primary'}
                disabled={savingPrevDoc || refConfirmed || !prevDocRef.trim()}
                onClick={(e) => {
                  e.preventDefault();
                  void confirmPrevDoc();
                }}
              >
                {savingPrevDoc
                  ? 'Запис…'
                  : refConfirmed
                    ? 'Потвърдено'
                    : 'Потвърди'}
              </Button>
              {savedDocRef && (
                <Button
                  kind="ghost"
                  disabled={savingPrevDoc}
                  onClick={(e) => {
                    e.preventDefault();
                    void clearPrevDoc();
                  }}
                >
                  Изчисти
                </Button>
              )}
              {savedDocRef ? (
                <Badge tone={refConfirmed ? 'success' : 'warning'}>
                  {refConfirmed
                    ? 'записано в случая'
                    : `в случая: ${savedDocRef}`}
                </Badge>
              ) : cessionRef && prevDocRef.trim() === cessionRef ? (
                <Badge tone="success">от цесията в досието</Badge>
              ) : (
                <Badge tone="warning">не е записано</Badge>
              )}
            </div>
          </Field>
        </div>
        <div className="subsection-head">
          <strong>Специални референции</strong>
          <Button
            onClick={() =>
              onParamsChange({
                ...params,
                refs: [...refs, { code: 'Y160', reference: '' }],
              })
            }
          >
            ＋
          </Button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Референция</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {refs.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={r.code || ''}
                      onChange={(e) =>
                        onParamsChange({
                          ...params,
                          refs: refs.map((x, j) =>
                            j === i ? { ...x, code: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={r.reference || ''}
                      onChange={(e) =>
                        onParamsChange({
                          ...params,
                          refs: refs.map((x, j) =>
                            j === i ? { ...x, reference: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <Button
                      kind="danger"
                      onClick={() =>
                        onParamsChange({
                          ...params,
                          refs: refs.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Редакцията е локална чернова. Каноничното състояние се променя едва
          при ②.
        </p>
      </Card>
      <DeclItemsCard
        goods={goods}
        state={state}
        onStateRefresh={onStateRefresh}
      />
      {(state.issues?.length || 0) > 0 && (
        <Card title="Conformance">
          <ul className="issue-list danger">
            {state.issues!.map((x, i) => (
              <li key={i}>
                {[x.level, x.where, x.msg].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {showContext && (
        <H1ContextModal
          initial={state.declaration_context || {}}
          caseId={String(state.case_id || '')}
          revision={Number(state.case_revision || 0)}
          onClose={() => setShowContext(false)}
          onSaved={() => void onStateRefresh()}
        />
      )}
    </div>
  );
}

export function collectBuildPayload(params: BuildParams) {
  return {
    fx_rate: params.fxRate,
    ak_valuation: params.ak,
    bc_valuation: params.bc,
    auto_ident: params.autoIdent,
    spec_all: params.specAll,
    spec_refs: params.refs,
    prev_doc_type: params.prevDocType,
    prev_doc_ref: params.prevDocRef,
  };
}
