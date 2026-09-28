import { useEffect, useState } from 'react';
import { declgenApi } from '../api';
import type { LlmRoleStatus, LlmStatus } from '../types';
import { Badge, Button, Card, Field } from './common';

interface RoleDraft { url: string; model: string; api_key: string; }

function BrainCard({ role, title, status, refresh }: { role: 'text' | 'vision'; title: string; status?: LlmRoleStatus; refresh: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<RoleDraft>({ url: '', model: 'local', api_key: '' });
  const [result, setResult] = useState('');
  useEffect(() => setDraft({ url: status?.url || '', model: status?.model || 'local', api_key: '' }), [status?.url, status?.model]);

  async function save() {
    const res = await declgenApi.llmConfig({ role, ...draft });
    if (res.ok === false) window.alert(res.error || 'Настройката не беше записана.');
    await refresh();
  }
  async function verify() {
    setResult('Проверка…');
    const res = await declgenApi.llmVerify({ role, url: draft.url, model: draft.model, api_key: draft.api_key });
    setResult(res.ok ? `✓ ${String(res.latency_s || '')}s — ${String(res.reply || 'OK')}` : `✗ ${res.error || 'няма отговор'}`);
    await refresh();
  }
  async function start() { const res = await declgenApi.llmStart(role); if (res.ok === false) window.alert(res.error || 'Стартерът не можа да бъде пуснат.'); await refresh(); }
  async function stop() { const res = await declgenApi.llmStop(role); if (res.ok === false) window.alert(res.error || 'Сървърът не можа да бъде спрян.'); await refresh(); }

  return <Card title={<div className="inline">{title}<Badge tone={status?.available ? 'success' : 'neutral'}>{status?.available ? 'ACTIVE' : 'OFFLINE'}</Badge></div>}>
    <div className="form-grid"><Field label="Endpoint"><input value={draft.url} onChange={(e) => setDraft((p) => ({ ...p, url: e.target.value }))} /></Field><Field label="Model"><input value={draft.model} onChange={(e) => setDraft((p) => ({ ...p, model: e.target.value }))} /></Field><Field label="API key"><input type="password" value={draft.api_key} onChange={(e) => setDraft((p) => ({ ...p, api_key: e.target.value }))} /></Field></div>
    <div className="inline"><Button kind="primary" onClick={save}>Приложи</Button><Button onClick={verify}>Провери на живо</Button><Button kind="success" onClick={start}>▶ Старт</Button><Button kind="danger" onClick={stop}>■ Стоп</Button></div>
    {result && <pre className="result-box">{result}</pre>}
  </Card>;
}

export function LlmTab({ status, refresh }: { status: LlmStatus; refresh: () => Promise<unknown> }) {
  const [prompt, setPrompt] = useState('Ping');
  const [target, setTarget] = useState<'text' | 'vision'>('text');
  const [output, setOutput] = useState('');
  async function chat() {
    setOutput('Изпращане…');
    const res = await declgenApi.llmChat({ role: target, prompt, temperature: 0, max_tokens: 2048 });
    setOutput(String(res.reply || res.content || res.error || JSON.stringify(res, null, 2)));
  }
  return <div className="stack gap-lg">
    <BrainCard role="text" title="Текстов мозък" status={status.text} refresh={refresh} />
    <BrainCard role="vision" title="Зрителен мозък" status={status.vision} refresh={refresh} />
    <Card title="LLM playground"><div className="inline"><select value={target} onChange={(e) => setTarget(e.target.value as 'text' | 'vision')}><option value="text">text</option><option value="vision">vision</option></select><Button kind="primary" onClick={chat}>Изпрати</Button></div><textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /><pre className="result-box">{output}</pre></Card>
  </div>;
}
