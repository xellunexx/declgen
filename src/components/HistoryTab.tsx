import { useEffect, useState } from 'react';
import { declgenApi } from '../api';
import type { HistoryListItem, HistorySnapshot } from '../types';
import { Button, Card, Empty, CodeView } from './common';

export function HistoryTab() {
  const [items, setItems] = useState<HistoryListItem[] | null>(null);
  const [detail, setDetail] = useState<HistorySnapshot | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    const res = await declgenApi.historyList();
    if (res.ok === false) { setError(res.error || 'Грешка при зареждане.'); return; }
    setItems(res.items || []);
  }
  useEffect(() => { void refresh(); }, []);

  async function open(id: string) {
    const res = await declgenApi.historyItem(id);
    if (res.ok === false || !res.item) { window.alert(res.error || 'Записът не се зарежда.'); return; }
    setDetail(res.item);
  }

  if (detail) {
    return (
      <div className="stack gap-lg">
        <Card title={`Запис: ${detail.invoice_number || detail.id}`} action={<Button onClick={() => setDetail(null)}>← Назад</Button>}>
          <div className="inline wrap" style={{ gap: 16, fontSize: 13, color: 'var(--muted, #8a91a3)' }}>
            <span>Записано: {detail.saved_at}</span>
            <span>Клиент: {detail.client_id}</span>
            <span>Посока: {detail.direction === 'EX' ? 'Износ (BG515C)' : 'Внос (BG415A)'}</span>
            <span>Ревизия: {detail.case_revision ?? '—'}</span>
            <span>От: {detail.user_name || '—'}</span>
          </div>
        </Card>
        <Card title={`Документи (${(detail.files || []).length})`}>
          {!(detail.files || []).length ? <Empty>Няма.</Empty> : <ul className="plain-list">{(detail.files || []).map((f) => <li key={f}>📄 {f}</li>)}</ul>}
        </Card>
        <Card title={`Позиции (${(detail.items || []).length})`}>
          {!(detail.items || []).length ? <Empty>Няма изчислени позиции.</Empty> : <div className="table-scroll"><table><thead><tr><th>№</th><th>HS</th><th>Описание</th><th>Нето</th><th>Цена</th><th>Стат. стойност</th><th>Произход</th></tr></thead><tbody>
            {(detail.items || []).map((g, i) => <tr key={i}><td>{g.item_no || i + 1}</td><td>{g.hs_code || '—'}</td><td>{g.description || '—'}</td><td>{g.net_kg || '—'}</td><td>{g.price || '—'}</td><td>{g.statistical_value || '—'}</td><td>{g.origin || '—'}</td></tr>)}
          </tbody></table></div>}
        </Card>
        <Card title="Общи суми">
          <div className="inline wrap" style={{ gap: 18 }}>
            <span>Фактурирано: <b>{detail.totals?.invoiced ?? '—'} {detail.totals?.currency || ''}</b></span>
            <span>Нето: <b>{detail.totals?.net_kg ?? '—'} kg</b></span>
            <span>Бруто: <b>{detail.totals?.gross_kg ?? '—'} kg</b></span>
            <span>Колети: <b>{detail.totals?.packages ?? '—'}</b></span>
          </div>
        </Card>
        <Card title="Генериран XML"><CodeView text={detail.xml || ''} placeholder="Няма генериран XML в този запис." /></Card>
      </div>
    );
  }

  return (
    <div className="stack gap-lg">
      <Card title="История на записаните поръчки" action={<Button onClick={() => void refresh()}>↻</Button>}>
        {error && <div className="callout warning">{error}</div>}
        {items === null ? <Empty>Зареждане…</Empty> : !items.length ? <Empty>Няма записи. При «Нова поръчка» изберете запазване в историята.</Empty> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Клиент</th><th>Фактура</th><th>Посока</th><th>Общо</th><th>Позиции</th><th /></tr></thead><tbody>
          {items.map((it) => <tr key={it.id}><td>{it.saved_at}</td><td>{it.client_id}</td><td>{it.invoice_number || '—'}</td><td>{it.direction === 'EX' ? 'Износ' : 'Внос'}</td><td>{it.totals?.invoiced ?? '—'} {it.totals?.currency || ''}</td><td>{it.items_count}</td><td><Button onClick={() => void open(it.id)}>Отвори</Button></td></tr>)}
        </tbody></table></div>}
      </Card>
    </div>
  );
}
