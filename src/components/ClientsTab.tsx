import { useState } from 'react';
import { declgenApi } from '../api';
import type { ClientDetail, ProfileInspectResult } from '../types';
import { Button, Card, Empty, Field, Modal } from './common';

function ProfileImportModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [inspect, setInspect] = useState<ProfileInspectResult | null>(null);
  const [clientId, setClientId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  async function choose() {
    if (window.desktop.uploadBrowserFiles) {
      const res = await window.desktop.uploadBrowserFiles('profile');
      if (res.ok === false || !res.result)
        return window.alert(res.error || 'XML прегледът не успя.');
      setInspect(res.result as ProfileInspectResult);
      setClientId(
        (res.result as ProfileInspectResult).suggested_id || 'new_client',
      );
      return;
    }
    const paths = await window.desktop.selectFiles('profile');
    if (!paths.length) return;
    const res = await declgenApi.inspectProfile(paths[0]);
    if (res.ok === false || !res.result)
      return window.alert(res.error || 'XML прегледът не успя.');
    setInspect(res.result);
    setClientId(res.result.suggested_id || 'new_client');
    const next: Record<string, string> = {};
    for (const f of res.result.fields || []) next[f.key] = f.value || '';
    setValues(next);
  }

  async function save() {
    if (!inspect || !clientId.trim()) return;
    const res = await declgenApi.saveProfile(inspect, clientId.trim(), values);
    if (res.ok === false)
      return window.alert(res.error || 'Профилът не беше записан.');
    await onSaved();
    onClose();
  }

  return (
    <Modal title="Импорт на клиент от историческа XML" onClose={onClose} wide>
      <div className="callout info">
        Импортирайте само повторно използваемия клиентски профил; данните за
        старата пратка остават извън новия случай.
      </div>
      <Button onClick={choose}>Избери XML…</Button>
      {inspect && (
        <>
          <Field label="Нов клиент ID">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </Field>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Поле</th>
                  <th>Стойност</th>
                  <th>Доказателство</th>
                </tr>
              </thead>
              <tbody>
                {(inspect.fields || []).map((f) => (
                  <tr key={f.key}>
                    <td>{f.label || f.key}</td>
                    <td>
                      <input
                        value={values[f.key] || ''}
                        onChange={(e) =>
                          setValues((p) => ({ ...p, [f.key]: e.target.value }))
                        }
                      />
                    </td>
                    <td>{f.evidence || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Отказ</Button>
        <Button kind="primary" disabled={!inspect} onClick={save}>
          Импортирай след преглед
        </Button>
      </div>
    </Modal>
  );
}

export function ClientsTab({
  clients,
  detail,
  loadDetail,
  refresh,
}: {
  clients: string[];
  detail: ClientDetail | null;
  loadDetail: (clientId: string) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}) {
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="clients-layout">
      <Card
        title={`Клиенти (${clients.length})`}
        action={
          <div className="inline">
            <Button onClick={() => void refresh()}>↻</Button>
            <Button kind="primary" onClick={() => setShowImport(true)}>
              Клиент XML…
            </Button>
          </div>
        }
      >
        {!clients.length ? (
          <Empty>Няма клиентски профили.</Empty>
        ) : (
          <div className="client-list">
            {clients.map((cid) => (
              <button key={cid} onClick={() => void loadDetail(cid)}>
                {cid}
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card title={detail ? `Профил: ${detail.client_id || ''}` : 'Профил'}>
        {!detail ? (
          <Empty>Изберете клиент.</Empty>
        ) : (
          <div className="stack">
            <div className="form-grid">
              <Field label="Client ID">
                <input readOnly value={detail.client_id || ''} />
              </Field>
              <Field label="EORI">
                <input readOnly value={detail.importer_tin || ''} />
              </Field>
              <Field label="Митническо учреждение">
                <input readOnly value={detail.lodging_office || ''} />
              </Field>
              <Field label="Посока">
                <input
                  readOnly
                  value={(detail.capabilities || []).join(', ')}
                />
              </Field>
            </div>
            <strong>История / предишни стоки</strong>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Код</th>
                    <th>Описание</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.goods_past || []).map((g, i) => (
                    <tr key={i}>
                      <td>{g.code}</td>
                      <td>{g.bg_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
      {showImport && (
        <ProfileImportModal
          onClose={() => setShowImport(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
