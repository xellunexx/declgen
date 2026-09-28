import type { Declaration } from './model.js';

const TIN_RE = /^BG[A-Z]\d{9}ZZZZ\d$/;
const LRN_RE = /^\d{17}H\d{6}$|^\d{15}H\d{6}$/;
const INCOTERMS = new Set([
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
]);
const MODES = new Set(['1', '2', '3', '4', '5', '7', '8', '9']);
const DOC_TYPES = new Set([
  'N380',
  'N325',
  'N337',
  'N271',
  'N730',
  'N703',
  'N705',
  'N706',
  'N740',
  'N741',
  'N755',
  'N760',
  '1999',
  '1CHP',
  'Y160',
  'Y900',
  'Y901',
  'Y903',
  'Y904',
  'Y906',
  'Y935',
  'C085',
  'C710',
  'L100',
  'N851',
  'U048',
]);
const PACK_TYPES = new Set(['PC', 'CT', 'PK', 'PL', 'BG', 'BX', 'PA']);
// Conservative BG415A limits proven by the two successful Alpha fixtures supplied
// for DALMATIKA and NATVIE.  Keep these checks close to export so a draft cannot
// reach Alpha Agent with a value that it will reject on import.
const ALPHA_TEXT_LIMITS = {
  lrn: 22,
  borderNationality: 2,
  exporterName: 26,
  exporterStreet: 45,
  exporterPostcode: 6,
  inlandMode: 1,
  arrivalMeans: 8,
  locationType: 1,
  locationQualifier: 1,
  locationCity: 5,
  locationStreet: 19,
  locationPostcode: 4,
  shippingMarks: 5,
  additionalReference: 9,
} as const;

export interface Issue {
  level: 'ERROR' | 'WARN';
  where: string;
  msg: string;
  evidence?: string;
}
const fmt6 = (x: string) => /^\d+\.\d{6}$/.test(x || '');
const fmt2 = (x: string) => /^\d+\.\d{2}$/.test(x || '');
const num = (x: unknown) => Number(String(x ?? '0'));

