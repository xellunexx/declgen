import type { ApiResult, AppState, CatalogEntry, ClassificationRow, ClientDetail, Dashboard, HistoryListItem, HistorySnapshot, LlmStatus, LogEntry, NewImporterDefaults, ProfileInspectResult } from './types';

export const DEFAULT_API_URL = 'embedded://declgen';
export const getApiUrl = () => DEFAULT_API_URL;
export const setApiUrl = (_value: string) => {};

export async function request<T extends ApiResult = ApiResult>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
  try { const result = await window.desktop.request({ endpoint, method, body });
    if (!result || typeof result !== 'object') return { ok: false, error: 'Invalid response from embedded core.' } as T;
    return result as T; }
  catch (error) { return { ok: false, error: String(error) } as T; }
}
export async function upload(endpoint: string, paths: string[], field = 'files') {
  try { void field;
    const result = await window.desktop.upload({ endpoint, paths });
    if (!result || typeof result !== 'object') return { ok: false, error: 'Invalid upload response from embedded core.' } as ApiResult;
    return result as ApiResult; }
  catch (error) { return { ok: false, error: String(error) } as ApiResult; }
}
export const download = (endpoint: string, suggestedName: string) => window.desktop.download({ endpoint, suggestedName });

export const declgenApi = {
  state: (boot = false) => request<AppState & ApiResult>(boot ? '/api/state?boot=1' : '/api/state'),
  dashboard: () => request<{ ok?: boolean; dashboard?: Dashboard; error?: string }>('/api/dashboard'),
  logs: (since: number) => request<{ ok?: boolean; logs?: LogEntry[]; error?: string }>(`/api/logs?since=${since}`),
  classification: () => request<{ ok?: boolean; rows?: ClassificationRow[]; dirty?: boolean; error?: string }>('/api/classification'),
  catalog: (clientId: string) => request<{ ok?: boolean; entries?: CatalogEntry[]; error?: string }>(`/api/catalog?client_id=${encodeURIComponent(clientId)}`),
  xml: () => request<{ ok?: boolean; xml?: string; error?: string }>('/api/xml'), trace: () => request<{ ok?: boolean; trace?: unknown; error?: string }>('/api/trace'),
  clients: () => request<{ ok?: boolean; clients?: string[]; error?: string }>('/api/clients'),
  clientDetail: (clientId: string) => request<{ ok?: boolean; template?: ClientDetail; error?: string }>(`/api/clients/detail?client_id=${encodeURIComponent(clientId)}`),
  llmStatus: () => request<LlmStatus & ApiResult>('/api/llm/status'),
  selectClient: (client_id: string, direction: string) => request('/api/clients/select', 'POST', { client_id, direction }),
  selectFolder: (path: string) => request('/api/dossier/select_folder', 'POST', { path }), extract: () => request('/api/dossier/extract', 'POST'),
  build: (body: unknown, case_id?: string, base_revision?: number) => request('/api/build', 'POST', { ...(body as Record<string, unknown>), case_id, base_revision }), approve: (tag: string, case_id?: string, base_revision?: number) => request<{ ok?: boolean; file_path?: string; error?: string }>('/api/approve', 'POST', { tag, case_id, base_revision }),
  stopTask: () => request('/api/task/stop', 'POST'), clear: () => request('/api/clear', 'POST'), updateInvoice: (invoice: unknown, case_id?: string, base_revision?: number) => request('/api/invoice/update', 'POST', { invoice, case_id, base_revision }),
  fetchFx: (currency: string) => request<{ ok?: boolean; rate?: string; error?: string }>('/api/fx/fetch', 'POST', { currency }), saveH1Context: (context: unknown, case_id?: string, base_revision?: number) => request('/api/h1_context', 'POST', { context, case_id, base_revision }),
  approveClassification: (item_no: string | number | undefined, catalog_entry: CatalogEntry, case_id?: string, base_revision?: number) => request('/api/classification/approve', 'POST', { item_no, catalog_entry, case_id, base_revision }), approveAllClassifications: (case_id?: string, base_revision?: number) => request<{ ok?: boolean; approved?: number; skipped?: number; error?: string }>('/api/classification/approve_all', 'POST', { case_id, base_revision }),
  saveCatalogEntry: (entry: CatalogEntry) => request('/api/catalog/save', 'POST', { entry }), deleteCatalogEntry: (key: string) => request('/api/catalog/delete', 'POST', { key }), batchLearn: (entries: CatalogEntry[]) => request('/api/catalog/batch_learn', 'POST', { entries }),
  newImporterDefaults: () => request<{ ok?: boolean; defaults?: NewImporterDefaults; error?: string }>('/api/new_importer_intake/defaults'), validateNewImporter: (values: unknown) => request<{ ok?: boolean; errors?: string[]; error?: string }>('/api/new_importer_intake/validate', 'POST', { values }), submitNewImporter: (values: unknown, case_id?: string, base_revision?: number) => request('/api/new_importer_intake/submit', 'POST', { values, case_id, base_revision }),
  llmVerify: (body: unknown) => request('/api/llm/verify', 'POST', body), llmConfig: (body: unknown) => request('/api/llm/config', 'POST', body), llmStart: (role: 'text'|'vision') => request('/api/llm/start', 'POST', { role }), llmStop: (role:'text'|'vision') => request('/api/llm/stop','POST',{role}), llmChat: (body:unknown) => request('/api/llm/chat','POST',body), toggleWan: (action='start') => request('/api/wan/toggle','POST',{action}),
  webSearch: (query:string) => request('/api/search/web','POST',{query}), taricSearch: (query:string, invoice_hs='') => request('/api/search/taric','POST',{query,invoice_hs}),
  inspectProfile: (path:string) => upload('/api/profile_import/inspect',[path],'file') as Promise<ApiResult & { result?: ProfileInspectResult }>, saveProfile: (inspect_result:unknown,client_id:string,values:Record<string,string>) => request('/api/profile_import/save','POST',{inspect_result,client_id,values}),
  historyList: () => request<{ ok?: boolean; items?: HistoryListItem[]; error?: string }>('/api/history'),
  historyItem: (id:string) => request<{ ok?: boolean; item?: HistorySnapshot; error?: string }>(`/api/history/item?id=${encodeURIComponent(id)}`),
  historySave: () => request<{ ok?: boolean; id?: string; error?: string }>('/api/history/save','POST'),
  declItemsUpdate: (items: Array<{ item_no: number; patch: Record<string, string> }>, caseId: string, baseRevision: number) => request<{ ok?: boolean; changed?: boolean; errors?: number; error?: string }>('/api/declaration/items_update','POST',{ items, case_id: caseId, base_revision: baseRevision }),
};
