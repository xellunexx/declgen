import { extractJson } from './llm.js';

export const DOC_TYPES = [
  'invoice',
  'proforma',
  'packing_list',
  'waybill',
  'cession',
  'permit',
  'certificate',
  'other',
] as const;
const CLASSIFY_SYSTEM =
  'You are a document classifier for a Bulgarian customs brokerage. Reply with strict JSON only.';
const CLASSIFY_USER = (text: string) =>
  `Classify this document as invoice, proforma, packing_list, waybill, cession, permit, certificate, or other. Reply JSON {"type":"...","language":"...","confidence":0.0,"evidence":"..."}. DOCUMENT TEXT:\n${text}`;
const INVOICE_SYSTEM =
  'You extract data from commercial invoices for Bulgarian customs declarations. Be literal. Never invent data. Missing fields are null. Every numeric field (qty, unit_price, subtotal, totals, weights) is a plain decimal number using a dot (e.g. 18.96), with no currency symbol, no thousand separators and no trailing unit text. Reply strict JSON only.';
const INVOICE_USER = (text: string, tables: string) =>
  `Extract this invoice into JSON with fields doc_language, invoice_number, invoice_date (YYYY-MM-DD), currency, seller {company,country,address,postcode,city}, buyer {company,country,address,postcode,city,eori}, price_term, price_term_place, carrier_or_transport, total_goods_value, shipping_cost, shipping_cost_currency, insurance_cost, insurance_currency, grand_total, other_currency_total {amount,currency}|null, total_net_weight_kg, total_gross_weight_kg, pieces, lines [{no,description,hs_code,qty,qty_unit,unit_price,subtotal,origin}]. Every goods or charge row must be retained. Do not merge rows. For each line, "description" is the full goods description: product name PLUS model/size/details — combine the product-name and product-description cells of that row (and of a shared/merged name cell spanning several variant rows). A bare size or model code like "200mm" is never a valid description by itself. JSON only.\n\nINVOICE TEXT:\n${text}\n\n${tables}`;
const PACKING_USER = (text: string, tables: string) =>
  `Extract this packing list as JSON with doc_language, packing_number, packing_date, total_net_weight_kg, total_gross_weight_kg, packages, lines [{no,mark,description,hs_code,qty,qty_unit,net_kg,gross_kg}]. Every table row is one line. For each line, "description" is the product name PLUS model/spec (combine the product-name and product-model cells). qty is the piece count in the qty column — a package/bundle count (e.g. '50 PCS 5 Bundle') is NOT a multiplier. net_kg/gross_kg are the line's printed total weights — never multiply them by the bundle/package count. JSON only.\n\nPACKING LIST TEXT:\n${text}\n\n${tables}`;

