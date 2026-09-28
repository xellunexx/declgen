import fs from 'node:fs/promises';
import path from 'node:path';
export function safePart(v: any, fallback: string) {
  let s = String(v ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '');
  return s.slice(0, 90) || fallback;
}
export function reviewPath(root: string, clientId: string, invoice: any) {
  return path.join(
    root,
    `human-review-${safePart(clientId, 'client')}-${safePart(invoice?.invoice_number, 'draft')}`,
    'classification_reviews.json',
  );
}
export function lineKey(values: any[] = []) {
  return values
    .map((v) => {
      const n = Number(v);
      return Number.isInteger(n) ? String(n) : String(v ?? '').trim();
    })
    .filter(Boolean)
    .sort()
    .join(',');
}
export function validateDecision(d: any) {
  const out = { ...(d || {}) },
    code = String(out.approved_code || '').trim(),
    origin = String(out.origin || '')
      .trim()
      .toUpperCase(),
    description = String(out.declaration_description || '').trim();
  if (!/^(?:\d{6}|\d{8}|\d{10})$/.test(code))
    throw new Error('HS/CN/TARIC code must contain 6, 8, or 10 digits');
  if (!/^[A-Z]{2}$/.test(origin))
    throw new Error('origin must be a two-letter ISO country code');
  if (!description) throw new Error('human-reviewed description is required');
  if (!lineKey(out.line_nos))
    throw new Error('at least one invoice line is required');
  return {
    ...out,
    approved_code: code,
    origin,
    declaration_description: description,
    decision: 'human_verified',
  };
}
export async function save(
  root: string,
  clientId: string,
  invoice: any,
  decisions: Record<string, any>,
) {
  if (!clientId.trim()) throw new Error('client_id is required');
  const p = reviewPath(root, clientId, invoice);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const payload = {
      version: 1,
      client_id: clientId,
      invoice_number: invoice?.invoice_number,
      invoice_date: invoice?.invoice_date,
      decisions: Object.values(decisions).map(validateDecision),
    },
    tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmp, p);
  const check = JSON.parse(await fs.readFile(p, 'utf8'));
  if (JSON.stringify(check) !== JSON.stringify(payload))
    throw new Error(`classification decision verification failed: ${p}`);
  return p;
}
export async function load(root: string, clientId: string, invoice: any) {
  const p = reviewPath(root, clientId, invoice);
  let payload: any;
  try {
    payload = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
  if (String(payload.client_id || '') !== String(clientId || '')) return {};
  for (const f of ['invoice_number', 'invoice_date'])
    if (String(payload[f] || '') !== String(invoice?.[f] || '')) return {};
  const out: Record<string, any> = {};
  for (const raw of payload.decisions || []) {
    try {
      const d = validateDecision(raw),
        k = String(d.group || '').trim() || 'lines:' + lineKey(d.line_nos);
      out[k] = d;
    } catch {}
  }
  return out;
}
export function find(
  decisions: Record<string, any>,
  group: any,
  lineNos: any[],
  code?: any,
  origin?: any,
) {
  const direct = decisions?.[String(group || '')];
  if (direct) return direct;
  const lk = lineKey(lineNos),
    current = String(code || '').replace(/\D/g, '');
  for (const d of Object.values(decisions || {}) as any[]) {
    if (!lk || lineKey(d.line_nos) !== lk) continue;
    const approved = String(d.approved_code || '').replace(/\D/g, ''),
      effective = String(d.origin || origin || '')
        .trim()
        .toUpperCase();
    if (
      approved &&
      (code == null || approved === current) &&
      (origin == null || effective === String(origin).trim().toUpperCase()) &&
      /^[A-Z]{2}$/.test(effective)
    )
      return d;
  }
  return null;
}
export function apply(invoice: any, decisions: Record<string, any>) {
  const out = structuredClone(invoice || {}),
    lines = (out.lines || []).map((x: any) => ({ ...x })),
    by = new Map(lines.map((x: any) => [String(x.no), x]));
  for (const raw of Object.values(decisions || {})) {
    const d = validateDecision(raw);
    for (const n of d.line_nos || []) {
      const l = by.get(String(n)) as any;
      if (!l) continue;
      l.hs_code = d.approved_code;
      l.origin = d.origin;
      l.description = d.declaration_description;
      l.human_description = d.declaration_description;
      l.classification_source = 'human_verified';
    }
  }
  out.lines = lines;
  return out;
}
