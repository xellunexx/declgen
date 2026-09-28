import { useEffect, useState } from 'react';
import { declgenApi } from '../api';
import type { Invoice, NewImporterDefaults } from '../types';
import { Button, ComboField, Field, Modal } from './common';
import { COUNTRIES, DEAL_TYPES, INCOTERMS } from '../refs';

const FIELD_LABELS: Array<[keyof NewImporterDefaults, string]> = [
  ['lrn', 'LRN'], ['lodging_office', 'Митническо учреждение'], ['importer_eori', 'EORI на вносител'], ['declarant_eori', 'EORI на декларатор'], ['representative_eori', 'EORI на представител'],
  ['nature_of_transaction', 'Вид сделка'], ['border_mode', 'Транспорт на границата'], ['border_nationality', 'Националност на границата'], ['inland_mode', 'Вътрешен транспорт'],
  ['container_indicator', 'Контейнер 0/1'], ['arrival_id', 'МПС при пристигане'], ['arrival_code', 'Код на идентификатора'], ['dispatch', 'Държава на изпращане'], ['destination', 'Държава на получаване'],
  ['incoterm', 'Incoterm'], ['terms_country', 'Държава по Incoterm'], ['terms_location', 'Място по Incoterm'], ['loc_city', 'Град'], ['loc_country', 'Държава на стоките'], ['loc_street', 'Адрес на стоките'],
];

export function NewImporterModal({ invoice, caseId, revision, onClose, onSubmitted }: { invoice?: Invoice; caseId: string; revision: number; onClose: () => void; onSubmitted: () => Promise<unknown> }) {
  const [values, setValues] = useState<NewImporterDefaults>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [routeConfirmed, setRouteConfirmed] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);

  useEffect(() => { void (async () => { setLoading(true); setErrors([]); setBaseRevision(revision); const res = await declgenApi.newImporterDefaults(); if (res.ok === false) setErrors([res.error || 'Не могат да се заредят H1 данните.']); else if (res.defaults) { setValues(res.defaults); setRouteConfirmed(String(res.defaults.route_confirmed ?? '') === '1'); } setLoading(false); })(); }, [caseId]);
  function setField(key: keyof NewImporterDefaults, value: string) { setValues((p) => ({ ...p, [key]: value })); }
  function setGoodsHs(no: string, value: string) { setValues((p) => ({ ...p, goods_hs: { ...(p.goods_hs || {}), [no]: value } })); }

  async function submit() {
    const payload = { ...values, route_confirmed: routeConfirmed ? '1' : '0' };
    const valid = await declgenApi.validateNewImporter(payload);
    if (valid.ok === false || valid.errors?.length) { setErrors(valid.errors?.length ? valid.errors : [valid.error || 'Валидацията не е успешна.']); return; }
    const result = await declgenApi.submitNewImporter(payload, caseId, baseRevision);
    if (result.ok === false) { setErrors(Array.isArray(result.errors) ? result.errors as string[] : [result.error || 'Грешка при изпращане на H1 данни.']); return; }
    await onSubmitted(); onClose();
  }

  return <Modal title="Нов клиент — внос (H1 данни за първа поръчка)" onClose={onClose} wide>
    <div className="callout warning">Фактурата не доказва тези стойности. Проверете ги ръчно. Cancel не променя каноничното състояние.</div>{revision !== baseRevision && <div className="callout danger">Случаят се промени, докато формата е отворена. Затворете я и я отворете отново.</div>}
    {loading ? <p>Зареждане…</p> : <>{errors.length > 0 && <ul className="issue-list danger">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="form-grid">{FIELD_LABELS.map(([key, label]) => { const combo = key === 'incoterm' ? INCOTERMS : key === 'nature_of_transaction' ? DEAL_TYPES : ['dispatch', 'destination', 'terms_country', 'loc_country', 'border_nationality'].includes(String(key)) ? COUNTRIES : null; return combo ? <ComboField key={String(key)} label={label} value={String(values[key] ?? '')} options={combo} onChange={(v) => setField(key, v)} /> : <Field key={String(key)} label={label}><input value={String(values[key] ?? '')} onChange={(e) => setField(key, e.target.value)} /></Field>; })}</div>
      <label className="check"><input type="checkbox" checked={routeConfirmed} onChange={(e) => setRouteConfirmed(e.target.checked)} /> Потвърждавам транспорта, маршрута и мястото на стоките за тази пратка</label>
      <h3>Стоки / HS кодове</h3><div className="table-scroll"><table><thead><tr><th>№</th><th>Описание</th><th>HS/CN/TARIC — 10 цифри</th></tr></thead><tbody>{(invoice?.lines || []).map((ln, i) => { const no = String(ln.no || i + 1); return <tr key={no}><td>{no}</td><td>{ln.description || '—'}</td><td><input value={String(values.goods_hs?.[no] || '')} onChange={(e) => setGoodsHs(no, e.target.value.replace(/\D/g, '').slice(0, 10))} /></td></tr>; })}</tbody></table></div>
      <div className="modal-actions"><Button onClick={onClose}>Отказ</Button><Button kind="primary" disabled={revision !== baseRevision} onClick={submit}>Потвърди H1 данните</Button></div>
    </>}
  </Modal>;
}
