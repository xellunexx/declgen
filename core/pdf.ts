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
interface Cell {
  x0: number;
  x1: number;
  t: string;
}
interface CellLine {
  y: number;
  cells: Cell[];
}
const numericCell = (t: string) => /^[$€£]?-?[\d.,'’]*\d$/.test(t.trim());
// A "data line" holds >=2 numeric cells (qty, price, HS, totals). Wrapped cell
// text sits on its own y-lines with only name/description content — those are
// continuations, not rows.
const isDataLine = (line: CellLine) =>
  line.cells.filter((c) => numericCell(c.t)).length >= 2;
// Reassemble logical table rows: cells may wrap onto lines above and below the
// data line (vertically centered cells). Between two data lines, earlier
// continuation lines belong to the previous row's wrapped bottom, the last one
// to the next row's wrapped top.
export function logicalRows(lines: CellLine[]): string[][] {
  const colStarts: number[] = [];
  for (const l of lines)
    for (const c of l.cells)
      if (!colStarts.some((x) => Math.abs(x - c.x0) <= 8)) colStarts.push(c.x0);
  colStarts.sort((a, b) => a - b);
  const colOf = (x0: number) => {
    let c = 0;
    for (let i = 0; i < colStarts.length; i++)
      if (colStarts[i] <= x0 + 2) c = i;
    return c;
  };
  const rows: Map<number, string>[] = [];
  let headerLines: CellLine[] = [],
    pending: CellLine[] = [],
    last: Map<number, string> | null = null;
  const mergeInto = (
    row: Map<number, string>,
    line: CellLine,
    first = false,
  ) => {
    for (const c of line.cells) {
      const k = colOf(c.x0),
        cur = row.get(k) ?? '';
      row.set(k, cell(first ? `${c.t} ${cur}` : `${cur} ${c.t}`));
    }
  };
  for (const line of lines) {
    if (isDataLine(line)) {
      const rowCols = new Set(line.cells.map((c) => colOf(c.x0)));
      if (last && pending.length > 1) {
        // all but the last continuation line close the previous row
        for (const pl of pending.slice(0, -1)) mergeInto(last, pl);
        pending = pending.slice(-1);
      } else if (!last && pending.length) {
        // Before the first data row, a pending line is a leading cell wrap only
        // if it fills columns this row leaves empty; otherwise it's the header.
        const tail = pending[pending.length - 1];
        if (tail.cells.every((c) => !rowCols.has(colOf(c.x0)))) {
          headerLines = pending.slice(0, -1);
          pending = pending.slice(-1);
        } else {
          headerLines = pending;
          pending = [];
        }
      }
      const row = new Map<number, string>();
      for (const pl of pending) mergeInto(row, pl, true);
      mergeInto(row, line);
      rows.push(row);
      last = row;
      pending = [];
    } else pending.push(line);
  }
  if (last) for (const pl of pending) mergeInto(last, pl);
  // Header: the contiguous run of text-only lines immediately above the first
  // data row (document-header prose has no numbers but sits further away).
  const ncol = Math.max(colStarts.length, ...rows.map((r) => r.size));
  const firstRowY = lines.find((l) => isDataLine(l))?.y ?? 0;
  const header = new Map<number, string>();
  for (const hl of headerLines) {
    if (hl.cells.some((c) => numericCell(c.t))) continue;
    if (Math.abs(firstRowY - hl.y) > 40) continue;
    mergeInto(header, hl);
  }
  const fill = (m: Map<number, string>) =>
    Array.from({ length: ncol }, (_, i) => m.get(i) ?? '');
  return [fill(header), ...rows.map(fill)];
}
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
    const matrix: CellLine[] = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, a]) => {
        const cells: Cell[] = [];
        let cur: TextChunk | null = null;
        for (const ch of a.sort((x, y) => x.x - y.x)) {
          if (cur && ch.x - cur.end <= Math.max(4, ch.size * 0.6)) {
            cur.t += ' ' + ch.t;
            cur.end = Math.max(cur.end, ch.end);
          } else {
            if (cur) cells.push({ x0: cur.x, x1: cur.end, t: cell(cur.t) });
            cur = { ...ch };
          }
        }
        if (cur) cells.push({ x0: cur.x, x1: cur.end, t: cell(cur.t) });
        return { y, cells };
      });
    const grid = logicalRows(matrix);
    const data = grid.slice(1).filter((r) => r.some((c) => c));
    if (data.length >= 3) {
      const header = grid[0].some((c) => c)
        ? grid[0]
        : grid[0].map((_, i) => `col${i + 1}`);
      const md = `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${data.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
      out.push({ page: n, header, rows: data, markdown: md });
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
