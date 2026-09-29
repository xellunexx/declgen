import fs from 'node:fs/promises';
import path from 'node:path';
import { emitText as emitImportText } from './xmlio.js';
import { emitText as emitExportText } from './bg515c.js';
export function exportFilename(letter: string, tag: string, now = new Date()) {
  const safe =
      String(tag || 'draft')
        .replace(/[^0-9A-Za-zА-Яа-я_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'draft',
    yy = String(now.getFullYear()).slice(-2),
    md =
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
  return `${letter}_${yy}${md}_${safe}.xml`;
}
const esc = (s: any) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }) as any
      )[c],
  );
export function renderReviewHtml(
  decl: any,
  report: any,
  invoice: any,
  directionEx = false,
) {
  const items = directionEx
      ? decl.GoodsShipment?.GoodsItem || []
      : decl.GOODSSHIPMENT?.GOODITEM || [],
    rows = items
      .map((it: any) => {
        if (directionEx) {
          const cc = it.Commodity.CommodityCode;
          return `<tr><td>${esc(it.declarationGoodsItemNumber)}</td><td>${esc(cc.harmonizedSystemSubHeadingCode)}-${esc(cc.combinedNomenclatureCode)}</td><td>${esc(it.Commodity.descriptionOfGoods)}</td><td>${esc(it.Commodity.GoodsMeasure.netMass)}</td><td>${esc(it.statisticalValue)}</td></tr>`;
        }
        const cc = it.Commodity.CommodityCode;
        return `<tr><td>${esc(it.GoodsItemNo)}</td><td>${esc(cc.harmonizedSystemSubheadingCode)}-${esc(cc.combinedNomenclatureCode)}-${esc(cc.taricCode)}</td><td>${esc(it.Commodity.descriptionOfGoods)}</td><td>${esc(it.Commodity.GOODSMEASURE.NetMassKg)}</td><td>${esc(it.Commodity.ItemPrice)}</td><td>${esc(it.StatisticalValue)}</td></tr>`;
      })
      .join(''),
    warn =
      (report?.warnings || []).map((x: any) => `<li>${esc(x)}</li>`).join('') ||
      '<li>none</li>';
  return `<!doctype html><meta charset="utf-8"><title>declgen review</title><style>body{font-family:Consolas,monospace;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3px 8px}</style><h1>Declaration review (human gate)</h1><p><b>Invoice:</b> ${esc(invoice?.invoice_number)} | <b>Currency:</b> ${esc(invoice?.currency)} | <b>Total:</b> ${esc(invoice?.grand_total)}</p><table><tr><th>#</th><th>Code</th><th>Description</th><th>Net</th><th>Value</th></tr>${rows}</table><h2>Warnings</h2><ul>${warn}</ul>`;
}
export async function saveRun(
  decl: any,
  report: any,
  invoice: any,
  runDir: string,
  directionEx = false,
) {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'declaration.xml'),
    directionEx ? emitExportText(decl) : emitImportText(decl),
    'utf8',
  );
  await fs.writeFile(
    path.join(runDir, 'report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(runDir, 'invoice.json'),
    JSON.stringify(invoice, null, 2),
    'utf8',
  );
  const html = path.join(runDir, 'review.html');
  await fs.writeFile(
    html,
    renderReviewHtml(decl, report, invoice, directionEx),
    'utf8',
  );
  return { dir: runDir, html };
}
