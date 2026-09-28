import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { catalogDir, clientsDir } from './paths.js';
const clean = (s: any) =>
  String(s ?? '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const code10 = (v: any) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 8 ? d + '00' : d.length === 10 ? d : null;
};
const baseBg = (v: any) =>
  clean(v)
    .replace(/\s*-\s*[0-9][0-9.,]*\s*(?:кг|КГ|KG|kg)\.?/gi, '')
    .replace(/\s+CAS\s*(?:No\.?|НОМЕР)?\s*[:#]?\s*[0-9A-Za-z\-]+.*$/i, '')
    .trim();
async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
export async function importClientXlsx(
  file: string,
  clientId: string,
  directory = catalogDir(),
) {
  const wb = XLSX.readFile(file, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
  });
  if (!rows.length) throw new Error(`empty client catalog: ${file}`);
  const hdr = rows[0].map((x) =>
      String(x || '')
        .trim()
        .toLowerCase(),
    ),
    ien = hdr.indexOf('en'),
    ibg = hdr.indexOf('bg'),
    ihs = hdr.indexOf('hs');
  if (ihs < 0) throw new Error('client spreadsheet needs an HS column');
  const entries: any[] = [],
    seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const en = clean(ien >= 0 ? row[ien] : ''),
      bg = baseBg(ibg >= 0 ? row[ibg] : ''),
      code = code10(row[ihs]);
    if (!code || (!en && !bg)) continue;
    const key = (en || bg).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const extra1 = clean(row[3]),
      extra2 = clean(row[4]);
    entries.push({
      key: en || bg,
      aliases: [bg, en].filter(
        (x) => x && x.toLowerCase() !== (en || bg).toLowerCase(),
      ),
      bg_name: bg || en,
      bg_phrase: '',
      hs: {
        hs6: code.slice(0, 6),
        cn: code.slice(6, 8),
        taric: code.slice(8, 10),
      },
      origin: 'CN',
      map_group: `code:${code}`,
      source: 'client_dossier_xlsx',
      dossier_file: path.basename(file),
      preference: '100',
      inv_dest: '3',
      valuation_indicator: '0010',
      taric_add_codes: [extra1, extra2].filter((x) =>
        /^[A-Z0-9]{3,6}$/.test(x),
      ),
    });
  }
  const outdir = path.join(directory, 'clients');
  await fs.mkdir(outdir, { recursive: true });
  const out = path.join(outdir, `${clientId}.json`);
  let existing: any[] = [];
  if (await exists(out)) existing = JSON.parse(await fs.readFile(out, 'utf8'));
  const imported = new Set(entries.map((e) => e.key)),
    merged = [...entries, ...existing.filter((e) => !imported.has(e.key))];
  if (await exists(out)) {
    const vdir = path.join(outdir, `${clientId}.versions`);
    await fs.mkdir(vdir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    await fs.copyFile(out, path.join(vdir, `${stamp}.json`));
  }
  await fs.writeFile(out, JSON.stringify(merged, null, 2), 'utf8');
  return {
    client_id: clientId,
    source: path.basename(file),
    entries: entries.length,
    total_entries: merged.length,
    path: out,
  };
}
export async function addClientAliases(
  clientId: string,
  aliases: string[],
  directory = clientsDir(),
) {
  const p = path.join(directory, `${clientId}.json`),
    tpl = JSON.parse(await fs.readFile(p, 'utf8'));
  tpl.aliases = [...new Set([...(tpl.aliases || []), ...aliases])].sort();
  await fs.writeFile(p, JSON.stringify(tpl, null, 2), 'utf8');
  return tpl;
}
