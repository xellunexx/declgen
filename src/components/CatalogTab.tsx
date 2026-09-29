import { useState } from 'react';
import { declgenApi } from '../api';
import type { CatalogEntry } from '../types';
import { Button, Card, Empty, Field, Modal } from './common';

function CatalogModal({
  entry,
  onClose,
  onSaved,
}: {
  entry?: CatalogEntry;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<CatalogEntry>(
    entry
      ? structuredClone(entry)
      : {
          key: '',
          bg_name: '',
          hs: { hs6: '', cn: '00', taric: '00' },
          origin: 'CN',
        },
  );
  const hs = draft.hs || {};
  async function save() {
    if (
      !draft.key.trim() ||
      !draft.bg_name?.trim() ||
      !/^\d{6}$/.test(hs.hs6 || '')
    )
      return window.alert('Нужни са ключ, българско име и 6-цифрен HS6.');
    const res = await declgenApi.saveCatalogEntry(draft);
    if (res.ok === false) return window.alert(res.error || 'Грешка при запис.');
    await onSaved();
    onClose();
  }
  return (
    <Modal
      title={entry ? 'СТОКА — редакция' : 'СТОКА — добавяне'}
      onClose={onClose}
    >
      <div className="form-grid one-col">
        <Field label="Ключ">
          <input
            disabled={Boolean(entry)}
            value={draft.key}
            onChange={(e) => setDraft((p) => ({ ...p, key: e.target.value }))}
          />
        </Field>
        <Field label="Име (BG)">
          <input
            value={draft.bg_name || ''}
            onChange={(e) =>
              setDraft((p) => ({ ...p, bg_name: e.target.value }))
            }
          />
        </Field>
        <Field label="BG фраза">
          <input
            value={draft.bg_phrase || ''}
            onChange={(e) =>
              setDraft((p) => ({ ...p, bg_phrase: e.target.value }))
            }
          />
        </Field>
        <div className="three-col">
          <Field label="HS6">
            <input
              value={hs.hs6 || ''}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  hs: {
                    ...p.hs,
                    hs6: e.target.value.replace(/\D/g, '').slice(0, 6),
                  },
                }))
              }
            />
          </Field>
          <Field label="CN">
            <input
              value={hs.cn || ''}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  hs: {
                    ...p.hs,
                    cn: e.target.value.replace(/\D/g, '').slice(0, 2),
                  },
                }))
              }
            />
          </Field>
          <Field label="TARIC">
            <input
              value={hs.taric || ''}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  hs: {
                    ...p.hs,
                    taric: e.target.value.replace(/\D/g, '').slice(0, 2),
                  },
                }))
              }
            />
          </Field>
        </div>
        <Field label="Произход">
          <input
            value={draft.origin || ''}
            onChange={(e) =>
              setDraft((p) => ({
                ...p,
                origin: e.target.value.toUpperCase().slice(0, 2),
              }))
            }
          />
        </Field>
        <Field label="CAS">
          <input
            value={draft.cas || ''}
            onChange={(e) => setDraft((p) => ({ ...p, cas: e.target.value }))}
          />
        </Field>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Отказ</Button>
        <Button kind="primary" onClick={save}>
          Запази
        </Button>
      </div>
    </Modal>
  );
}

export function CatalogTab({
  entries,
  refresh,
}: {
  entries: CatalogEntry[];
  refresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<CatalogEntry | 'new' | null>(null);
  async function remove(entry: CatalogEntry) {
    if (!window.confirm(`Изтриване на '${entry.key}'?`)) return;
    const res = await declgenApi.deleteCatalogEntry(entry.key);
    if (res.ok === false)
      return window.alert(res.error || 'Грешка при изтриване.');
    await refresh();
  }
  return (
    <div className="stack gap-lg">
      <Card
        title={`Клиентски каталог (${entries.length})`}
        action={
          <div className="inline">
            <Button onClick={() => void refresh()}>↻</Button>
            <Button kind="primary" onClick={() => setEditing('new')}>
              ＋ Нова стока
            </Button>
          </div>
        }
      >
        {!entries.length ? (
          <Empty>Няма записи за избрания клиент.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ключ</th>
                  <th>Име</th>
                  <th>HS6</th>
                  <th>CN</th>
                  <th>TARIC</th>
                  <th>Произход</th>
                  <th>Източник</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.key}>
                    <td>
                      <strong>{e.key}</strong>
                    </td>
                    <td>{e.bg_name || '—'}</td>
                    <td>{e.hs?.hs6 || '—'}</td>
                    <td>{e.hs?.cn || '—'}</td>
                    <td>{e.hs?.taric || '—'}</td>
                    <td>{e.origin || '—'}</td>
                    <td>{e.source || 'learned'}</td>
                    <td>
                      <div className="inline">
                        <Button onClick={() => setEditing(e)}>Ред.</Button>
                        <Button kind="danger" onClick={() => void remove(e)}>
                          ×
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <CatalogModal
          entry={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
