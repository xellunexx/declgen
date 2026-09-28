import fs from 'node:fs/promises';
import path from 'node:path';
export const BNB_CSV_URL =
  'https://www.bnb.bg/Statistics/StExternalSector/StExchangeRates/StERForeignCurrencies/index.htm?download=csv&search=';
export const ECB_XML_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export class FxError extends Error {}
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '',
    q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
export function parseBnbCsv(text: string) {
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(csvLine);
  if (rows.length < 3 || rows[1].length < 5 || rows[1][2].trim() !== 'Код')
    throw new FxError('unexpected BNB CSV shape (headers changed?)');
  const rates: Record<string, { per_eur: number; eur_per_unit: number }> = {};
  for (const r of rows.slice(2)) {
    if (r.length < 5) continue;
    const code = r[2].trim().toUpperCase();
    if (!code) continue;
    const a = Number(r[3].trim()),
      b = Number(r[4].trim());
    if (!Number.isFinite(a) || !Number.isFinite(b))
      throw new FxError(`bad BNB row for ${code}`);
    rates[code] = { per_eur: a, eur_per_unit: b };
  }
  if (!rates.USD) throw new FxError('USD row missing in BNB CSV');
  const m = rows[2][0].trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new FxError(`bad BNB date cell: ${rows[2][0]}`);
  return { date: `${m[3]}-${m[2]}-${m[1]}`, rates };
}
// ECB publishes the official euro reference rates BNB mirrors: <Cube currency='USD' rate='1.1652'/>
export function parseEcbXml(text: string) {
  const time = text.match(/<Cube time='(\d{4}-\d{2}-\d{2})'/);
  if (!time) throw new FxError('unexpected ECB XML shape');
  const rates: Record<string, { per_eur: number; eur_per_unit: number }> = {};
  for (const m of text.matchAll(
    /<Cube currency='([A-Z]{3})' rate='([0-9.]+)'\/>/g,
  )) {
    const per = Number(m[2]);
    if (Number.isFinite(per) && per > 0)
      rates[m[1]] = { per_eur: per, eur_per_unit: 1 / per };
  }
  if (!rates.USD) throw new FxError('USD missing in ECB XML');
  return { date: time[1], rates };
}
async function fetchText(url: string, timeout: number) {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'user-agent': 'declgen/1.0' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}
export async function fetchDaily(url = BNB_CSV_URL, timeout = 20000) {
  try {
    return parseBnbCsv(await fetchText(url, timeout));
  } catch (e) {
    try {
      return parseEcbXml(await fetchText(ECB_XML_URL, timeout));
    } catch (e2) {
      throw new FxError(`BNB fetch failed: ${e}; ECB fallback failed: ${e2}`);
    }
  }
}
export async function getRate(
  ccy: string,
  on = new Date(),
  cacheDir?: string,
  fetcher = fetchDaily,
) {
  ccy = String(ccy || '')
    .trim()
    .toUpperCase();
  const date = on.toISOString().slice(0, 10);
  if (ccy === 'EUR') return { rate: 1, date, currency: 'EUR', cached: false };
  if (!/^[A-Z]{3}$/.test(ccy))
    throw new FxError(`bad currency code: ${JSON.stringify(ccy)}`);
  const cf = cacheDir ? path.join(cacheDir, `fx-${date}.json`) : '';
  if (cf) {
    try {
      const d = JSON.parse(await fs.readFile(cf, 'utf8'));
      if (d.rates?.[ccy])
        return {
          rate: Number(d.rates[ccy].eur_per_unit),
          date: d.date,
          currency: ccy,
          cached: true,
        };
    } catch {}
  }
  const d = await fetcher();
  if (cacheDir) {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cf, JSON.stringify(d, null, 2), 'utf8');
  }
  if (!d.rates[ccy]) throw new FxError(`BNB publishes no rate for ${ccy}`);
  return {
    rate: d.rates[ccy].eur_per_unit,
    date: d.date,
    currency: ccy,
    cached: false,
  };
}
