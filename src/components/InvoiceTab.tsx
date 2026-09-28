import { useEffect, useRef, useState } from 'react';
import { declgenApi } from '../api';
import type { Invoice, InvoiceLine } from '../types';
import { Badge, Button, Card, ComboField, Empty, Field } from './common';
import { CURRENCIES, INCOTERMS } from '../refs';

const HEADER_FIELDS: Array<[keyof Invoice, string]> = [
  ['invoice_number', 'Фактура №'],
  ['invoice_date', 'Дата'],
  ['currency', 'Валута'],
  ['price_term', 'Incoterm'],
  ['price_term_place', 'Място'],
  ['grand_total', 'Крайна сума'],
  ['total_goods_value', 'Стойност стоки'],
  ['shipping_cost', 'Транспорт'],
  ['insurance_cost', 'Застраховка'],
  ['total_net_weight_kg', 'Нето (кг)'],
  ['total_gross_weight_kg', 'Бруто (кг)'],
  ['pieces', 'Колети'],
];

export function InvoiceTab({
  invoice,
  caseId,
  revision,
  run,
  refresh,
}: {
  invoice?: Invoice;
  caseId: string;
  revision: number;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  refresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Invoice>({});
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const scopeRef = useRef(caseId);
  const signature = JSON.stringify(invoice || {});

  useEffect(() => {
    const scopeChanged = scopeRef.current !== caseId;
    if (scopeChanged || !dirty) {
      scopeRef.current = caseId;
      setDraft(structuredClone(invoice || {}));
      setBaseRevision(revision);
      if (scopeChanged) setDirty(false);
    }
  }, [caseId, revision, signature, dirty, invoice]);

  const mutate = (fn: (prev: Invoice) => Invoice) => {
    setDirty(true);
    setDraft(fn);
  };
  const lines = draft.lines || [];
  function patchHeader(key: keyof Invoice, value: string) {
    mutate((prev) => ({ ...prev, [key]: value }));
  }
  function patchLine(index: number, key: keyof InvoiceLine, value: string) {
    mutate((prev) => {
      const next = structuredClone(prev);
      next.lines ||= [];
      next.lines[index] = { ...next.lines[index], [key]: value };
      return next;
    });
  }
  function addLine() {
    mutate((prev) => ({
      ...prev,
      lines: [
        ...(prev.lines || []),
        {
          no: (prev.lines?.length || 0) + 1,
          description: 'Нова стока',
          hs_code: '9999990000',
          quantity: 1,
          unit: 'PCE',
          unit_price: 0,
          total_amount: 0,
        },
      ],
    }));
  }
  function deleteLine(index: number) {
    mutate((prev) => ({
      ...prev,
      lines: (prev.lines || [])
        .filter((_, i) => i !== index)
        .map((x, i) => ({ ...x, no: i + 1 })),
    }));
  }
  function cancelDraft() {
    setDraft(structuredClone(invoice || {}));
    setBaseRevision(revision);
    setDirty(false);
  }

  async function save() {
    const normalized = structuredClone(draft);
    normalized.currency = String(normalized.currency || '')
      .trim()
      .toUpperCase();
    const res = await run(() =>
      declgenApi.updateInvoice(normalized, caseId, baseRevision),
    );
    if (res.ok === false) return window.alert(res.error || 'Грешка при запис.');
    setDirty(false);
    await refresh();
  }
  async function fetchFx() {
    const res = await declgenApi.fetchFx(String(draft.currency || 'USD'));
    if (res.ok && res.rate) window.alert(`Курс към EUR: ${res.rate}`);
    else window.alert(res.error || 'Неуспешно теглене на курс.');
    await refresh();
  }
  if (!invoice) return <Empty>Първо извлечете фактура с ①.</Empty>;

  return (
    <div className="stack gap-lg">
      <Card
        title={
          <div className="inline">
            Редакция на фактура{' '}
            {dirty && <Badge tone="warning">НЕЗАПИСАНО</Badge>}
          </div>
        }
        action={
          <div className="inline">
            <Button onClick={fetchFx}>БНБ курс</Button>
            <Button disabled={!dirty} onClick={cancelDraft}>
              Отказ
            </Button>
            <Button kind="primary" disabled={!dirty} onClick={save}>
              Потвърди фактурата
            </Button>
          </div>
        }
      >
        <div className="form-grid">
          {HEADER_FIELDS.map(([key, label]) => {
            const combo =
              key === 'currency'
                ? CURRENCIES
                : key === 'price_term'
                  ? INCOTERMS
                  : null;
            return combo ? (
              <ComboField
                key={String(key)}
                label={label}
                value={String(draft[key] ?? '')}
                options={combo}
                onChange={(v) => patchHeader(key, v)}
              />
            ) : (
              <Field key={String(key)} label={label}>
                <input
                  value={String(draft[key] ?? '')}
                  onChange={(e) => patchHeader(key, e.target.value)}
                />
              </Field>
            );
          })}
        </div>
      </Card>
      <Card
        title={`Позиции (${lines.length})`}
        action={<Button onClick={addLine}>＋ позиция</Button>}
      >
        <div className="table-scroll">
          <table className="editable-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Описание</th>
                <th>HS</th>
                <th>Кол.</th>
                <th>Мярка</th>
                <th>Ед. цена</th>
                <th>Сума</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, i) => (
                <tr key={i}>
                  <td>{ln.no || i + 1}</td>
                  <td>
                    <input
                      value={String(ln.description || '')}
                      onChange={(e) =>
                        patchLine(i, 'description', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={String(ln.hs_code || '')}
                      onChange={(e) => patchLine(i, 'hs_code', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={String(ln.quantity ?? '')}
                      onChange={(e) => patchLine(i, 'quantity', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={String(ln.unit || '')}
                      onChange={(e) => patchLine(i, 'unit', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={String(ln.unit_price ?? '')}
                      onChange={(e) =>
                        patchLine(i, 'unit_price', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={String(ln.total_amount ?? '')}
                      onChange={(e) =>
                        patchLine(i, 'total_amount', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <Button kind="danger" onClick={() => deleteLine(i)}>
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
