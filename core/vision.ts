import { createCanvas } from '@napi-rs/canvas';
import { getStatus, stripFences } from './llm.js';
import {
  ExtractionCancelled,
  ExtractionError,
  mergeInvoices,
  validateInvoice,
} from './extract.js';
export const DEFAULT_VISION_URL = 'http://127.0.0.1:10001/v1/chat/completions';
export const CURRENT = { url: DEFAULT_VISION_URL, api_key: '', model: 'local' };
export function configureVision(
  url: string,
  key?: string | null,
  model?: string | null,
) {
  CURRENT.url = url.replace(/\/$/, '');
  if (key != null) CURRENT.api_key = key.trim();
  if (model != null) CURRENT.model = model.trim() || 'local';
}
const comp = (u: string) =>
  u.replace(/\/$/, '').endsWith('/chat/completions')
    ? u.replace(/\/$/, '')
    : `${u.replace(/\/$/, '')}/chat/completions`;
const base = (u: string) => {
  let x = u.replace(/\/$/, '');
  for (const t of ['/v1/chat/completions', '/v1'])
    if (x.endsWith(t)) x = x.slice(0, -t.length);
  return x;
};
const hdr = () => ({
  'content-type': 'application/json',
  ...(CURRENT.api_key ? { authorization: `Bearer ${CURRENT.api_key}` } : {}),
});
export async function visionServerUp(url = CURRENT.url, timeout = 3000) {
  const b = base(url);
  if ((await getStatus(`${b}/health`, timeout, CURRENT.api_key)) === 200)
    return true;
  return (await getStatus(`${b}/v1/models`, timeout, CURRENT.api_key)) !== null;
}
async function pdfjs() {
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}
export async function renderPages(
  filePath: string,
  maxSide = 1000,
): Promise<Buffer[]> {
  const fs = await import('node:fs/promises');
  const pdf = await pdfjs();
  const doc = await pdf.getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
  }).promise;
  const out: Buffer[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const vp0 = p.getViewport({ scale: 1 });
    const scale = maxSide / Math.max(vp0.width, vp0.height, 1);
    const vp = p.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await p.render({
      canvasContext: canvas.getContext('2d') as any,
      canvas: canvas as any,
      viewport: vp,
    }).promise;
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}
const SYSTEM =
  'You read Bulgarian customs invoice pages from scans. Transcribe faithfully. Never invent values; unreadable cells become null. Reply with strict JSON only.';
const USER = `Read this invoice page image and extract JSON with invoice_number, invoice_date, currency, seller, buyer, price_term, price_term_place, carrier_or_transport, total_goods_value, shipping_cost, insurance_cost, grand_total, other_currency_total, total_net_weight_kg, total_gross_weight_kg, pieces and lines [{no,description,hs_code,qty,qty_unit,unit_price,subtotal,origin}]. Every goods row = one line. JSON only.`;
async function chatImage(
  png: Buffer,
  url = comp(CURRENT.url),
  maxTokens = 8192,
  timeout = 240000,
) {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: hdr(),
      signal: c.signal,
      body: JSON.stringify({
        model: CURRENT.model || 'local',
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${png.toString('base64')}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d: any = await r.json();
    return String(d?.choices?.[0]?.message?.content ?? '');
  } finally {
    clearTimeout(t);
  }
}
export async function verifyVision() {
  const canvas = createCanvas(64, 64),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'white';
  ctx.font = '36px sans-serif';
  ctx.fillText('7', 24, 44);
  const t = Date.now();
  const raw = await chatImage(
    canvas.toBuffer('image/png'),
    comp(CURRENT.url),
    40,
    90000,
  );
  return {
    ok: true,
    latency_s: Math.round((Date.now() - t) / 100) / 10,
    reply: raw.slice(0, 120),
    image_understood: raw.includes('7'),
  };
}
export async function extractScannedInvoice(
  filePath: string,
  o: {
    maxSide?: number;
    shouldStop?: () => boolean;
    progress?: (s: string) => void;
  } = {},
) {
  const pages = await renderPages(filePath, o.maxSide ?? 1000),
    parts: any[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (o.shouldStop?.())
      throw new ExtractionCancelled(`stopped before page ${i + 1}`);
    o.progress?.(`ОПР стр. ${i + 1}/${pages.length}`);
    const raw = await chatImage(pages[i]);
    let obj: any;
    try {
      obj = JSON.parse(stripFences(raw));
    } catch (e) {
      throw new ExtractionError(`page ${i + 1}: unreadable JSON: ${e}`);
    }
    try {
      parts.push(validateInvoice(obj));
    } catch (e) {
      if (String(e).includes('no line items'))
        parts.push({ lines: [], grand_total: obj.grand_total, _warnings: [] });
      else throw e;
    }
  }
  const merged = mergeInvoices(parts[0], parts.slice(1));
  merged._source = `vision:${o.maxSide ?? 1000}px`;
  return merged;
}
