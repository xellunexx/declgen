import { useCallback, useEffect, useRef, useState } from 'react';
import { declgenApi } from '../api';
import type { AppState, CatalogEntry, ClassificationRow, ClientDetail, Dashboard, LlmStatus, LogEntry } from '../types';

const NEW_CLIENT = 'Нова фирма / неизвестен вносител';

export function useDeclgen() {
  const [state, setState] = useState<AppState>({});
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [classification, setClassification] = useState<ClassificationRow[]>([]);
  const [classificationDirty, setClassificationDirty] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [xml, setXml] = useState('');
  const [trace, setTrace] = useState('');
  const [llmStatus, setLlmStatus] = useState<LlmStatus>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastLogId = useRef(0);
  const caseIdRef = useRef('');
  const transitionRef = useRef({ caseId: '', revision: -1, stage: '', taskActive: false });

  const resetCaseViews = useCallback(() => {
    setDashboard({});
    setClassification([]);
    setClassificationDirty(false);
    setXml('');
    setTrace('');
  }, []);

  const refreshState = useCallback(async (boot = false) => {
    const result = await declgenApi.state(boot);
    if (result.ok === false) {
      setConnected(false);
      return result;
    }
    setConnected(true);
    const nextCaseId = String(result.case_id || '');
    if (caseIdRef.current && nextCaseId && caseIdRef.current !== nextCaseId) resetCaseViews();
    caseIdRef.current = nextCaseId;
    setState(result);
    return result;
  }, [resetCaseViews]);

  const belongsToCurrentCase = useCallback((result: Record<string, unknown>) => {
    const responseCase = String(result.case_id || '');
    return !responseCase || !caseIdRef.current || responseCase === caseIdRef.current;
  }, []);

  const refreshDashboard = useCallback(async () => {
    const result = await declgenApi.dashboard();
    if (result.dashboard && belongsToCurrentCase(result as Record<string, unknown>)) setDashboard(result.dashboard);
    return result;
  }, [belongsToCurrentCase]);

  const refreshClassification = useCallback(async () => {
    const result = await declgenApi.classification();
    if (!belongsToCurrentCase(result as Record<string, unknown>)) return result;
    setClassification(result.rows || []);
    setClassificationDirty(Boolean(result.dirty));
    return result;
  }, [belongsToCurrentCase]);

  const refreshCatalog = useCallback(async (clientId?: string) => {
    const cid = clientId ?? state.client_id ?? '';
    if (!cid || cid === NEW_CLIENT) {
      setCatalog([]);
      return { ok: true, entries: [] };
    }
    const result = await declgenApi.catalog(cid);
    if (String(state.client_id || '') === cid || !state.client_id) setCatalog(result.entries || []);
    return result;
  }, [state.client_id]);

  const refreshClients = useCallback(async () => {
    const result = await declgenApi.clients();
    setClients(result.clients || []);
    return result;
  }, []);

  const loadClientDetail = useCallback(async (clientId: string) => {
    const result = await declgenApi.clientDetail(clientId);
    setClientDetail(result.template || null);
    return result;
  }, []);

  const refreshXmlTrace = useCallback(async () => {
    const [xr, tr] = await Promise.all([declgenApi.xml(), declgenApi.trace()]);
    if (belongsToCurrentCase(xr as Record<string, unknown>)) setXml(xr.xml || '');
    if (belongsToCurrentCase(tr as Record<string, unknown>)) setTrace(tr.trace ? JSON.stringify(tr.trace, null, 2) : '');
  }, [belongsToCurrentCase]);

  const refreshLlm = useCallback(async () => {
    const result = await declgenApi.llmStatus();
    if (result.ok !== false) setLlmStatus(result);
    return result;
  }, []);

  const refreshLogs = useCallback(async () => {
    const result = await declgenApi.logs(lastLogId.current);
    if (result.logs?.length) {
      const incoming = result.logs;
      lastLogId.current = Math.max(lastLogId.current, ...incoming.map((x) => x.id));
      setLogs((prev) => [...prev, ...incoming].slice(-1200));
    }
    return result;
  }, []);

  const refreshCaseViews = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshClassification(), refreshXmlTrace()]);
  }, [refreshDashboard, refreshClassification, refreshXmlTrace]);

  const refreshAll = useCallback(async () => {
    await refreshState(true); // page (re)load marker: server applies the clean-bench TTL on boot
    await Promise.all([refreshDashboard(), refreshClassification(), refreshClients(), refreshLlm(), refreshXmlTrace(), refreshLogs()]);
  }, [refreshState, refreshDashboard, refreshClassification, refreshClients, refreshLlm, refreshXmlTrace, refreshLogs]);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      await refreshState();
      await Promise.all([refreshDashboard(), refreshClassification(), refreshXmlTrace(), refreshLlm(), refreshLogs()]);
      setBusy(false);
    }
  }, [refreshState, refreshDashboard, refreshClassification, refreshXmlTrace, refreshLlm, refreshLogs]);

  useEffect(() => {
    void refreshAll();
    const poll = window.setInterval(() => {
      void (async () => {
        await refreshState();
        await Promise.all([refreshLogs(), refreshLlm()]);
      })();
    }, 1500);
    return () => window.clearInterval(poll);
  }, [refreshAll, refreshLogs, refreshState, refreshLlm]);

  useEffect(() => { void refreshCatalog(state.client_id || ''); }, [state.client_id, refreshCatalog]);

  useEffect(() => {
    const next = {
      caseId: String(state.case_id || ''),
      revision: Number(state.case_revision ?? -1),
      stage: String(state.stage || ''),
      taskActive: Boolean(state.task?.active),
    };
    const prev = transitionRef.current;
    const changed = Boolean(prev.caseId) && (next.caseId !== prev.caseId || next.revision !== prev.revision || next.stage !== prev.stage);
    const taskFinished = prev.taskActive && !next.taskActive;
    transitionRef.current = next;
    if (changed || taskFinished) void refreshCaseViews();
  }, [state.case_id, state.case_revision, state.stage, state.task?.active, refreshCaseViews]);

  return {
    state, dashboard, classification, classificationDirty, catalog, clients, clientDetail, xml, trace,
    llmStatus, logs, connected, busy, refreshState, refreshDashboard, refreshClassification, refreshCatalog,
    refreshClients, loadClientDetail, refreshXmlTrace, refreshLlm, refreshLogs, refreshAll, refreshCaseViews,
    resetCaseViews, run,
  };
}
