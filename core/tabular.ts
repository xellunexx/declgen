import fs from 'node:fs/promises';
import path from 'node:path';
function parseCsvLine(line: string, delim: string) {
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
    } else if (c === delim && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
function detect(text: string) {
  const lines = text.split(/\r?\n/).slice(0, 20);
  let best = ',',
    score = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines
      .map((l) => parseCsvLine(l, d).length)
      .filter((n) => n > 1);
    const s = counts.length ? counts.filter((n) => n === counts[0]).length : 0;
    if (s > score) {
      score = s;
      best = d;
    }
  }
  return best;
}
function md(rows: string[][]) {
  if (!rows.length) return '';
  return `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows
    .slice(1)
    .map((r) => `| ${r.join(' | ')} |`)
    .join('\n')}`;
}
export async function load(filePath: string) {
  const ext = path.extname(filePath).toLowerCase(),
    text = (await fs.readFile(filePath))
      .toString('utf8')
      .replace(/^\uFEFF/, '');
  if (ext === '.xml')
    return { text, pages: [text], tables: [], source: filePath, kind: 'xml' };
  if (ext === '.csv') {
    const d = detect(text),
      rows = text
        .split(/\r?\n/)
        .map((l) => parseCsvLine(l, d))
        .filter((r) => r.some((c) => c.trim()));
    return {
      text,
      pages: [text],
      tables: rows.length
        ? [
            {
              page: 1,
              markdown: md(rows),
              header: rows[0],
              rows: rows.slice(1),
            },
          ]
        : [],
      source: filePath,
      kind: 'csv',
    };
  }
  throw new Error(`unsupported tabular doc: ${ext}`);
}