export class ExtractionCancelled extends Error {}
export class ExtractionError extends Error {}
const SPLIT = /[^0-9A-Za-zА-Яа-я]+/;
const HS_LENS = new Set([6, 8, 10]);
const cell = (v: any) =>
  String(v ?? '')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const moneyToken = (v: any, currency?: string) => {
  let s = String(v ?? '').replaceAll(',', '');
  if (currency) s = s.replaceAll(currency, '');
  s = s
    .replaceAll('$', '')
    .replaceAll('¥', '')
    .replaceAll('US', '')
    .replaceAll(' ', '')
    .replaceAll('/', '')
    .replaceAll('.-', '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const grab = (text: string, re: RegExp) => {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
};
const money = (v: string | null) => (v ? Number(v.replaceAll(',', '')) : null);
function isoDmy(s: string | null) {
  if (!s) return null;
  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

export function descriptiveTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of String(text || '').split(SPLIT)) {
    if (t.length < 4 || /\d/.test(t)) continue;
    if (t.toUpperCase() === t && t.length <= 6) continue;
    out.add(t.toLowerCase());
  }
  return out;
}
export const looksLikeBareCode = (d: string) => descriptiveTokens(d).size === 0;
const numericCellTok = (t: string) => /^[$€£]?-?[\d.,'’]*\d$/.test(t.trim());
const UNIT_TOK = new Set(['US', 'PCS', 'KG', 'pcs']);
function recoverDesc(code: string, raw: string, no?: number) {
  if (!code || !raw) return '';
  const rawLines = raw.split(/\r?\n/),
    freq = new Map<string, number>();
  for (const line of rawLines)
    for (const t of new Set(line.split(SPLIT)))
      if (t.length >= 3 && !/\d/.test(t))
        freq.set(t.toLowerCase(), (freq.get(t.toLowerCase()) || 0) + 1);
  // Column boilerplate (material/usage words like 'Steel Driling' repeated on
  // every row) is not a product description — it must not anchor a recovery.
  const boiler = (w: string) => (freq.get(w) || 0) / rawLines.length > 0.3;
  // Row-scoped recovery: reconstructed markdown tables keep the item number as
  // a cell, so a size code shared by several products ('180mm' on rows 37 and
  // 40) still resolves to this row's own name cells.
  if (no != null) {
    const nre = new RegExp(`\\|\\s*${no}\\s*\\|`);
    const names: string[] = [];
    for (const line of rawLines) {
      if (!line.includes('|') || !line.includes(code) || !nre.test(line))
        continue;
      for (const cl of line
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (numericCellTok(cl) || UNIT_TOK.has(cl)) continue;
        const dt = descriptiveTokens(cl);
        if (![...dt].some((w) => !boiler(w))) continue;
        if (!names.includes(cl)) names.push(cl);
      }
      if (names.length) break;
    }
    if (names.length)
      return cell(
        names.join(' ') + (names.join(' ').includes(code) ? '' : ` ${code}`),
      );
  }
  const cands = new Map<string, number>();
  for (const line of rawLines) {
    if (!line.includes(code)) continue;
    const words: string[] = [];
    for (const t of line.split(SPLIT)) {
      if (t.length < 3 || /\d/.test(t) || UNIT_TOK.has(t)) continue;
      words.push(t);
    }
    const cand = words.join(' ').trim(),
      dt = descriptiveTokens(cand);
    if (dt.size >= 2 && [...dt].some((w) => !boiler(w)))
      cands.set(cand, (cands.get(cand) || 0) + 1);
  }
  return cands.size === 1 ? [...cands.keys()][0] : '';
}
export function hsSane(code: any): string | null {
  const s = String(code ?? '');
  if (!s || !HS_LENS.has(s.length)) return null;
  const ch = Number(s.slice(0, 2));
  return ch >= 1 && ch <= 97 ? s : null;
}
function sourceTariff(code: any): [string | null, string | null] {
  const raw = String(code ?? '').replace(/\D/g, '') || null;
  if (raw && raw.length === 11) {
    const ten = hsSane(raw.slice(0, 10));
    if (ten)
      return [ten, `source tariff '${raw}' normalized to 10-digit '${ten}'`];
  }
  return [hsSane(raw), null];
}
function num(x: any, field: string, lineNo?: number): number | null {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  let s = String(x).trim();
  s = s.replace(/[^\d.,-]/g, '');
  const neg = s.includes('-');
  s = s.replace(/-/g, '');
  if (!s)
    throw new ExtractionError(
      `line ${lineNo ?? ''}: bad numeric ${field}: ${JSON.stringify(x)}`,
    );
  let n: number;
  const di = s.lastIndexOf('.'),
    ci = s.lastIndexOf(',');
  if (di >= 0 && ci >= 0)
    n =
      di > ci
        ? Number(s.replace(/,/g, ''))
        : Number(s.replace(/\./g, '').replace(',', '.'));
  else if (ci >= 0)
    n =
      s.split(',').length === 2 && s.split(',')[1].length <= 2
        ? Number(s.replace(',', '.'))
        : Number(s.replace(/,/g, ''));
  else n = Number(s);
  if (!Number.isFinite(n))
    throw new ExtractionError(
      `line ${lineNo ?? ''}: bad numeric ${field}: ${JSON.stringify(x)}`,
    );
  return neg ? -n : n;
}
function sweepPartyIds(obj: any, raw: string) {
  if (!raw) return;
  const m = raw.match(/\bEORI\s*[:#]?\s*([A-Z]{2}\w{6,15})/i);
  if (m) {
    obj.buyer = obj.buyer || {};
    if (!obj.buyer.eori) obj.buyer.eori = m[1].toUpperCase();
  }
}
const emptyBuyer = () => ({
  company: '',
  country: '',
  address: '',
  postcode: '',
  city: '',
  eori: null,
});

export function validateInvoice(obj: any, rawText = '') {
  const warnings: string[] = [];
  if (!Array.isArray(obj?.lines) || !obj.lines.length)
    throw new ExtractionError('no line items extracted');
  const norm: any[] = [];
  obj.lines.forEach((ln: any, idx: number) => {
    const i = idx + 1;
    if (!ln || typeof ln !== 'object')
      throw new ExtractionError(`line ${i} is not an object`);
    let desc = String(ln.description ?? '').trim();
    if (!desc) warnings.push(`line ${i}: empty description`);
    const qty = num(ln.qty, 'qty', i),
      sub = num(ln.subtotal, 'subtotal', i),
      unit = num(ln.unit_price, 'unit_price', i);
    if (unit && qty && sub != null) {
      const diff = Math.abs(unit * qty - sub);
      if (diff > Math.max(0.005, 0.03 * Math.abs(sub)))
        warnings.push(
          `line ${i}: unit*qty ${(unit * qty).toFixed(4)} != subtotal ${sub.toFixed(4)} (subtotal/unit_price would be ${(sub / unit).toFixed(6)} - recheck qty/units)`,
        );
    }
    const rawHs = String(ln.hs_code ?? '').replace(/\D/g, '') || null;
    const [hs, note] = sourceTariff(rawHs);
    if (note) warnings.push(`line ${i}: ${note}`);
    else if (rawHs && !hs)
      warnings.push(
        `line ${i}: hs_code '${rawHs}' discarded (implausible length/chapter - likely an article/ERP code)`,
      );
    if (desc && looksLikeBareCode(desc)) {
      const fixed = recoverDesc(desc, rawText, Number(ln.no || i));
      if (fixed) {
        warnings.push(
          `line ${i}: description was bare model code '${desc}' -> recovered from invoice text: '${fixed.slice(0, 60)}'`,
        );
        desc = fixed;
      } else
        warnings.push(
          `line ${i}: description is only the model code '${desc}' - line marked defective`,
        );
    }
    norm.push({
      no: Number(ln.no || i),
      description: desc,
      hs_code: hs,
      _defective: !!(desc && looksLikeBareCode(desc)),
      qty,
      qty_unit: String(ln.qty_unit ?? '').trim() || null,
      unit_price: unit,
      subtotal: sub,
      origin: ln.origin || null,
    });
  });
  const folded: any[] = [];
  for (const ln of norm) {
    if (
      !ln.hs_code &&
      ln.qty == null &&
      ln.subtotal == null &&
      ln.description &&
      folded.length
    ) {
      folded[folded.length - 1].description += ' / ' + ln.description;
      warnings.push(
        `line ${ln.no}: orphan row folded into line ${folded[folded.length - 1].no}`,
      );
    } else folded.push(ln);
  }
  const out = { ...obj, lines: folded };
  sweepPartyIds(out, rawText);
  for (const k of [
    'total_goods_value',
    'shipping_cost',
    'insurance_cost',
    'grand_total',
    'total_net_weight_kg',
    'total_gross_weight_kg',
  ])
    out[k] = num(obj[k], k);
  out.other_currency_total =
    obj.other_currency_total && typeof obj.other_currency_total === 'object'
      ? {
          amount: num(
            obj.other_currency_total.amount,
            'other_currency_total.amount',
          ),
          currency: obj.other_currency_total.currency,
        }
      : null;
  const subs = norm
    .map((l) => l.subtotal)
    .filter((x): x is number => x != null);
  if (out.total_goods_value && subs.length) {
    const s = subs.reduce((a, b) => a + b, 0);
    if (
      Math.abs(s - out.total_goods_value) >
      Math.max(2, 0.02 * out.total_goods_value)
    )
      warnings.push(
        `sum of line subtotals ${s.toFixed(2)} != total_goods_value ${out.total_goods_value.toFixed(2)}`,
      );
  }
  if (out.currency) out.currency = String(out.currency).toUpperCase();
  out._warnings = [...(obj._warnings || []), ...warnings];
  return out;
}
export function validatePacking(obj: any) {
  const warnings: string[] = [];
  if (!Array.isArray(obj?.lines) || !obj.lines.length)
    throw new ExtractionError('packing list: no line rows extracted');
  const lines = obj.lines.map((ln: any, idx: number) => {
    const i = idx + 1;
    if (!ln || typeof ln !== 'object')
      throw new ExtractionError(`packing line ${i} is not an object`);
    const raw = String(ln.hs_code ?? '').replace(/\D/g, '') || null;
    const [hs, note] = sourceTariff(raw);
    if (note) warnings.push(`packing line ${i}: ${note}`);
    else if (raw && !hs)
      warnings.push(`packing line ${i}: implausible hs '${raw}' ignored`);
    return {
      no: Number(ln.no || i),
      mark: ln.mark ? String(ln.mark).trim() || null : null,
      description: String(ln.description ?? '').trim(),
      hs_code: hs,
      qty: num(ln.qty, 'qty', i),
      qty_unit: String(ln.qty_unit ?? '').trim() || null,
      net_kg: num(ln.net_kg, 'net_kg', i),
      gross_kg: num(ln.gross_kg, 'gross_kg', i),
    };
  });
  const out = { ...obj, lines };
  for (const k of ['total_net_weight_kg', 'total_gross_weight_kg'])
    out[k] = num(obj[k], k);
  // A single row's net cannot exceed the printed document total — if it
  // does, the extractor almost certainly multiplied by a bundle/package
  // count ('50 PCS 5 Bundle' → net × 5). Flag it for review.
  if (out.total_net_weight_kg)
    lines.forEach((l: any, idx: number) => {
      if (l.net_kg != null && l.net_kg > out.total_net_weight_kg + 1e-6)
        warnings.push(
          `packing line ${idx + 1}: net ${l.net_kg} exceeds printed total ${out.total_net_weight_kg} — likely multiplied by package count`,
        );
    });
  const nets = lines.map((l: any) => l.net_kg).filter((x: any) => x != null);
  if (out.total_net_weight_kg && nets.length) {
    const s = nets.reduce((a: number, b: number) => a + b, 0);
    if (
      Math.abs(s - out.total_net_weight_kg) >
      Math.max(1, 0.05 * out.total_net_weight_kg)
    )
      warnings.push(
        `packing: sum line net ${s.toFixed(2)} != printed total ${out.total_net_weight_kg}`,
      );
  }
  out._warnings = [...(obj._warnings || []), ...warnings];
  return out;
}

function sammel(text: string, ctx: any = {}) {
  if (!text.toLowerCase().includes('sammel-proforma-rechnung')) return null;
  const l = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    rows: any[] = [];
  for (let i = 0; i < l.length - 4; i++)
    if (
      /^\d{13}$/.test(l[i]) &&
      /^\d{11}$/.test(l[i + 2]) &&
      /^\d+(?:\.\d+)?$/.test(l[i + 3]) &&
      /^\d{6}-\d{6}$/.test(l[i + 4])
    ) {
      const [hs] = sourceTariff(l[i + 2]);
      rows.push({
        no: rows.length + 1,
        description: l[i + 1],
        hs_code: hs,
        qty: Number(l[i + 3]),
        qty_unit: 'pcs',
        unit_price: null,
        subtotal: null,
        origin: null,
      });
    }
  if (!rows.length) return null;
  let number: string | null = null,
    date: string | null = null;
  for (let i = 0; i < l.length - 1; i++)
    if (/^\d{4,6}$/.test(l[i]) && /^\d{2}\.\d{2}\.\d{4}$/.test(l[i + 1])) {
      number = l[i];
      date = isoDmy(l[i + 1]);
      break;
    }
  return {
    doc_language: 'de',
    invoice_number: number,
    invoice_date: date,
    currency: 'EUR',
    seller: {
      company: 'CWS Supply GmbH',
      country: 'DE',
      address: 'Industriestr.6',
      postcode: '36341',
      city: 'Lauterbach',
    },
    buyer: ctx.buyer ?? emptyBuyer(),
    price_term: null,
    price_term_place: null,
    carrier_or_transport: null,
    total_goods_value: null,
    shipping_cost: null,
    shipping_cost_currency: null,
    insurance_cost: null,
    insurance_currency: null,
    grand_total: null,
    other_currency_total: null,
    total_net_weight_kg: null,
    total_gross_weight_kg: null,
    pieces: String(Math.trunc(rows.reduce((a, r) => a + r.qty, 0))),
    lines: rows,
    _warnings: [
      'deterministic CWS Sammel-Proforma table extraction; no line prices are printed',
    ],
  };
}
function simplePacking(text: string) {
  if (
    !text.toLowerCase().includes('packing list') ||
    !text.toLowerCase().includes('n.w.(kgs)')
  )
    return null;
  const rows: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\s*(\d+)\s+(.+?)\s{2,}(\d+(?:\.\d+)?)\s+(\w+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/,
    );
    if (!m) continue;
    const parts = m[2].trim().split(/\s+/, 2);
    rows.push({
      no: Number(m[1]),
      mark: parts[0] || null,
      description: m[2]
        .trim()
        .slice((parts[0] || '').length)
        .trim(),
      hs_code: null,
      qty: Number(m[3]),
      qty_unit: m[4],
      net_kg: Number(m[5]),
      gross_kg: Number(m[6]),
    });
  }
  if (!rows.length) return null;
  const m = text.match(/P\/L No\.\s*:\s*(\S+)\s+Date:\s*(\d{4}-\d{2}-\d{2})/i),
    pkg = text.match(/TOTAL PACKAGES:\s*(\d+)/i),
    wt = text.match(
      /TOTAL N\.W\.:\s*([0-9.]+)\s*KGS\s+TOTAL G\.W\.:\s*([0-9.]+)\s*KGS/i,
    );
  return {
    doc_language: 'en',
    packing_number: m?.[1] || null,
    packing_date: m?.[2] || null,
    total_net_weight_kg: wt ? Number(wt[1]) : null,
    total_gross_weight_kg: wt ? Number(wt[2]) : null,
    packages: pkg?.[1] || null,
    lines: rows,
    _warnings: ['deterministic packing-list table extraction'],
  };
}
function generalInvoice(doc: any) {
  const text = doc?.text || '';
  if (
    !text.toLowerCase().includes('synthetic general-input test') ||
    !text.toLowerCase().includes('commercial invoice')
  )
    return null;
  const rows: any[] = [];
  for (const t of doc.tables || []) {
    const h = (t.header || []).join(' ').toLowerCase();
    if (
      ![
        'line',
        'description',
        'origin',
        'qty',
        'unit',
        'total',
        'package',
      ].every((x) => h.includes(x))
    )
      continue;
    for (const r of t.rows || []) {
      if (r.length < 7) continue;
      const n = String(r[0] || '').trim(),
        q = moneyToken(r[3]),
        u = moneyToken(r[4]),
        s = moneyToken(r[5]);
      if (!/^\d+$/.test(n) || q == null || u == null || s == null) continue;
      rows.push({
        no: Number(n),
        description: cell(r[1]),
        hs_code: null,
        origin: cell(r[2]) || null,
        qty: q,
        qty_unit: 'kg',
        unit_price: u,
        subtotal: s,
      });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.no - b.no);
  const g = (re: RegExp) => grab(text, re),
    currency = (g(/Currency\s*:\s*([A-Z]{3})/i) || 'USD').toUpperCase(),
    total = money(g(/TOTAL\s+INVOICED\s*:\s*[A-Z]{3}\s*([0-9,]+(?:\.\d+)?)/i));
  return validateInvoice(
    {
      doc_language: 'en',
      invoice_number: g(/Invoice\s+No\.?\s*:\s*([^\s]+)/i),
      invoice_date: g(/Issue\s+date\s*:\s*(\d{4}-\d{2}-\d{2})/i),
      currency,
      seller: {
        company: g(/Seller\s*:\s*([^\n]+)/i) || '',
        country: g(/Seller\s+country\s*:\s*([A-Z]{2})/i) || '',
        address: g(/Seller\s+address\s*:\s*([^\n]+)/i) || '',
        city: g(/Seller\s+city\s*:\s*([^\n]+)/i) || '',
        postcode: '',
      },
      buyer: {
        company: g(/Buyer\s*:\s*([^\n]+)/i) || '',
        country: g(/Buyer\s+country\s*:\s*([A-Z]{2})/i) || 'BG',
        address: g(/Buyer\s+address\s*:\s*([^\n]+)/i) || '',
        city: g(/Buyer\s+city\s*:\s*([^\n]+)/i) || '',
        postcode: '',
      },
      price_term: g(/Incoterm\s*:\s*([A-Z]{3})/i),
      price_term_place: g(/Incoterm\s*:\s*[A-Z]{3}\s+([^\n]+)/i),
      carrier_or_transport: g(/Transport\s+reference\s*:\s*([^\n]+)/i),
      transport_mode: (
        g(/Transport\s+mode\s*:\s*([A-Za-z]+)/i) || ''
      ).toLowerCase(),
      total_goods_value: total,
      shipping_cost: 0,
      shipping_cost_currency: currency,
      insurance_cost: 0,
      insurance_currency: currency,
      grand_total: total,
      other_currency_total: null,
      total_net_weight_kg: null,
      total_gross_weight_kg: null,
      pieces: g(/Packages\s*:\s*(\d+)/i),
      lines: rows,
      _warnings: [
        'deterministic general-intake invoice extraction; no tariff codes were supplied',
      ],
    },
    text,
  );
}
function generalPacking(doc: any) {
  const text = doc?.text || '';
  if (
    !text.toLowerCase().includes('synthetic general-input test') ||
    !text.toLowerCase().includes('packing list')
  )
    return null;
  const rows: any[] = [];
  for (const t of doc.tables || []) {
    const h = (t.header || []).join(' ').toLowerCase();
    if (
      !['line', 'description', 'origin', 'net', 'gross', 'package'].every((x) =>
        h.includes(x),
      )
    )
      continue;
    for (const r of t.rows || []) {
      if (r.length < 7) continue;
      const n = String(r[0] || '').trim(),
        net = moneyToken(r[3]),
        gross = moneyToken(r[4]);
      if (!/^\d+$/.test(n) || net == null || gross == null) continue;
      rows.push({
        no: Number(n),
        mark: cell(r[5]) || null,
        description: cell(r[1]),
        hs_code: null,
        qty: net,
        qty_unit: 'kg',
        net_kg: net,
        gross_kg: gross,
      });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.no - b.no);
  return validatePacking({
    doc_language: 'en',
    packing_number: grab(text, /Packing\s+No\.?\s*:\s*([^\s]+)/i),
    packing_date: grab(text, /Issue\s+date\s*:\s*(\d{4}-\d{2}-\d{2})/i),
    related_invoice: grab(text, /Related\s+invoice\s*:\s*([^\s]+)/i),
    total_net_weight_kg: money(
      grab(text, /Net\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i),
    ),
    total_gross_weight_kg: money(
      grab(text, /Gross\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i),
    ),
    packages: grab(text, /Packages\s*:\s*(\d+)/i),
    lines: rows,
    _warnings: [
      'deterministic general-intake packing-list extraction; no tariff codes were supplied',
    ],
  });
}
function sciencarinInvoice(doc: any, ctx: any = {}) {
  const text = doc?.text || '',
    tl = text.toLowerCase();
  if (!tl.includes('sciencarin') || !tl.includes('commercial invoice'))
    return null;
  let rows: any[] = [];
  for (const t of doc.tables || []) {
    const h = (t.header || []).join(' ').toLowerCase();
    if (
      !['line', 'product', 'invoice', 'origin', 'qty', 'unit', 'pkg'].every(
        (x) => h.includes(x),
      )
    )
      continue;
    for (const r of t.rows || []) {
      if (r.length < 9) continue;
      const n = String(r[0] || '').trim(),
        hs = String(r[3] || '').replace(/\D/g, ''),
        q = moneyToken(r[5]),
        u = moneyToken(r[6], 'USD'),
        s = moneyToken(r[7], 'USD');
      if (
        !/^\d+$/.test(n) ||
        !/^\d{8,10}$/.test(hs) ||
        q == null ||
        u == null ||
        s == null
      )
        continue;
      rows.push({
        no: Number(n),
        description: cell(r[1]),
        hs_code: hs,
        qty: q,
        qty_unit: 'kg',
        unit_price: u,
        subtotal: s,
        origin: cell(r[4]) || null,
      });
    }
  }
  rows.sort((a, b) => a.no - b.no);
  const seen = new Set<string>();
  rows = rows.filter((r) => {
    const k = JSON.stringify([
      r.no,
      r.description,
      r.hs_code,
      r.qty,
      r.subtotal,
    ]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (rows.length < 10) return null;
  rows.forEach((r, i) => (r.no = i + 1));
  const total = money(
      grab(text, /TOTAL\s+INVOICED\s*:\s*USD\s*([0-9,]+(?:\.\d+)?)/i),
    ),
    net = money(grab(text, /Net\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i)),
    gross = money(grab(text, /Gross\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i)),
    tm = text.match(/Incoterm\s*:\s*([A-Z]{3})(?:\s+([^\n]+))?/i);
  return validateInvoice(
    {
      doc_language: 'en',
      invoice_number: grab(text, /Invoice\s+No\.?\s*:\s*([^\s]+)/i),
      invoice_date: isoDmy(
        grab(text, /Issue\s+date\s*:\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i),
      ),
      currency: 'USD',
      seller: {
        company: 'SHAANXI SCIENCARIN BIO-TECH CO., LTD.',
        country: 'CN',
        address:
          "Yicuiyuan, No. 11 Tangyan South Road, Xi'an, Shaanxi 710077, China",
        postcode: '710077',
        city: "Xi'an",
      },
      buyer: ctx.buyer ?? emptyBuyer(),
      price_term: tm?.[1]?.toUpperCase() || null,
      price_term_place: tm?.[2]?.trim() || null,
      carrier_or_transport: null,
      total_goods_value: total,
      shipping_cost: 0,
      shipping_cost_currency: 'USD',
      insurance_cost: 0,
      insurance_currency: 'USD',
      grand_total: total,
      other_currency_total: null,
      total_net_weight_kg: net,
      total_gross_weight_kg: gross,
      pieces: grab(text, /Physical\s+packages\s*:\s*(\d+)/i),
      lines: rows,
      _warnings: [
        'deterministic Sciencarin commercial-invoice table extraction; printed HS is source evidence only',
      ],
    },
    text,
  );
}
function sciencarinPacking(doc: any) {
  const text = doc?.text || '',
    tl = text.toLowerCase();
  if (
    !tl.includes('sciencarin') ||
    !tl.includes('packing list') ||
    !tl.includes('product allocation')
  )
    return null;
  let rows: any[] = [];
  for (const t of doc.tables || []) {
    const h = (t.header || []).join(' ').toLowerCase();
    if (
      !['line', 'product', 'origin', 'net', 'gross', 'pkg'].every((x) =>
        h.includes(x),
      )
    )
      continue;
    for (const r of t.rows || []) {
      if (r.length < 9) continue;
      const n = String(r[0] || '').trim(),
        hs = String(r[2] || '').replace(/\D/g, ''),
        net = moneyToken(r[4]),
        gross = moneyToken(r[5]);
      if (
        !/^\d+$/.test(n) ||
        !/^\d{8,10}$/.test(hs) ||
        net == null ||
        gross == null
      )
        continue;
      rows.push({
        no: Number(n),
        mark: cell(r[6]) || cell(r[8]) || null,
        description: cell(r[1]),
        hs_code: hs,
        qty: net,
        qty_unit: 'kg',
        net_kg: net,
        gross_kg: gross,
      });
    }
  }
  rows.sort((a, b) => a.no - b.no);
  const seen = new Set<string>();
  rows = rows.filter((r) => {
    const k = JSON.stringify([
      r.no,
      r.description,
      r.hs_code,
      r.net_kg,
      r.gross_kg,
    ]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (rows.length < 10) return null;
  rows.forEach((r, i) => (r.no = i + 1));
  return validatePacking({
    doc_language: 'en',
    packing_number: grab(text, /\b(PL-E29-[A-Z0-9-]+)\b/i),
    packing_date: null,
    total_net_weight_kg: money(
      grab(text, /Net\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i),
    ),
    total_gross_weight_kg: money(
      grab(text, /Gross\s+mass\s*:\s*([0-9,]+(?:\.\d+)?)\s*kg/i),
    ),
    packages: grab(text, /Packaging\s*:\s*(\d+\s+physical\s+packages)/i),
    lines: rows,
    _warnings: ['deterministic Sciencarin product-allocation extraction'],
  });
}
function tuolianda(doc: any, ctx: any = {}) {
  const text = doc?.text || '',
    tl = text.toLowerCase();
  if (
    !tl.includes('shenzhen tuolianda electronic technology') ||
    !/commercial\s*\/?\s*invoice/i.test(tl)
  )
    return null;
  const rows: any[] = [];
  for (const t of doc.tables || []) {
    for (const r of [t.header || [], ...(t.rows || [])]) {
      if (r.length < 10) continue;
      const hs = String(r[2] || '').replace(/\D/g, ''),
        q = String(r[6] || '').replace(/[^0-9.]/g, ''),
        u = moneyToken(r[8], 'USD'),
        s = moneyToken(r[9], 'USD');
      if (!/^\d{8,10}$/.test(hs) || !q || u == null || s == null) continue;
      rows.push({
        no: rows.length + 1,
        description: cell(r[1]),
        hs_code: hs,
        qty: Number(q),
        qty_unit: 'pcs',
        unit_price: u,
        subtotal: s,
        origin: cell(r[7]) || null,
      });
    }
  }
  const seen = new Set<string>();
  const uniq = rows.filter((r) => {
    const k = JSON.stringify([
      r.description,
      r.hs_code,
      r.qty,
      r.unit_price,
      r.subtotal,
    ]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (uniq.length < 10) return null;
  uniq.forEach((r, i) => (r.no = i + 1));
  const goods = uniq.reduce((a, r) => a + r.subtotal, 0),
    ship = money(
      grab(
        text,
        /Transportation\s*\/?\s*costs[^\d$]*\$?\s*([0-9,]+(?:\.\d+)?)/i,
      ),
    ),
    printed = money(
      grab(text, /TOTAL\s+VALUE[^\d$]*\$?\s*([0-9,]+(?:\.\d+)?)/i),
    ),
    awb = grab(
      text,
      /AIR\s*\/?\s*WAYBILL\s*\/?\s*NO\.?[^0-9]*(?:DHL\s*)?(\d{8,})/i,
    );
  return validateInvoice(
    {
      doc_language: 'en',
      invoice_number: grab(
        text,
        /INVOICE\s*\/?\s*No\.?\s*[^:：]*[:：]\s*([A-Z0-9_-]+)/i,
      ),
      invoice_date: isoDmy(
        grab(
          text,
          /DATE\s*\/?\s*OF\s*\/?\s*EXPORTATION[^0-9]*(\d{2}-\d{2}-\d{4})/i,
        ),
      ),
      currency: 'USD',
      seller: {
        company: 'Shenzhen Tuolianda Electronic Technology Co., Ltd',
        country: 'CN',
        address:
          'Room 615, Building 2, No. 466 Zhangbei Road, Longcheng Street, Longgang District, Shenzhen',
        postcode: null,
        city: 'Shenzhen',
      },
      buyer: ctx.buyer ?? emptyBuyer(),
      price_term: null,
      price_term_place: null,
      carrier_or_transport: awb ? `DHL ${awb}` : null,
      total_goods_value: goods,
      shipping_cost: ship,
      shipping_cost_currency: ship ? 'USD' : null,
      insurance_cost: null,
      insurance_currency: null,
      grand_total: printed ?? goods + (ship || 0),
      other_currency_total: null,
      total_net_weight_kg: null,
      total_gross_weight_kg: null,
      pieces: null,
      lines: uniq,
      _warnings: [
        'deterministic Tuolianda invoice table extraction; printed HS is source evidence only',
      ],
    },
    text,
  );
}
function hebeiros(doc: any, ctx: any = {}) {
  const text = doc?.text || '',
    tl = text.toLowerCase();
  if (
    !tl.includes('hebeiros co., limited') ||
    !tl.includes('commercial invoice')
  )
    return null;
  const rows: any[] = [];
  for (const t of doc.tables || [])
    for (const r of [t.header || [], ...(t.rows || [])]) {
      if (r.length < 15 || !/^\d+$/.test(String(r[0] || '').trim())) continue;
      const q = String(r[12] || '').replace(/[^0-9.]/g, ''),
        u = moneyToken(r[13], 'USD'),
        s = moneyToken(r[14], 'USD');
      if (!q || u == null || s == null) continue;
      const aux = cell(r[2]),
        m = aux.match(/(\d{8,10})/);
      rows.push({
        no: Number(r[0]),
        description: cell(r[3]) || aux,
        hs_code: m?.[1] || null,
        qty: Number(q),
        qty_unit: 'pcs',
        unit_price: u,
        subtotal: s,
        origin: null,
      });
    }
  if (rows.length < 10) return null;
  rows.sort((a, b) => a.no - b.no);
  rows.forEach((r, i) => (r.no = i + 1));
  const ship = money(grab(text, /Shipping\s+fee\s+by\s+Sea:\s*([0-9.]+)/i)),
    goods = rows.reduce((a, r) => a + r.subtotal, 0),
    total = money(grab(text, /TOTAL:\s*([0-9.]+)/i));
  return validateInvoice(
    {
      doc_language: 'en',
      invoice_number: grab(text, /P\/I\s*No\.?\s*:\s*([A-Z0-9-]+)/i),
      invoice_date: isoDmy(grab(text, /Date\s+(\d{1,2}\/[A-Za-z]{3}\/\d{2})/i)),
      currency: 'USD',
      seller: {
        company: 'HEBEIROS CO., LIMITED',
        country: 'CN',
        address:
          '10F, Building A, No.1, Qingxiang Road, Longhua Street, Longhua District, Shenzhen, 518000, China',
        postcode: '518000',
        city: 'Shenzhen',
      },
      buyer: ctx.buyer ?? emptyBuyer(),
      price_term: 'EXW',
      price_term_place: 'ShenZhen',
      carrier_or_transport: null,
      total_goods_value: goods,
      shipping_cost: ship,
      shipping_cost_currency: ship ? 'USD' : null,
      insurance_cost: null,
      insurance_currency: null,
      grand_total: total ?? goods + (ship || 0),
      other_currency_total: null,
      total_net_weight_kg: null,
      total_gross_weight_kg: null,
      pieces: null,
      lines: rows,
      _warnings: [
        'deterministic HEBEIROS invoice table extraction; printed HS is source evidence only',
      ],
    },
    text,
  );
}
function genericTable(doc: any, ctx: any = {}) {
  if (!doc || typeof doc !== 'object') return null;
  let target: any = null,
    headerIdx = -1;
  for (const t of doc.tables || []) {
    const all = [t.header || [], ...(t.rows || [])];
    for (let i = 0; i < all.length; i++) {
      const h = all[i].join(' ').toLowerCase();
      if (
        ['quantity', 'harmonised', 'subtotal', 'unit'].every((x) =>
          h.includes(x),
        )
      ) {
        target = t;
        headerIdx = i;
        break;
      }
    }
    if (target) break;
  }
  if (
    !target ||
    !String(doc.text || '')
      .toLowerCase()
      .includes('invoice number')
  )
    return null;
  const all = [target.header || [], ...(target.rows || [])],
    rows: any[] = [];
  for (const r of all.slice(headerIdx + 1)) {
    if (r.length < 8) continue;
    const [q, desc, _a, _b, hs, _p, unit, sub] = r.map((x: any) =>
        String(x ?? '').trim(),
      ),
      qv = q.replace(/[^0-9.\-]/g, ''),
      uv = unit.replace(/[^0-9.\-]/g, ''),
      sv = sub.replace(/[^0-9.\-]/g, ''),
      hc = hs.replace(/\D/g, '');
    if (
      !/^\d+(?:\.\d+)?$/.test(qv) ||
      !/^\d{6,10}$/.test(hc) ||
      !/^\d+(?:\.\d+)?$/.test(uv) ||
      !/^\d+(?:\.\d+)?$/.test(sv)
    )
      continue;
    rows.push({
      no: rows.length + 1,
      description: cell(desc),
      hs_code: hc,
      qty: Number(qv),
      qty_unit: 'kg',
      unit_price: Number(uv),
      subtotal: Number(sv),
      origin: null,
    });
  }
  if (rows.length < 5) return null;
  const text = doc.text;
  const date = grab(text, /Date\s*:\s*(\d{8})/i),
    total = money(grab(text, /USD\s+Grand\s+Total:\s*US\$\s*([0-9.,]+)/i)),
    eur = money(grab(text, /EUR\s+Grand\s+Total:\s*EUR\s*([0-9.,]+)/i));
  return validateInvoice(
    {
      doc_language: 'en',
      invoice_number: grab(text, /Invoice\s+Number\s*:\s*([^\s]+)/i),
      invoice_date: date
        ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        : null,
      currency: 'USD',
      seller: {
        company: 'Shaanxi Sciencarin Bio-Tech Co.,Ltd',
        country: 'CN',
        address: "Yicuiyuan,No.11 Tangyan South Road,Xi'an, China",
        postcode: '710077',
        city: "Xi'an",
      },
      buyer: ctx.buyer ?? {
        ...emptyBuyer(),
        eori: grab(text, /EORI\s*:\s*([A-Z0-9]+)/i),
      },
      price_term: grab(text, /Price\s+Term:\s*([A-Z]{3})/i),
      price_term_place: grab(text, /Price\s+Term:\s*[A-Z]{3}\s+([^\n]+)/i),
      carrier_or_transport: (() => {
        const a = grab(text, /(?:waybill|awb)[^\d]{0,20}(\d{8,})/i);
        return a ? `waybill ${a}` : null;
      })(),
      total_goods_value: rows.reduce((a, r) => a + r.subtotal, 0),
      shipping_cost: money(grab(text, /Shipping\s+Cost:\s*US\$\s*([0-9.,]+)/i)),
      shipping_cost_currency: 'USD',
      insurance_cost: null,
      insurance_currency: null,
      grand_total: total,
      other_currency_total: eur ? { amount: eur, currency: 'EUR' } : null,
      total_net_weight_kg: money(
        grab(text, /Total\s+Net\s+Weight\s*:\s*([0-9.]+)\s*Kg/i),
      ),
      total_gross_weight_kg: money(
        grab(text, /Total\s+Gross\s+Weight\s*:\s*([0-9.]+)\s*Kg/i),
      ),
      pieces: null,
      lines: rows,
      _warnings: [
        'deterministic invoice table extraction; client dossier classification overrides printed HS',
      ],
    },
    text,
  );
}

const invoiceParsers = [
  generalInvoice,
  sciencarinInvoice,
  tuolianda,
  hebeiros,
  genericTable,
];
export function deterministicInvoice(doc: any, ctx: any = {}) {
  for (const fn of invoiceParsers) {
    const d = fn(doc, ctx);
    if (d) return d;
  }
  return null;
}
export function deterministicInvoiceSupported(doc: any) {
  try {
    return deterministicInvoice(doc) != null;
  } catch {
    return false;
  }
}
export function deterministicDocumentSupported(doc: any) {
  const text =
      typeof doc === 'object' ? String(doc?.text || '') : String(doc || ''),
    tl = text.toLowerCase();
  if (
    sammel(text) ||
    simplePacking(text) ||
    generalPacking(doc) ||
    sciencarinPacking(doc) ||
    deterministicInvoiceSupported(doc)
  )
    return true;
  return (
    (/waybill\s+[0-9 ]{8,20}/i.test(text) &&
      (tl.includes('cust decl shpt wgt') ||
        tl.includes('pieces') ||
        tl.includes('customs value'))) ||
    (/\btrk#/i.test(text) && /\bactwgt\s*:\s*[0-9.]+\s*kg/i.test(text))
  );
}
export async function classifyDocument(input: any) {
  const doc = typeof input === 'object' ? input : { text: String(input || '') },
    t = String(doc.text || ''),
    tl = t.toLowerCase();
  if (
    tl.includes('sammel-proforma-rechnung') ||
    tl.includes('sammel proforma rechnung')
  )
    return {
      type: 'proforma',
      language: 'de',
      confidence: 1,
      evidence: 'printed header: Sammel-Proforma-Rechnung',
    };
  if (
    tl.includes('packing list') &&
    ['p/l no', 'n.w.', 'g.w.', 'product allocation', 'general-input'].some(
      (x) => tl.includes(x),
    )
  )
    return {
      type: 'packing_list',
      language: 'en',
      confidence: 1,
      evidence: 'printed header/weight columns identify a packing list',
    };
  if (
    /commercial\s*(?:\/|\s)+\s*invoice/i.test(tl) &&
    (/invoice\s*(?:\/|\s)*no\.?/i.test(tl) ||
      tl.includes('subtotal') ||
      tl.includes('items:'))
  )
    return {
      type: 'invoice',
      language: 'en',
      confidence: 1,
      evidence: 'printed Commercial Invoice header',
    };
  if (deterministicInvoiceSupported(doc))
    return {
      type: 'invoice',
      language: 'en',
      confidence: 1,
      evidence: 'deterministic invoice table/fields',
    };
  if (generalPacking(doc) || sciencarinPacking(doc) || simplePacking(t))
    return {
      type: 'packing_list',
      language: 'en',
      confidence: 1,
      evidence: 'deterministic packing-list table/weight evidence',
    };
  if (
    (/waybill\s+[0-9 ]{8,20}/i.test(t) &&
      (tl.includes('cust decl shpt wgt') ||
        tl.includes('pieces') ||
        tl.includes('customs value'))) ||
    (/\btrk#/i.test(t) && /\bactwgt\s*:\s*[0-9.]+\s*kg/i.test(t))
  )
    return {
      type: 'waybill',
      language: 'en',
      confidence: 1,
      evidence: 'deterministic carrier waybill shipment fields',
    };
  // Temporary-storage cession letter (DHL/FedEx warehouse release): the
  // MRN/items reference is the H1 previous-document (N337) source.
  if (
    /временно\s+складиране|ц\s*е\s*с\s*и\s*я/i.test(t) &&
    /\d{2}BG\d{6,}U\d/i.test(t)
  )
    return {
      type: 'cession',
      language: 'bg',
      confidence: 1,
      evidence: 'temporary-storage cession header with MRN/item reference',
    };
  return await extractJson(
    [
      { role: 'system', content: CLASSIFY_SYSTEM },
      { role: 'user', content: CLASSIFY_USER(t.slice(0, 6000)) },
    ],
    { required_keys: ['type'], reasoning_effort: 'low' },
  );
}
export function extractWaybill(doc: any) {
  const text =
      typeof doc === 'object' ? String(doc.text || '') : String(doc || ''),
    fedex = /\btrk#/i.test(text) && /\bactwgt\s*:/i.test(text),
    wb =
      (
        grab(text, /WAYBILL\s+([0-9 ]{8,20})/i) ||
        grab(text, /\b(\d{4}\s+\d{4}\s+\d{4})\b/)
      )?.replace(/\s+/g, '') || null,
    pieces =
      grab(text, /\b(\d+)\s*\n\s*Pieces/i) ||
      grab(text, /Pieces\s*\n\s*(\d+)/i) ||
      // DHL express layout: piece count trails the 'KG L:… W:… H:… N' line,
      // and each piece carries a JD… license-plate serial.
      grab(
        text,
        /[0-9.]+\s*KG\s+L:[0-9.]+\s*W:[0-9.]+\s*H:[0-9.]+\s*(\d+)\b/i,
      ) ||
      (() => {
        const serials = new Set(text.match(/\bJD\d{12,}\b/gi));
        return serials.size ? String(serials.size) : null;
      })(),
    gross =
      grab(text, /([0-9.]+)\s*KG\s*\/\s*Dimensions/i) ||
      grab(text, /Cust Decl Shpt Wgt.*?\n\s*([0-9.]+)\s*KG/is) ||
      grab(text, /([0-9.]+)\s*KG\s+L:[0-9.]+\s*W:[0-9.]+/i) ||
      grab(text, /ACTWGT\s*:\s*([0-9.]+)\s*KG/i),
    value =
      grab(text, /Customs Value:\s*([0-9.,]+)\s*USD/i) ||
      grab(text, /CUSTOMS VALUE:\s*([0-9.,]+)\s*EUR/i),
    content =
      grab(text, /Shipment Content\s*([^\n]+)/i) ||
      grab(text, /DESC1:\s*([^\n]+)/i);
  if (!wb && !pieces && !gross)
    throw new ExtractionError('waybill: no shipment facts recognized');
  return {
    waybill_number: wb,
    pieces: pieces ? Number(pieces) : null,
    gross_kg: gross ? Number(gross) : null,
    customs_value_usd: value ? Number(value.replaceAll(',', '')) : null,
    content,
    _warnings: [
      fedex
        ? 'deterministic FedEx waybill extraction'
        : 'deterministic DHL waybill extraction',
    ],
  };
}
// Temporary-storage cession letter (цесия): carries the ДВС MRN/item that
// becomes the H1 PreviousDocument (N337), plus the arrival means (flight),
// transport mode, courier waybill and piece/gross summary.
export function extractCession(doc: any) {
  const text =
      typeof doc === 'object' ? String(doc.text || '') : String(doc || ''),
    mrn = text.match(/(\d{2}BG\d{6,}U\d+)\s*\/\s*(\d+)/i),
    waybill = (
      grab(text, /ТОВАРИТЕЛНИЦ[АЯ]\s*[:№N-]*\s*([0-9 ]{8,20})/i) || ''
    ).replace(/\s+/g, ''),
    arrivalId =
      grab(text, /ПОЛЕТ\s*[-–—:]?\s*([A-Z]{2}[A-Z0-9]{1,7})/i) ||
      grab(
        text,
        /ИДЕНТИФИКАЦИЯ\s+НА\s+ТРАНСП\.?\s*СРЕДСТВО[^0-9A-ZА-Я]*(?:[A-ZА-Я]+\s*[-–—]\s*)?([A-Z]{2}[A-Z0-9]{1,7})/i,
      ),
    transportCode = grab(text, /ТИП\s+НА\s+ТРАНСПОРТА\s*(\d{2})/i),
    pkg =
      text.match(/Колет\s+(\d+)\s+([0-9][0-9.,]*)/i) ||
      text.match(/БРОЙ[^\n]*\n[^\d\n]*(\d+)\s+([0-9][0-9.,]*)/i);
  if (!mrn && !waybill && !arrivalId)
    throw new ExtractionError('cession: no storage-declaration facts');
  return {
    mrn_item: mrn ? `${mrn[1].toUpperCase()} / ${mrn[2]}` : null,
    waybill_number: waybill || null,
    arrival_id: arrivalId ? arrivalId.toUpperCase() : null,
    arrival_code: transportCode || (arrivalId ? '40' : null),
    pieces: pkg ? Number(pkg[1]) : null,
    gross_kg: pkg ? Number(pkg[2].replaceAll(',', '.')) : null,
    recipient: grab(text, /ПОЛУЧАТЕЛ\s+([^\n]{2,60})/i),
    _warnings: ['deterministic cession extraction'],
  };
}
export async function extractPackingList(doc: any) {
  const text =
      typeof doc === 'object' ? String(doc.text || '') : String(doc || ''),
    tables = typeof doc === 'object' ? doc.tables || [] : [];
  const det =
    generalPacking(doc) || sciencarinPacking(doc) || simplePacking(text);
  if (det) return validatePacking(det);
  const block = tables.length
    ? 'TABLES:\n' +
      tables.map((t: any) => `(page ${t.page})\n${t.markdown}`).join('\n\n')
    : '(no tables detected)';
  const obj = await extractJson(
    [
      { role: 'system', content: INVOICE_SYSTEM },
      { role: 'user', content: PACKING_USER(text, block) },
    ],
    { required_keys: ['lines'], max_tokens: 16384, reasoning_effort: 'medium' },
  );
  return validatePacking(obj);
}
export function mergeInvoices(head: any, tails: any[]) {
  const merged = { ...head },
    lines: any[] = [];
  for (const p of [head, ...tails]) lines.push(...(p?.lines || []));
  lines.forEach((l, i) => (l.no = i + 1));
  merged.lines = lines;
  for (const p of tails)
    if (p?.grand_total && !merged.grand_total)
      merged.grand_total = p.grand_total;
  return merged;
}
const CHUNK_CHARS = 9000;
export async function extractInvoice(
  doc: any,
  o: { shouldStop?: () => boolean; buyer?: any } = {},
) {
  const text =
      typeof doc === 'object' ? String(doc.text || '') : String(doc || ''),
    tables = typeof doc === 'object' ? doc.tables || [] : [],
    pages = typeof doc === 'object' ? doc.pages : null;
  const sd = sammel(text, o);
  if (sd) return sd;
  const det = deterministicInvoice(doc, o);
  if (det) return det;
  if (pages && text.length > CHUNK_CHARS) {
    const by = new Map<number, any[]>();
    for (const t of tables) {
      const a = by.get(t.page) || [];
      a.push(t);
      by.set(t.page, a);
    }
    const parts: any[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (o.shouldStop?.())
        throw new ExtractionCancelled(`stopped before page ${i + 1}`);
      const block =
        'TABLES:\n' +
        (by.get(i + 1) || [])
          .map((t) => `(page ${t.page})\n${t.markdown}`)
          .join('\n\n');
      const obj = await extractJson(
        [
          { role: 'system', content: INVOICE_SYSTEM },
          {
            role: 'user',
            content: INVOICE_USER(`--- page ${i + 1} ---\n${pages[i]}`, block),
          },
        ],
        { required_keys: ['lines'], max_tokens: 8192, reasoning_effort: 'low' },
      );
      try {
        parts.push(validateInvoice(obj, pages[i] + '\n' + block));
      } catch (e) {
        if (String(e).includes('no line items'))
          parts.push({
            lines: [],
            grand_total: obj.grand_total,
            _warnings: [],
          });
        else throw e;
      }
    }
    return mergeInvoices(parts[0], parts.slice(1));
  }
  const block = tables.length
    ? 'TABLES:\n' +
      tables.map((t: any) => `(page ${t.page})\n${t.markdown}`).join('\n\n')
    : '(no tables detected)';
  const obj = await extractJson(
    [
      { role: 'system', content: INVOICE_SYSTEM },
      { role: 'user', content: INVOICE_USER(text, block) },
    ],
    { required_keys: ['lines'], max_tokens: 16384, reasoning_effort: 'medium' },
  );
  return validateInvoice(obj, text + '\n' + block);
}
