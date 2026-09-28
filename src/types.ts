export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface ApiResult {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface TaskState {
  active?: string | null;
  progress?: string;
  status?: string;
  error?: string;
}

export interface InvoiceLine {
  no?: number | string;
  description?: string;
  hs_code?: string;
  origin?: string;
  quantity?: number | string;
  unit?: string;
  unit_price?: number | string;
  total_amount?: number | string;
  [key: string]: unknown;
}

export interface Invoice {
  invoice_number?: string;
  invoice_date?: string;
  currency?: string;
  price_term?: string;
  price_term_place?: string;
  grand_total?: number | string;
  total_goods_value?: number | string;
  shipping_cost?: number | string;
  insurance_cost?: number | string;
  total_net_weight_kg?: number | string;
  total_gross_weight_kg?: number | string;
  pieces?: number | string;
  lines?: InvoiceLine[];
  [key: string]: unknown;
}

export interface DossierEntry {
  type?: string;
  confidence?: string;
  scanned_without_text?: boolean;
  needs_ocr?: boolean;
  [key: string]: unknown;
}

export interface Issue {
  level?: string;
  where?: string;
  msg?: string;
  [key: string]: unknown;
}

export interface SpecRef {
  code?: string;
  reference?: string;
}

export interface Readiness {
  ready: boolean;
  blockers: string[];
  stage?: string;
  case_revision?: number;
  built_from_revision?: number | null;
  validated_revision?: number | null;
}

export interface AppState {
  ok?: boolean;
  case_id?: string;
  case_revision?: number;
  built_from_revision?: number | null;
  validated_revision?: number | null;
  stage?: string;
  readiness?: Readiness;
  task?: TaskState;
  has_decl?: boolean;
  auto_ident?: boolean;
  client_id?: string;
  direction?: string;
  dossier?: Record<string, DossierEntry>;
  invoice?: Invoice;
  report?: {
    goods_items?: Array<Record<string, unknown>>;
    new_goods?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  issues?: Issue[];
  unresolved_count?: number;
  fx_rate?: string | number;
  fx_info?: { date?: string; [key: string]: unknown };
  ak_valuation?: string | number;
  bc_valuation?: string | number;
  spec_all?: boolean;
  spec_refs?: SpecRef[];
  prev_doc_type?: string;
  prev_doc_ref?: string;
  general_submitted?: boolean;
  declaration_context?: Record<string, unknown>;
  wan_status?: string;
  wan_url?: string;
  wan_urls?: { lan?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Dashboard {
  case_id?: string;
  case_revision?: number;
  readiness?: Readiness;
  client?: { name?: string; eori?: string };
  dossier?: {
    files_count?: number;
    invoices?: number;
    packings?: number;
    waybills?: number;
  };
  invoice?: {
    number?: string;
    date?: string;
    lines_count?: number;
    seller?: string;
    grand_total?: string | number;
    currency?: string;
  };
  declaration?: Record<string, unknown>;
  reconciliation?: Array<{
    metric?: string;
    source?: string;
    decl?: string;
    diff?: string;
    ok?: boolean;
  }>;
  changes?: Array<{
    line_no?: string | number;
    inv_hs?: string;
    decl_hs?: string;
    reason?: string;
    desc?: string;
  }>;
  blockers?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface ClassificationRow {
  approved?: boolean;
  item_no?: number | string;
  item?: number | string;
  group?: string;
  description?: string;
  descriptions?: string[];
  inv_hs?: string;
  invoice_hs?: string;
  decl_hs?: string;
  suggested_hs?: string;
  source?: string;
  net_kg?: string | number;
  price?: string | number;
  origin?: string;
  [key: string]: unknown;
}

export interface CatalogEntry {
  key: string;
  bg_name?: string;
  bg_phrase?: string | null;
  hs?: { hs6?: string; cn?: string; taric?: string };
  origin?: string;
  source?: string;
  aliases?: string[];
  cas?: string | null;
  [key: string]: unknown;
}

export interface ClientDetail {
  client_id?: string;
  importer_tin?: string;
  lodging_office?: string;
  capabilities?: string[];
  goods_past?: Array<{ code?: string; bg_name?: string }>;
  [key: string]: unknown;
}

export interface LlmRoleStatus {
  available?: boolean;
  url?: string;
  model?: string;
  api_key?: string;
  cmd?: string;
  [key: string]: unknown;
}

export interface LlmStatus {
  ok?: boolean;
  text?: LlmRoleStatus;
  vision?: LlmRoleStatus;
  wan_url?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  id: number;
  ts?: string;
  level?: string;
  text?: string;
}

export interface NewImporterDefaults extends Record<string, unknown> {
  lrn?: string;
  lodging_office?: string;
  importer_eori?: string;
  declarant_eori?: string;
  representative_eori?: string;
  nature_of_transaction?: string;
  border_mode?: string;
  border_nationality?: string;
  inland_mode?: string;
  container_indicator?: string;
  arrival_id?: string;
  dispatch?: string;
  destination?: string;
  incoterm?: string;
  terms_country?: string;
  terms_location?: string;
  route_confirmed?: string;
  arrival_code?: string;
  loc_city?: string;
  loc_country?: string;
  loc_street?: string;
  goods_hs?: Record<string, string>;
}

export interface ProfileInspectField {
  key: string;
  label?: string;
  value?: string;
  evidence?: string;
}

export interface ProfileInspectResult {
  suggested_id?: string;
  fields?: ProfileInspectField[];
  [key: string]: unknown;
}

export interface HistoryListItem {
  id: string;
  saved_at: string;
  client_id: string;
  invoice_number: string | null;
  direction: string;
  totals?: {
    invoiced?: string | null;
    currency?: string;
    net_kg?: string | null;
    gross_kg?: string | null;
    packages?: string | null;
  };
  items_count: number;
}
export interface HistorySnapshot extends HistoryListItem {
  user_name?: string;
  case_revision?: number;
  files?: string[];
  items?: Array<{
    item_no?: string;
    hs_code?: string;
    description?: string;
    net_kg?: string;
    price?: string;
    statistical_value?: string;
    origin?: string;
  }>;
  xml?: string | null;
}
