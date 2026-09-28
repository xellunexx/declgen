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
// Mirrors looksLikeBareCode in extract.ts: a token is descriptive when it is a
// word >=4 chars with no digits and not an ALL-CAPS abbreviation. A cell whose
// tokens are all non-descriptive is a bare code like '180mm' or 'pcs'.
const bareCode = (t: string) =>
  !t
    .split(/[^0-9A-Za-zА-Яа-я]+/)
    .some(
      (w) =>
        w.length >= 4 &&
        !/\d/.test(w) &&
        !(w.toUpperCase() === w && w.length <= 6),
    );
const UNIT_WORD = /^(pcs?|set|kg|bundles?|box|pallet|rolls?|cartons?)$/i;
interface MCell {
  t: string;
  cont: boolean; // true when every merged part came from a continuation line
  y: number; // source line of the last merged part
}
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
  const rows: Map<number, MCell>[] = [];
  let headerLines: CellLine[] = [],
    pending: CellLine[] = [],
    last: Map<number, MCell> | null = null;
  const mergeInto = (
    row: Map<number, MCell>,
    line: CellLine,
    first = false,
    cont = false,
  ) => {
    for (const c of line.cells) {
      const k = colOf(c.x0),
        cur = row.get(k);
      row.set(k, {
        t: cell(first ? `${c.t} ${cur?.t ?? ''}` : `${cur?.t ?? ''} ${c.t}`),
        cont: cont && (cur?.cont ?? true),
        y: line.y,
      });
    }
  };
  for (const line of lines) {
    if (isDataLine(line)) {
      const rowCols = new Set(line.cells.map((c) => colOf(c.x0)));
      if (last && pending.length > 1) {
        // all but the last continuation line close the previous row
        for (const pl of pending.slice(0, -1)) mergeInto(last, pl, false, true);
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
      const row = new Map<number, MCell>();
      for (const pl of pending) mergeInto(row, pl, true, true);
      mergeInto(row, line);
      rows.push(row);
      last = row;
      pending = [];
    } else pending.push(line);
  }
  if (last) for (const pl of pending) mergeInto(last, pl, false, true);
  // Package/pallet detail rows carry no item number — their S/N cell is empty
  // and the boxes/size/weight cells belong to the preceding numbered row.
  const snHits = new Map<number, number>();
  for (const r of rows)
    for (const [k, c] of r)
      if (/^-?\d{1,3}$/.test(c.t)) snHits.set(k, (snHits.get(k) ?? 0) + 1);
  const snCol = [...snHits.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  )[0]?.[0];
  if (snCol != null && (snHits.get(snCol) ?? 0) >= rows.length / 2) {
    const merged: Map<number, MCell>[] = [];
    for (const r of rows) {
      const prev = merged[merged.length - 1];
      if (prev && !(r.get(snCol)?.t ?? '').trim())
        for (const [k, c] of r) {
          const cur = prev.get(k);
          prev.set(k, {
            t: cell(`${cur?.t ?? ''} ${c.t}`),
            cont: cur ? cur.cont && c.cont : c.cont,
            y: c.y,
          });
        }
      else merged.push(r);
    }
    rows.length = 0;
    rows.push(...merged);
  }
  // Vertically-merged name cells are drawn once across a block of variant
  // rows, so the lower rows' name region is empty and the model/size sits
  // alone where the description should be. Refill such rows from the name
  // cells of the contiguous block above. The block's text lines sit ~one line
  // height apart; a larger y-gap means a different (unmerged) product's name.
  const middles = rows.map((r) => {
    const e = [...r.entries()].sort((a, b) => a[0] - b[0]);
    const ni = e.findIndex(([, c]) => /^-?\d{1,3}$/.test(c.t));
    const mid: [number, MCell][] = [];
    for (const pair of ni < 0 ? e : e.slice(ni + 1)) {
      if (numericCell(pair[1].t)) break;
      mid.push(pair);
    }
    return mid;
  });
  for (let i = 0; i < rows.length; i++) {
    const mid = middles[i];
    if (
      !mid.length ||
      !mid.every(([, c]) => bareCode(c.t) || UNIT_WORD.test(c.t))
    )
      continue;
    const parts: { col: number; t: string; y: number }[] = [];
    let lastY = Infinity;
    for (let j = i - 1; j >= 0; j--) {
      if (!middles[j].some(([, c]) => bareCode(c.t))) break;
      const names = middles[j].filter(
        ([, c]) => !bareCode(c.t) && !UNIT_WORD.test(c.t),
      );
      if (!names.length || !names.every(([, c]) => c.cont)) break;
      if (lastY !== Infinity && names[0][1].y - lastY > 20) break;
      parts.unshift(...names.map(([col, c]) => ({ col, t: c.t, y: c.y })));
      lastY = names[0][1].y;
    }
    if (parts.length)
      rows[i].set(parts[0].col, {
        t: cell(parts.map((p) => p.t).join(' ')),
        cont: true,
        y: parts[0].y,
      });
  }
  // Header: the contiguous run of text-only lines immediately above the first
  // data row (document-header prose has no numbers but sits further away).
  const ncol = Math.max(colStarts.length, ...rows.map((r) => r.size));
  const firstRowY = lines.find((l) => isDataLine(l))?.y ?? 0;
  const header = new Map<number, MCell>();
  for (const hl of headerLines) {
    if (hl.cells.some((c) => numericCell(c.t))) continue;
    if (Math.abs(firstRowY - hl.y) > 40) continue;
    mergeInto(header, hl);
  }
  const fill = (m: Map<number, MCell>) =>
    Array.from({ length: ncol }, (_, i) => m.get(i)?.t ?? '');
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
