import fs from 'node:fs/promises';
import path from 'node:path';
async function loadPdf(filePath: string) {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return await pdf.getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
  }).promise;
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
    for (const it of c.items as any[]) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform?.[5] ?? 0);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (line.length) lines.push(line.join(' '));
        line = [];
      }
      line.push(String(it.str));
      lastY = y;
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
    const rows = new Map<number, Array<{ x: number; t: string }>>();
    for (const it of c.items as any[]) {
      if (!('str' in it) || !String(it.str).trim()) continue;
      const y = Math.round((it.transform?.[5] ?? 0) / 3) * 3;
      const arr = rows.get(y) ?? [];
      arr.push({ x: it.transform?.[4] ?? 0, t: cell(String(it.str)) });
      rows.set(y, arr);
    }
    const matrix = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, a]) => a.sort((x, y) => x.x - y.x).map((x) => x.t))
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
