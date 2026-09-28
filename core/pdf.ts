import fs from 'node:fs/promises';
import path from 'node:path';
async function loadPdf(filePath: string) {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return await pdf.getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
  }).promise;
}
export interface TextChunk {
  x: number;
  y: number;
  end: number;
  size: number;
  t: string;
}
// pdf.js may emit each glyph as a separate item (letter-spaced PDFs); blindly
// joining items with ' ' turns every word into "H u n a n". Merge items into
// word-level chunks: same visual line, small x-gap = same word. Whitespace is
// either a real item or a wider x-gap between items — both are honoured, since
// some PDFs (and their bogus space widths) only have one of the two.
export function mergeTextItems(
  items: any[],
  yBucket = 2,
  gapEms = 0.15,
): TextChunk[] {
  const rows = new Map<number, any[]>();
  for (const it of items) {
    if (!('str' in it) || String(it.str) === '') continue;
    const y = Math.round((it.transform?.[5] ?? 0) / yBucket) * yBucket;
    const arr = rows.get(y) ?? [];
    arr.push(it);
    rows.set(y, arr);
  }
  const chunks: TextChunk[] = [];
  for (const [y, its] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    its.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));
    let cur: TextChunk | null = null;
    for (const it of its) {
      const s = String(it.str),
        x = it.transform?.[4] ?? 0,
        w = it.width ?? 0,
        size = Math.abs(it.transform?.[3]) || it.height || 8;
      if (s.trim() === '') {
        if (cur) {
          chunks.push(cur);
          cur = null;
        }
        continue;
      }
      const gap = cur ? x - cur.end : Infinity;
      if (cur && gap <= Math.max(0.8, size * gapEms)) {
        cur.t += s;
        cur.end = Math.max(cur.end, x + w);
        cur.size = Math.max(cur.size, size);
      } else {
        if (cur) chunks.push(cur);
        cur = { x, y, end: x + w, size, t: s };
      }
    }
    if (cur) chunks.push(cur);
  }
  return chunks;
}
export async function extractPages(filePath: string): Promise<string[]> {
  const doc = await loadPdf(filePath),
    out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const c: any = await p.getTextContent();
    let lastY: number | null = null,
      line: string[] = [];
    const lines: string[] = [];
    for (const ch of mergeTextItems(c.items)) {
      if (lastY !== null && Math.abs(ch.y - lastY) > 2) {
        if (line.length) lines.push(line.join(' '));
        line = [];
      }
      line.push(ch.t);
      lastY = ch.y;
    }
    if (line.length) lines.push(line.join(' '));
    out.push(lines.join('\n'));
  }
  return out;
}
export async function extractText(filePath: string) {
  const p = await extractPages(filePath);
  return p.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n');
}
export async function listPdfs(folder: string) {
  return (await fs.readdir(folder, { withFileTypes: true }))
    .filter((x) => x.isFile() && x.name.toLowerCase().endsWith('.pdf'))
    .map((x) => path.join(folder, x.name))
    .sort();
}
export async function dossierTexts(folder: string) {
  const out: Record<string, string> = {};
  for (const p of await listPdfs(folder))
    out[path.basename(p)] = await extractText(p);
  return out;
}
const cell = (s: string) => s.trim().replace(/\s+/g, ' ');
export async function findTables(filePath: string) {
  const doc = await loadPdf(filePath),
    out: any[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const c: any = await p.getTextContent();
    const chunks = mergeTextItems(c.items, 3);
    const rows = new Map<number, TextChunk[]>();
    for (const ch of chunks) {
      const arr = rows.get(ch.y) ?? [];
      arr.push(ch);
      rows.set(ch.y, arr);
    }
    // Merge word chunks into cells: intra-cell gaps are word spacing (small),
    // inter-column gaps are wide. Letter-spaced PDFs otherwise emit a column per glyph.
    const matrix = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, a]) => {
        const cells: string[] = [];
        let cur: TextChunk | null = null;
        for (const ch of a.sort((x, y) => x.x - y.x)) {
          if (cur && ch.x - cur.end <= Math.max(4, ch.size * 0.6)) {
            cur.t += ' ' + ch.t;
            cur.end = Math.max(cur.end, ch.end);
          } else {
            if (cur) cells.push(cell(cur.t));
            cur = { ...ch };
          }
        }
        if (cur) cells.push(cell(cur.t));
        return cells;
      })
      .filter((r) => r.length >= 2);
    if (matrix.length >= 3) {
      const cols = Math.max(...matrix.map((r) => r.length));
      const good = matrix.filter(
        (r) => r.length >= Math.max(2, Math.floor(cols * 0.6)),
      );
      if (good.length >= 3) {
        const header = good[0],
          data = good.slice(1);
        const md = `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${data.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
        out.push({ page: n, header, rows: data, markdown: md });
      }
    }
  }
  return out;
}
export async function extractDocument(filePath: string) {
  const pages = await extractPages(filePath);
  return {
    name: path.basename(filePath),
    text: pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n'),
    pages,
    tables: await findTables(filePath),
  };
}
