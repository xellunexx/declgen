import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import { Badge, Button } from './common';

export function LogsDrawer({ logs }: { logs: LogEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs, open]);
  return <footer className={`logs-drawer ${open ? 'open' : ''}`}>
    <button className="logs-handle" onClick={() => setOpen((x) => !x)}><span>LIVE LOG</span><Badge tone="info">{logs.length}</Badge><span>{logs.at(-1)?.text || 'готов'}</span><span>{open ? '▼' : '▲'}</span></button>
    {open && <><div className="logs-stream" ref={ref}>{logs.map((l) => <div key={l.id} className={`log log-${l.level || 'info'}`}><span>[{l.ts || ''}]</span> {l.text}</div>)}</div><div className="logs-actions"><Button onClick={() => navigator.clipboard.writeText(logs.map((l) => `[${l.ts || ''}] ${l.text || ''}`).join('\n'))}>Копирай лога</Button></div></>}
  </footer>;
}