export function check(d: Declaration, canonical?: any): Issue[] {
  const issues: Issue[] = [];
  const E = (where: string, msg: unknown, evidence = '') =>
    issues.push({ level: 'ERROR', where, msg: String(msg), evidence });
  const W = (where: string, msg: unknown, evidence = '') =>
    issues.push({ level: 'WARN', where, msg: String(msg), evidence });
  const alphaLength = (where: string, value: unknown, max: number) => {
    const length = String(value ?? '').length;
    if (length > max)
      E(
        where,
        `length ${length} exceeds Alpha fixture maximum ${max}`,
        String(value),
      );
  };
  if (d.Sender !== 'TRA.APP')
    E('envelope.Sender', JSON.stringify(d.Sender), "all examples: 'TRA.APP'");
  if (d.Recipient !== 'MISV.BG')
    E(
      'envelope.Recipient',
      JSON.stringify(d.Recipient),
      "all examples: 'MISV.BG'",
    );
  if (d.MessageType !== 'BG415A')
    E(
      'envelope.MessageType',
      JSON.stringify(d.MessageType),
      'constant in examples',
    );
  if (!TIN_RE.test(d.SenderCode || ''))
    E(
      'envelope.SenderCode',
      JSON.stringify(d.SenderCode),
      'BGA131374246ZZZZ3 pattern',
    );
  if (!TIN_RE.test(d.DECLARANT_TIN || ''))
    E('DECLARANT.TIN', JSON.stringify(d.DECLARANT_TIN), 'BGCxxxxxxxxxZZZZx');
  if (!TIN_RE.test(d.REPRESENTATIVE_TIN || ''))
    E(
      'REPRESENTATIVE.TIN',
      JSON.stringify(d.REPRESENTATIVE_TIN),
      'same pattern as SenderCode',
    );
  const dh = d.DECHEA;
  if (dh.DeclarationCode !== 'H1')
    W('DECHEA.DeclarationCode', dh.DeclarationCode, 'examples are all H1');
  if (!['IM', 'EX'].includes(dh.DeclarationType))
    E('DECHEA.DeclarationType', dh.DeclarationType, 'IM/EX');
  if (!dh.Lrn) E('DECHEA.Lrn', '', 'required');
  else if (!LRN_RE.test(dh.Lrn))
    W('DECHEA.Lrn', dh.Lrn, 'observed LRN pattern');
  alphaLength('DECHEA.Lrn', dh.Lrn, ALPHA_TEXT_LIMITS.lrn);
  if (!/^[A-Z]{3}$/.test(dh.InvoiceCurrency || ''))
    E('DECHEA.InvoiceCurrency', dh.InvoiceCurrency, 'ISO-4217');
  const items = d.GOODSSHIPMENT.GOODITEM;
  if (!items.length) E('GOODSSHIPMENT', 'no GOODITEM at all');
  for (const it of items) {
    const w = `item[${it.GoodsItemNo}]`,
      cc = it.Commodity.CommodityCode,
      gm = it.Commodity.GOODSMEASURE;
    if (!/^\d{6}$/.test(cc.harmonizedSystemSubheadingCode || ''))
      E(`${w}.hs6`, cc.harmonizedSystemSubheadingCode, '6 digits');
    if (!/^\d{2}$/.test(cc.combinedNomenclatureCode || ''))
      E(`${w}.cn`, cc.combinedNomenclatureCode, '2 digits');
    if (!/^\d{2}$/.test(cc.taricCode || ''))
      E(`${w}.taric`, cc.taricCode, '2 digits');
    const desc = it.Commodity.descriptionOfGoods || '';
    if (!desc.trim()) E(`${w}.desc`, 'empty');
    if (desc.includes('[NEW GOOD'))
      E(`${w}.desc`, 'unconfirmed new good must not ship', 'human gate');
    const maxDescription = Number(
      canonical?.canonical_h1?.max_description_length || 512,
    );
    if (desc.length > maxDescription)
      E(
        `${w}.desc`,
        `${desc.length} chars exceeds canonical maximum ${maxDescription}`,
      );
    // Evidence-only CAS guard: values are harvested from accepted AlphaAgent
    // filings for this client.  Ambiguous historical CAS values are deliberately
    // absent; they require a human classification decision instead.
    const hs = `${cc.harmonizedSystemSubheadingCode || ''}${cc.combinedNomenclatureCode || ''}${cc.taricCode || ''}`;
    const observedCas =
      canonical?.canonical_h1?.alpha_history?.cas_hs_unambiguous || {};
    for (const cas of desc.match(/\b\d{2,7}-\d{2}-\d\b/g) || []) {
      const observed = String(observedCas[cas] || '');
      if (observed && observed !== hs)
        E(
          `${w}.CAS`,
          `${cas} historically maps to ${observed}, not ${hs}`,
          'Evelin AlphaAgent history; verify classification',
        );
    }
    if (
      num(gm.NetMassKg) > 0 &&
      (desc.toLowerCase().includes('- 0 кг') ||
        desc.toLowerCase().includes('- 0 kg') ||
        desc.trim().endsWith('- 0'))
    )
      E(`${w}.desc`, 'description states 0 kg but net mass > 0');
    for (const [tag, val] of [
      ['NetMassKg', gm.NetMassKg],
      ['GrossMassKg', gm.GrossMassKg],
    ] as const)
      if (!fmt6(val)) E(`${w}.${tag}`, val, '6-decimal');
    const net = num(gm.NetMassKg),
      gross = num(gm.GrossMassKg);
    if (net <= 0) E(`${w}.net`, net, 'must be > 0');
    if (gross < net) E(`${w}.gross<net`, `${gross} < ${net}`);
    if (gm.SupplementaryUnits != null && !fmt6(gm.SupplementaryUnits))
      E(`${w}.SupplUnits`, gm.SupplementaryUnits, '6-decimal');
    if (!fmt2(it.Commodity.ItemPrice))
      E(`${w}.ItemPrice`, it.Commodity.ItemPrice, '2-decimal');
    if (!fmt2(it.StatisticalValue))
      E(`${w}.StatisticalValue`, it.StatisticalValue, '2-decimal EUR');
    if (!/^[A-Z]{2}$/.test(it.ORIGIN.CountryOfOrigin || ''))
      E(`${w}.origin`, it.ORIGIN.CountryOfOrigin, 'ISO-3166 alpha-2');
    const p = it.Procedure;
    if (
      !(
        (p.requestedProcedure === '40' || p.requestedProcedure === '10') &&
        p.previousProcedure === '00'
      )
    )
      W(`${w}.procedure`, `${p.requestedProcedure}/${p.previousProcedure}`);
    if (!/^\d{4}$/.test(it.ValuationIndicator || ''))
      E(`${w}.ValuationIndicator`, it.ValuationIndicator, "'0000'/'0010'");
    if (!PACK_TYPES.has(it.PACKAGING.TypeOfPackages))
      W(`${w}.pkgType`, it.PACKAGING.TypeOfPackages);
    alphaLength(
      `${w}.PACKAGING.ShippingMarks`,
      it.PACKAGING.ShippingMarks,
      ALPHA_TEXT_LIMITS.shippingMarks,
    );
    for (const ref of it.AdditionalReference || [])
      alphaLength(
        `${w}.AdditionalReference.referenceNumber`,
        ref.referenceNumber,
        ALPHA_TEXT_LIMITS.additionalReference,
      );
    const known = new Set(
      [
        ...it.SupportingDocument,
        ...it.TransportDocument,
        ...it.AdditionalReference,
      ].map((r) => r.type),
    );
    const unknown = [...known].filter((x) => !DOC_TYPES.has(x));
    if (unknown.length) W(`${w}.docTypes`, `unknown ${unknown.join(', ')}`);
    if (!it.SupportingDocument.length) W(`${w}.SD`, 'no supporting documents');
    const requiredDocs =
      canonical?.canonical_h1?.item_supporting_documents || [];
    for (const required of requiredDocs)
      if (
        !it.SupportingDocument.some(
          (r) =>
            r.type === required.type &&
            r.referenceNumber === required.referenceNumber,
        )
      )
        E(
          `${w}.SupportingDocument`,
          `${required.type}:${required.referenceNumber} missing from canonical Evelin item profile`,
        );
  }
  if (items.length) {
    const sumPrice = items.reduce((a, i) => a + num(i.Commodity.ItemPrice), 0);
    if (Math.abs(sumPrice - num(dh.TotalAmountInvoiced)) > 0.004)
      E(
        'totals',
        `sum ItemPrice ${sumPrice.toFixed(2)} != TotalAmountInvoiced ${dh.TotalAmountInvoiced}`,
      );
    const sn = items.reduce(
      (a, i) => a + num(i.Commodity.GOODSMEASURE.NetMassKg),
      0,
    );
    const sg = items.reduce(
      (a, i) => a + num(i.Commodity.GOODSMEASURE.GrossMassKg),
      0,
    );
    if (sg > num(dh.TotalGrossMassKg) + 0.0000005)
      E('totals.gross', `sum item gross ${sg} > header ${dh.TotalGrossMassKg}`);
    else if (sg < num(dh.TotalGrossMassKg) - 0.0000005)
      W('totals.gross', `sum item gross ${sg} < header ${dh.TotalGrossMassKg}`);
    if (sn > sg + 0.0000005) E('totals.net>gross', `${sn} > ${sg}`);
    const pk = items.reduce(
      (a, i) => a + Number.parseInt(i.PACKAGING.NumberOfPackages || '0', 10),
      0,
    );
    if (String(pk) !== String(dh.TotalPackages))
      W(
        'totals.packages',
        `sum item packages ${pk} != header ${dh.TotalPackages}`,
      );
    if (Number.parseInt(dh.TotalNumberOfItems || '0', 10) !== items.length)
      E(
        'totals.count',
        `header ${dh.TotalNumberOfItems} != actual ${items.length}`,
      );
  }
  const sh = d.GOODSSHIPMENT;
  const anyD: any = d,
    exporter: any = anyD.EXPORTER || {},
    exporterAddress: any = exporter.ADDRESS || {},
    consignment: any = sh.CONSIGNMENT || {},
    location: any = consignment.LocationOfGoods || {},
    locationAddress: any = location.ADDRESS || {};
  alphaLength(
    'BORTRANSMEANS.NatOfMeansOfTransCrosBorder',
    d.NatOfMeansOfTransCrosBorder,
    ALPHA_TEXT_LIMITS.borderNationality,
  );
  alphaLength(
    'EXPORTER.Name',
    exporter.Name,
    Number(
      canonical?.canonical_h1?.field_max?.exporter_name ||
        ALPHA_TEXT_LIMITS.exporterName,
    ),
  );
  alphaLength(
    'EXPORTER.ADDRESS.StreetAndNumber',
    exporterAddress.StreetAndNumber,
    Number(
      canonical?.canonical_h1?.field_max?.exporter_street ||
        ALPHA_TEXT_LIMITS.exporterStreet,
    ),
  );
  alphaLength(
    'EXPORTER.ADDRESS.Postcode',
    exporterAddress.Postcode,
    ALPHA_TEXT_LIMITS.exporterPostcode,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.InlandModeOfTransport',
    consignment.InlandModeOfTransport,
    ALPHA_TEXT_LIMITS.inlandMode,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.ARRIVALTRANSPORTMEANS.IdeOfMeaOfTraAtArrival',
    consignment.ARRIVALTRANSPORTMEANS?.IdeOfMeaOfTraAtArrival,
    ALPHA_TEXT_LIMITS.arrivalMeans,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.LocationOfGoods.typeOfLocation',
    location.typeOfLocation,
    ALPHA_TEXT_LIMITS.locationType,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.LocationOfGoods.qualifierOfIdentification',
    location.qualifierOfIdentification,
    ALPHA_TEXT_LIMITS.locationQualifier,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.LocationOfGoods.ADDRESS.City',
    locationAddress.City,
    ALPHA_TEXT_LIMITS.locationCity,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.LocationOfGoods.ADDRESS.StreetAndNumber',
    locationAddress.StreetAndNumber,
    ALPHA_TEXT_LIMITS.locationStreet,
  );
  alphaLength(
    'GOODSSHIPMENT.CONSIGNMENT.LocationOfGoods.ADDRESS.Postcode',
    locationAddress.Postcode,
    ALPHA_TEXT_LIMITS.locationPostcode,
  );
  if (sh.DeliveryTerms && !INCOTERMS.has(sh.DeliveryTerms.incotermCode))
    W('DeliveryTerms', sh.DeliveryTerms.incotermCode);
  if (!MODES.has(d.ModeOfTransAtBorder))
    W('ModeOfTransAtBorder', d.ModeOfTransAtBorder);
  if (!sh.CONSIGNMENT.LocationOfGoods) W('LocationOfGoods', 'missing');
  if (dh.DeclarationType === 'IM' && !TIN_RE.test(sh.IMPORTER_TIN || ''))
    E('IMPORTER.TIN', sh.IMPORTER_TIN, 'required for IM');
  const previousType = String(
    canonical?.canonical_h1?.required_previous_document_type || '',
  );
  if (
    previousType &&
    !sh.PreviousDocument.some(
      (r) => r.type === previousType && String(r.referenceNumber || '').trim(),
    )
  )
    E(
      'GOODSSHIPMENT.PreviousDocument',
      `${previousType} reference required by canonical Evelin profile`,
    );
  return issues;
}
export const summarize = (issues: Issue[]) => ({
  errors: issues.filter((i) => i.level === 'ERROR'),
  warnings: issues.filter((i) => i.level === 'WARN'),
});
