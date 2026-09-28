import { useMemo, useState } from 'react';
import { declgenApi } from '../api';
import type { CatalogEntry, ClassificationRow } from '../types';
import { Badge, Button, Card, Empty, Field, Modal } from './common';

type Selection = { row: ClassificationRow; caseId: string; revision: number };

function ReviewModal({
  selection,
  onClose,
  onSaved,
}: {
  selection: Selection;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { row, caseId, revision } = selection;
  const candidate = String(
    row.decl_hs || row.suggested_hs || row.invoice_hs || row.inv_hs || '',
  ).replace(/\D/g, '');
  const [hs6, setHs6] = useState(candidate.slice(0, 6));
  const [cn, setCn] = useState(candidate.slice(6, 8) || '00');
  const [taric, setTaric] = useState(candidate.slice(8, 10) || '00');
  const [bgName, setBgName] = useState(row.description || row.group || '');
  const [origin, setOrigin] = useState(String(row.origin || '').toUpperCase());
  const [saving, setSaving] = useState(false);
  const [taricCandidates, setTaricCandidates] = useState<
    Array<{ code: string; description?: string }>
  >([]);
  async function lookupTaric() {
    const res = await declgenApi.taricSearch(
      row.description || row.group || '',
      row.invoice_hs || row.inv_hs || '',
    );
    if (res.ok === false) {
      window.alert(res.error || 'TARIC справката не успя.');
      return;
    }
    const cs =
      (res.candidates as
        | Array<{ code: string; description?: string }>
        | undefined) || [];
    if (!cs.length) {
      window.alert('Няма намерени TARIC кандидати.');
      return;
    }
    setTaricCandidates(cs);
  }
  async function save() {
    if (!/^\d{6}$/.test(hs6))
      return window.alert('HS6 кодът трябва да бъде точно 6 цифри.');
    setSaving(true);
    const entry: CatalogEntry = {
      key: row.group || `item-${row.item_no || row.item || ''}`,
      bg_name: bgName.trim(),
      hs: { hs6, cn: cn || '00', taric: taric || '00' },
      origin: origin.trim().toUpperCase(),
      source: 'human_verified',
      aliases:
        row.descriptions ||
        [row.description || row.group || ''].filter(Boolean),
    };
    const res = await declgenApi.approveClassification(
      row.item_no ?? row.item,
      entry,
      caseId,
      revision,
    );
    setSaving(false);
    if (res.ok === false)
      return window.alert(res.error || 'Грешка при потвърждаване.');
    await onSaved();
    onClose();
  }
  return (
    <Modal
      title={`Класификационен преглед · ${row.item_no || row.item || 'позиция'}`}
      onClose={onClose}
      wide
    >
      <div className="review-summary">
        <div>
          <small>Група</small>
          <strong>{row.group || '—'}</strong>
        </div>
        <div>
          <small>Фактура HS</small>
          <strong>{row.invoice_hs || row.inv_hs || '—'}</strong>
        </div>
        <div>
          <small>Предложен/DECL</small>
          <strong>{row.decl_hs || row.suggested_hs || '—'}</strong>
        </div>
        <div>
          <small>Основание</small>
          <strong>{row.source || '—'}</strong>
        </div>
      </div>
      <p>{row.description}</p>
      <div className="form-grid">
        <Field label="HS6">
          <input
            value={hs6}
            onChange={(e) =>
              setHs6(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
          />
        </Field>
        <Field label="CN">
          <input
            value={cn}
            onChange={(e) =>
              setCn(e.target.value.replace(/\D/g, '').slice(0, 2))
            }
          />
        </Field>
        <Field label="TARIC">
          <input
            value={taric}
            onChange={(e) =>
              setTaric(e.target.value.replace(/\D/g, '').slice(0, 2))
            }
          />
        </Field>
        <Field label="Произход">
          <input
            value={origin}
            onChange={(e) =>
              setOrigin(e.target.value.toUpperCase().slice(0, 2))
            }
          />
        </Field>
        <Field label="Описание на български">
          <input value={bgName} onChange={(e) => setBgName(e.target.value)} />
        </Field>
      </div>
      <div className="inline">
        <Button onClick={lookupTaric}>TARIC справка</Button>
        {taricCandidates.length > 0 && (
          <select
            onChange={(e) => {
              const code = e.target.value;
              setHs6(code.slice(0, 6));
              setCn(code.slice(6, 8) || '00');
              setTaric(code.slice(8, 10) || '00');
            }}
            defaultValue=""
          >
            <option value="">Избери кандидат…</option>
            {taricCandidates.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.description}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Отказ</Button>
        <Button kind="success" disabled={saving} onClick={save}>
          {saving ? 'Запис…' : 'Потвърди и научи'}
        </Button>
      </div>
    </Modal>
  );
}

export function ClassificationTab({
  rows,
  dirty,
  caseId,
  revision,
  refresh,
}: {
  rows: ClassificationRow[];
  dirty: boolean;
  caseId: string;
  revision: number;
  refresh: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const pending = useMemo(() => rows.filter((x) => !x.approved), [rows]);
  const open = (row: ClassificationRow) =>
    setSelected({ row, caseId, revision });
  function reviewNext() {
    if (pending[0]) open(pending[0]);
    else window.alert('Всички позиции са потвърдени.');
  }
  return (
    <div className="stack gap-lg">
      <Card
        title={
          <div>
            Класификация{' '}
            <Badge tone={pending.length ? 'warning' : 'success'}>
              {rows.length - pending.length}/{rows.length}
            </Badge>
          </div>
        }
        action={
          <div className="inline">
            <Button onClick={() => void refresh()}>↻</Button>
            <Button
              kind="success"
              disabled={!pending.length}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Потвърждавате всички ${pending.length} позиции с текущите HS кодове?`,
                  )
                )
                  return;
                const res = await declgenApi.approveAllClassifications(
                  caseId,
                  revision,
                );
                if (res.ok === false)
                  return window.alert(
                    res.error || 'Груповото потвърждение не успя.',
                  );
                window.alert(
                  `Потвърдени: ${res.approved}${res.skipped ? `, пропуснати без код: ${res.skipped}` : ''}. Натиснете ② Генерирай отново.`,
                );
                await refresh();
              }}
            >
              ✔ Потвърди всички ({pending.length})
            </Button>
            <Button
              kind="primary"
              disabled={!pending.length}
              onClick={reviewNext}
            >
              ▶ Прегледай следващата
            </Button>
          </div>
        }
      >
        {dirty && (
          <div className="callout warning">
            Има потвърдени промени, които изискват ново ② Генерирай декларация.
          </div>
        )}
        {!rows.length ? (
          <Empty>Няма класификационни редове.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Статус</th>
                  <th>№</th>
                  <th>Група</th>
                  <th>Описание</th>
                  <th>Фактура HS</th>
                  <th>Декларация HS</th>
                  <th>Основание</th>
                  <th>кг / стойност</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.group}-${i}`}
                    className={r.approved ? '' : 'row-warning'}
                  >
                    <td>
                      <Badge tone={r.approved ? 'success' : 'warning'}>
                        {r.approved ? 'Потвърдено' : 'Преглед'}
                      </Badge>
                    </td>
                    <td>{r.item_no || r.item || i + 1}</td>
                    <td>{r.group || '—'}</td>
                    <td>{r.description || '—'}</td>
                    <td>{r.invoice_hs || r.inv_hs || '—'}</td>
                    <td>
                      {r.decl_hs ||
                        (r.suggested_hs ? `AI: ${r.suggested_hs}` : '—')}
                    </td>
                    <td>{r.source || '—'}</td>
                    <td>
                      {r.net_kg || '—'} / {r.price || '—'}
                    </td>
                    <td>
                      <Button onClick={() => open(r)}>Преглед</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && (
        <ReviewModal
          selection={selected}
          onClose={() => setSelected(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
