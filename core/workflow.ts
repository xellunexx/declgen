import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import archiver from 'archiver';
import fsSync from 'node:fs';
import { isChargeLine } from './transform.js';
const dec = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: any) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
export async function sha256(file: string) {
  const h = createHash('sha256');
  const b = await fs.readFile(file);
  h.update(b);
  return h.digest('hex');
}
export async function dossierManifest(files: string[], entries: any = {}) {
  const out: any[] = [];
  for (const f of files) {
    let st: any = null;
    try {
      st = await fs.stat(f);
    } catch {}
    const e = entries?.[path.basename(f)] || {};
    out.push({
      name: path.basename(f),
      suffix: path.extname(f).toLowerCase(),
      size: st?.size ?? null,
      sha256: st?.isFile() ? await sha256(f) : null,
      type: e.type,
      confidence: e.confidence,
      invoice_number: e.invoice?.invoice_number,
      waybill_number: e.waybill?.waybill_number,
    });
  }
  return out;
}
export function analyzeDossier(
  entries: any,
  invoice: any = null,
  packing: any = null,
  waybill: any = null,
) {
  const docs = Object.entries(entries || {})
    .filter(([n]) => !String(n).startsWith('__'))
    .map(([name, e]: any) => ({
      name,
      type: e.type || 'unknown',
      confidence: e.confidence || '',
      needs_ocr: !!e.needs_ocr,
      has_invoice: !!e.invoice,
      has_packing: !!e.packing,
      has_waybill: !!e.waybill,
    }));
  const blockers: string[] = [],
    warnings: string[] = [];
  if (!invoice) blockers.push('Няма фактура/проформа в досието.');
  const invoices = Object.values(entries || {})
    .filter((e: any) => e?.invoice)
    .map((e: any) => e.invoice);
  if (invoices.length > 1)
    warnings.push(
      `Досието съдържа ${invoices.length} финансови документа — избран е само един като основна фактура.`,
    );
  if (docs.some((d) => d.needs_ocr))
    blockers.push(
      'Има сканиран документ без текстов слой — нужен е OCR/vision преглед.',
    );
  if (packing?.warnings) warnings.push(...packing.warnings.map(String));
  if (waybill) {
    if (
      invoice &&
      waybill.waybill_number &&
      invoice.waybill_number &&
      String(waybill.waybill_number) !== String(invoice.waybill_number)
    )
      blockers.push('Номерът на товарителницата не съвпада с фактурата.');
    if (
      invoice &&
      waybill.gross_kg != null &&
      invoice.total_gross_weight_kg != null &&
      Math.abs(dec(waybill.gross_kg) - dec(invoice.total_gross_weight_kg)) >
        0.05
    )
      warnings.push(
        `Бруто от товарителница (${waybill.gross_kg} кг) ≠ фактура (${invoice.total_gross_weight_kg} кг).`,
      );
  }
  if (invoice) {
    if (!invoice.grand_total)
      warnings.push('Фактурата няма извлечена крайна сума.');
    if (!invoice.currency) blockers.push('Липсва валута на фактурата.');
    if (!invoice.invoice_number) warnings.push('Липсва номер на фактурата.');
    warnings.push(...(invoice._warnings || []).map(String));
  }
  return {
    documents: docs,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ok: blockers.length === 0,
  };
}
export function reconcileInvoiceDeclaration(invoice: any, decl: any) {
  if (!invoice || !decl)
    return {
      rows: [],
      errors: ['Липсва фактура или декларация.'],
      warnings: [],
      ok: false,
    };
  const dh = decl.DECHEA,
    items = decl.GOODSSHIPMENT.GOODITEM || [],
    rows: any[] = [],
    errors: string[] = [],
    warnings: string[] = [];
  const rnd = (x: number, dp: number) => {
    const m = Math.pow(10, dp);
    return Math.round((x + Number.EPSILON) * m) / m;
  };
  const money = (x: any) => rnd(dec(x), 2).toFixed(2);
  const kg = (x: any) => String(rnd(dec(x), 3));
  const chargeLines = (invoice.lines || []).filter(isChargeLine),
    chargeTotal = chargeLines.reduce(
      (a: number, l: any) =>
        a +
        dec(
          l.subtotal ??
            l.total_amount ??
            dec(l.qty ?? l.quantity) * dec(l.unit_price),
        ),
      0,
    ),
    // Service-charge rows (or an explicit shipping_cost field) are folded into
    // the item prices by gross-weight share — TotalAmountInvoiced stays the
    // full grand_total, matching the canonical presentation.
    embeddedCharge = chargeTotal || dec(invoice.shipping_cost),
    goodsExpected = dec(invoice.grand_total) - embeddedCharge;
  if (invoice.grand_total != null && invoice.grand_total !== '') {
    const diff = rnd(dec(dh.TotalAmountInvoiced) - dec(invoice.grand_total), 2);
    rows.push([
      'Крайна сума',
      money(invoice.grand_total),
      money(dh.TotalAmountInvoiced),
      diff.toFixed(2),
      Math.abs(diff) <= 0.01,
    ]);
    if (Math.abs(diff) > 0.01)
      errors.push(
        `Крайна сума: разлика ${diff.toFixed(2)} ${dh.InvoiceCurrency}.`,
      );
    if (embeddedCharge > 0) {
      const folded = rnd(dec(dh.TotalAmountInvoiced) - goodsExpected, 2),
        fDiff = rnd(folded - embeddedCharge, 2);
      rows.push([
        'Транспорт/такси (в цените)',
        money(embeddedCharge),
        money(folded),
        fDiff.toFixed(2),
        Math.abs(fDiff) <= 0.02,
      ]);
      if (Math.abs(fDiff) > 0.02)
        warnings.push(
          `Транспорт/такси: разлика ${fDiff.toFixed(2)} при разпределение в цените.`,
        );
    }
  }
  const net = items.reduce(
      (a: number, i: any) => a + dec(i.Commodity.GOODSMEASURE.NetMassKg),
      0,
    ),
    gross = items.reduce(
      (a: number, i: any) => a + dec(i.Commodity.GOODSMEASURE.GrossMassKg),
      0,
    );
  if (invoice.total_net_weight_kg != null) {
    const d = rnd(net - dec(invoice.total_net_weight_kg), 3);
    rows.push([
      'Нето кг',
      kg(invoice.total_net_weight_kg),
      kg(net),
      kg(d),
      d === 0,
    ]);
    if (Math.abs(d) > 0.02) warnings.push(`Нето: разлика ${kg(d)} кг.`);
  }
  if (invoice.total_gross_weight_kg != null) {
    const d = rnd(gross - dec(invoice.total_gross_weight_kg), 3);
    rows.push([
      'Бруто кг',
      kg(invoice.total_gross_weight_kg),
      kg(gross),
      kg(d),
      d === 0,
    ]);
    if (Math.abs(d) > 0.02) warnings.push(`Бруто: разлика ${kg(d)} кг.`);
  }
  if (invoice.pieces != null) {
    const d = dec(dh.TotalPackages) - dec(invoice.pieces);
    rows.push([
      'Колети',
      String(invoice.pieces),
      String(dh.TotalPackages),
      String(d),
      String(invoice.pieces) === String(dh.TotalPackages),
    ]);
    if (String(invoice.pieces) !== String(dh.TotalPackages))
      warnings.push('Броят колети се различава.');
  }
  const goodsLineCount = (invoice.lines || []).length - chargeLines.length;
  rows.push([
    'Позиции',
    String(goodsLineCount),
    String(items.length),
    String(items.length - goodsLineCount),
    // Grouping legitimately collapses invoice rows into fewer declaration
    // items — only more items than goods lines is suspicious.
    items.length <= goodsLineCount,
  ]);
  if (items.length > goodsLineCount)
    warnings.push(
      'Декларацията съдържа повече позиции от фактурата (групиране/допълване — проверете).',
    );
  return { rows, errors, warnings, ok: !errors.length };
}
export function declarationChanges(invoice: any, decl: any, report: any = {}) {
  if (!invoice || !decl) return [];
  const out: any[] = [];
  for (const it of decl.GOODSSHIPMENT.GOODITEM || []) {
    const cc = it.Commodity.CommodityCode,
      code = `${cc.harmonizedSystemSubheadingCode}${cc.combinedNomenclatureCode}${cc.taricCode}`;
    let source = 'invoice code fallback',
      inv_codes: any[] = [];
    for (const g of report.grouping || [])
      if (Number(g.item) === Number(it.GoodsItemNo)) {
        const src = g.source || 'invoice_code_fallback';
        source =
          (
            {
              client_dossier_override: 'client dossier override',
              client_dossier_xlsx: 'client XLSX',
              client_history: 'client filed history',
              learned: 'learned catalog',
              client_dossier_completion: 'dossier completion — verify',
              invoice_code_fallback: 'invoice HS — fallback, verify',
            } as any
          )[src] || src;
        inv_codes = g.invoice_codes || [];
        break;
      }
    if (String(it.Commodity.descriptionOfGoods).includes('[NEW GOOD'))
      source = 'HUMAN CONFIRMATION REQUIRED';
    out.push({
      item: it.GoodsItemNo,
      code,
      invoice_codes: inv_codes,
      description: it.Commodity.descriptionOfGoods,
      source,
      price: it.Commodity.ItemPrice,
      net: it.Commodity.GOODSMEASURE.NetMassKg,
      stat: it.StatisticalValue,
    });
  }
  return out;
}
export async function duplicateCandidates(invoice: any, runsDir: string) {
  if (!invoice?.invoice_number) return [];
  const target = [
      norm(invoice.invoice_number),
      norm(invoice.currency),
      Number(invoice.grand_total || 0).toFixed(2),
    ].join('|'),
    hits: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(runsDir);
  } catch {
    return hits;
  }
  for (const d of dirs) {
    const p = path.join(runsDir, d, 'invoice.json');
    try {
      const old = JSON.parse(await fs.readFile(p, 'utf8')),
        key = [
          norm(old.invoice_number),
          norm(old.currency),
          Number(old.grand_total || 0).toFixed(2),
        ].join('|');
      if (key === target) hits.push(path.dirname(p));
    } catch {}
  }
  return hits;
}
export async function saveAudit(runDir: string, args: any) {
  await fs.mkdir(runDir, { recursive: true });
  const audit = {
    schema: 2,
    created_at: new Date().toISOString(),
    case_state: args.case_state || null,
    client_id: args.client_id,
    direction: args.direction,
    invoice_number: args.invoice?.invoice_number,
    approved: !!args.approved,
    dossier: await dossierManifest(
      args.dossier_files || [],
      args.dossier_entries,
    ),
    report_summary: {
      warnings: (args.report?.warnings || []).length,
      new_goods: (args.report?.new_goods || []).length,
      matched: (args.report?.matched || []).length,
    },
    conformance: (args.conformance || []).map((i: any) => ({
      level: i.level || '',
      where: i.where || '',
      msg: i.msg || '',
      evidence: i.evidence || '',
    })),
  };
  await fs.writeFile(
    path.join(runDir, 'audit.json'),
    JSON.stringify(audit, null, 2),
    'utf8',
  );
  return audit;
}
export function buildCaseTrace(args: any) {
  const invoice = args.invoice || {},
    report = args.report || {},
    lines = new Map((invoice.lines || []).map((x: any) => [String(x.no), x])),
    suggestions = new Map(
      (report.auto_classified || []).map((x: any) => [
        String(x.group || ''),
        x,
      ]),
    ),
    groups: any[] = [],
    next_actions: any[] = [];
  for (const g of report.grouping || []) {
    const key = String(g.group || ''),
      source = String(g.source || ''),
      code = String(g.declaration_hs || '');
    let state = String(g.classification_state || '');
    if (!state)
      state = [
        'invoice_code_fallback',
        'client_dossier_completion',
        'placeholder_user_input',
      ].includes(source)
        ? 'review_required'
        : code.length >= 6
          ? 'confirmed'
          : 'unresolved';
    const nos = (g.line_nos || []).map(String),
      ai: any = suggestions.get(key) || {};
    groups.push({
      item: g.item,
      group: key,
      invoice_lines: nos,
      input_descriptions: nos.map(
        (n: string) => (lines.get(n) as any)?.description || '',
      ),
      input_hs: g.invoice_codes || [],
      input_origins:
        g.member_origins ||
        nos.map((n: string) => (lines.get(n) as any)?.origin || ''),
      catalog_key: g.catalog_key || null,
      classification_source: source || null,
      classification_state: state,
      declaration_hs: code || null,
      declaration_origin: g.declaration_origin || null,
      ai_suggestion_not_applied: Object.keys(ai).length
        ? { source: ai.source, hs6: ai.hs, evidence: ai.evidence }
        : null,
      net_kg: g.net_kg,
      value: g.price,
    });
    if (state !== 'confirmed')
      next_actions.push({
        action: 'classification_review',
        group: key,
        reason: `state=${state}; source=${source || 'none'}`,
      });
  }
  const issues = (args.conformance || []).map((i: any) => ({
    level: i.level || '',
    where: i.where || '',
    message: i.msg || '',
    evidence: i.evidence || '',
  }));
  for (const i of issues)
    if (i.level === 'ERROR')
      next_actions.push({
        action: 'fix_conformance',
        field: i.where,
        reason: i.message || i.evidence,
      });
  return {
    schema: 'declgen.case-trace/v2',
    created_at: new Date().toISOString(),
    case: {
      client_id: args.client_id,
      direction: args.direction,
      invoice_number: invoice.invoice_number,
      currency: invoice.currency,
      invoice_total: invoice.grand_total,
      revision: args.case_state?.case_revision,
      built_from_revision: args.case_state?.built_from_revision,
      validated_revision: args.case_state?.validated_revision,
    },
    documents: {
      entries: args.dossier_entries || {},
      packing: args.packing || {},
      waybill: args.waybill || {},
    },
    input_invoice_lines: (invoice.lines || []).map((l: any) => ({
      no: l.no,
      description: l.description,
      hs: l.hs_code,
      origin: l.origin,
      qty: l.qty ?? l.quantity,
      unit: l.qty_unit ?? l.unit,
      subtotal: l.subtotal ?? l.total_amount,
    })),
    declaration_context: report.declaration_context || {},
    classification: groups,
    warnings: [...(report.warnings || [])],
    conformance: issues,
    next_actions,
  };
}
export async function saveCaseTrace(runDir: string, trace: any) {
  await fs.mkdir(runDir, { recursive: true });
  const p = path.join(runDir, 'trace.json');
  await fs.writeFile(p, JSON.stringify(trace, null, 2), 'utf8');
  return p;
}
export async function exportCasePackage(
  runDir: string,
  outputZip = runDir + '.case.zip',
) {
  await fs.mkdir(path.dirname(outputZip), { recursive: true });
  return new Promise<string>((resolve, reject) => {
    const output = fsSync.createWriteStream(outputZip),
      zip = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(outputZip));
    zip.on('error', reject);
    zip.pipe(output);
    zip.directory(runDir, path.basename(runDir));
    void zip.finalize();
  });
}
