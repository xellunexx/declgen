/** Reconstructed from the canonical BG415A model, conformance rubric, UI build inputs,
 *  report contracts and DECLGEN_STATE_FLOW_PROMPT. The original transform.py was absent
 *  from the supplied archive, so this module is intentionally isolated and regression-tested. */
import type { Declaration, GoodItem, TypedRef } from './model.js';
import { newDeclaration, newGoodItem, party, address } from './model.js';
import { Catalog, norm } from './catalog.js';
import { resolve as resolveContext } from './declaration-context.js';
import { refInvoice, refProforma } from './box44.js';
import { ALPHA_TEXT_LIMITS } from './conformance.js';
const num = (v: any, d = 0) => {
  const s = String(v ?? '')
    .trim()
    .replace(',', '.');
  if (s === '') return d;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};
const f2 = (n: number) => Math.max(0, n).toFixed(2);
const f6 = (n: number) => Math.max(0, n).toFixed(6);
// Charge rows ('Shipping Cost', 'Freight', 'Transport') are services, not
// goods — they must not become GOODSITEMs. Their value belongs to the AK
// (transport) valuation addition instead of inflating a fake 999999 item.
const CHARGE_WORDS =
    /^(shipping|freight|transport|transportation|courier|delivery|handling|packing|packaging|insurance|customs|доставка|транспорт|застраховка|навло|превоз)s?$/i,
  CHARGE_TAIL =
    /^(cost|costs|charge|charges|fee|price|service|expenses|разходи|услуга)s?$/i;
export function isChargeLine(l: any) {
  const w = clean(l?.description)
    .split(' ')
    .filter(Boolean);
  return (
    w.length >= 1 &&
    w.length <= 4 &&
    w.every((x) => CHARGE_WORDS.test(x) || CHARGE_TAIL.test(x)) &&
    w.some((x) => CHARGE_WORDS.test(x))
  );
}
// A doubled line is the product name printed in both invoice columns
// ('Dandelion Root Extract Extract Dandelion Root Extract' = name + wrapped
// desc cell). The name reappears as the trailing words — find the longest
// word-run shared by the head and tail and keep it once.
export function edgeCollapse(t: string) {
  const w = String(t || '').split(' ');
  for (let k = Math.floor(w.length / 2); k >= 1; k--) {
    const a = w.slice(0, k).join(' ');
    if (a === w.slice(-k).join(' ')) return a;
  }
  return t;
}

const clean = (s: any) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  // Supplier invoices often print the same text in the name and description
  // cells, producing 'White Birch Extract White Birch Extract'. Collapse an
  // exact doubled phrase — it doubles description length without adding data.
  const w = t.split(' ');
  if (w.length >= 2 && w.length % 2 === 0) {
    const h = w.length / 2,
      a = w.slice(0, h).join(' '),
      b = w.slice(h).join(' ');
    if (a === b) return a;
  }
  return t;
};
const iso = (s: any, fallback = 'CN') =>
  /^[A-Z]{2}$/.test(String(s ?? '').toUpperCase())
    ? String(s).toUpperCase()
    : fallback;
const code10 = (v: any) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 6) return d + '0000';
  if (d.length === 8) return d + '00';
  if (d.length >= 10) return d.slice(0, 10);
  return null;
};
function mergeObj(a: any, b: any) {
  const out = structuredClone(a || {});
  for (const [k, v] of Object.entries(b || {})) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    )
      out[k] = mergeObj(out[k], v);
    else out[k] = structuredClone(v);
  }
  return out;
}
function partyFromInvoice(p: any, canonicalName = '', fieldMax: any = {}) {
  return party({
    Name: String(canonicalName || p?.company || p?.name || '').slice(
      0,
      Number(fieldMax.exporter_name) || ALPHA_TEXT_LIMITS.exporterName,
    ),
    ADDRESS: address({
      City: String(p?.city || ''),
      Country: iso(p?.country, ''),
      StreetAndNumber: String(p?.address || p?.street || '').slice(
        0,
        Number(fieldMax.exporter_street) || ALPHA_TEXT_LIMITS.exporterStreet,
      ),
      Postcode: String(p?.postcode || p?.zip || '').slice(
        0,
        ALPHA_TEXT_LIMITS.exporterPostcode,
      ),
    }),
  });
}
function dynamicDescription(entry: any, lines: any[], netKg: number) {
  const template = String(entry?.declaration_description_template || '').trim();
  if (!template) return String(entry?.declaration_description || '').trim();
  const allKg =
    lines.length > 0 &&
    lines.every((l: any) =>
      /^(kg|kgs)$/i.test(String(l.qty_unit ?? l.unit ?? '')),
    );
  const sourceNet = allKg
    ? lines.reduce((sum: number, l: any) => sum + num(l.qty ?? l.quantity), 0)
    : netKg;
  const net = String(Number(sourceNet.toFixed(3))).replace('.', ',');
  // A doubled line is the product name printed in both invoice columns
  // ('Dandelion Root Extract Extract Dandelion Root Extract' = name + wrapped
  // desc cell). The name reappears as the trailing words — find the longest
  // word-run shared by the head and tail and keep it once. Then prefer the
  // catalog alias spelling when it is the same name, so canonical phrasing
  // survives; variants without an exact alias ('... subsp. infantis') keep
  // their own text.
  const aliases = (entry.aliases || [])
      .map((a: any) => String(a || '').trim())
      .filter(Boolean),
    canonicalFor = (t: string) =>
      aliases.find((a: string) => norm(a) === norm(t)) || t;
  const components = [
    ...new Set(
      lines
        .map((l: any) => canonicalFor(edgeCollapse(clean(l.description))))
        .filter(Boolean),
    ),
  ].join(', ');
  return template
    .replaceAll('{net_kg}', net)
    .replaceAll('{components}', components);
}
function itemMasses(lines: any[], extras: any, invoice: any) {
  const totalNet = num(extras.total_net_kg ?? invoice.total_net_weight_kg),
    totalGross = num(extras.total_gross_kg ?? invoice.total_gross_weight_kg);
  const vals = lines.map((l) =>
      Math.max(
        0.000001,
        num(
          l.subtotal ??
            l.total_amount ??
            num(l.quantity ?? l.qty) * num(l.unit_price),
        ),
      ),
    ),
    sumVal = vals.reduce((a, b) => a + b, 0) || lines.length || 1;
  let nets = lines.map((l, i) => {
    const key = String(l.no ?? i + 1),
      explicit =
        extras.line_masses?.[key] ??
        extras.line_masses?.[l.catalog_key] ??
        extras.net_masses?.[key] ??
        extras.net_masses?.[l.catalog_key];
    if (explicit != null) return num(explicit);
    const u = String(l.qty_unit ?? l.unit ?? '').toLowerCase();
    if (u === 'kg' || u === 'kgs') return num(l.qty ?? l.quantity);
    return totalNet > 0
      ? totalNet * (vals[i] / sumVal)
      : Math.max(0.001, num(l.qty ?? l.quantity) * 0.1);
  });
  if (totalNet > 0) {
    const sn = nets.reduce((a, b) => a + b, 0);
    if (sn > 0) nets = nets.map((x) => (x * totalNet) / sn);
  }
  if (totalGross > 0) {
    const sn = nets.reduce((a, b) => a + b, 0);
    if (sn > totalGross && sn > 0)
      nets = nets.map((x) => (x * totalGross) / sn);
  }
  let gross = lines.map((l, i) => {
    const key = String(l.no ?? i + 1),
      explicit =
        extras.gross_masses?.[key] ?? extras.gross_masses?.[l.catalog_key];
    return explicit != null ? Math.max(nets[i], num(explicit)) : nets[i];
  });
  if (totalGross > 0) {
    const sn = nets.reduce((a, b) => a + b, 0),
      over = Math.max(0, totalGross - sn);
    gross = nets.map((n, i) => n + over * (vals[i] / sumVal));
  } else gross = nets.map((n) => n * 1.05);
  return {
    nets,
    gross,
    totalGross: totalGross > 0 ? totalGross : gross.reduce((a, b) => a + b, 0),
  };
}
function docsForItem(
  invoice: any,
  extras: any,
  template: any,
): { support: TypedRef[]; transport: TypedRef[]; additional: TypedRef[] } {
  const support: TypedRef[] = [],
    transport: TypedRef[] = [],
    additional: TypedRef[] = [];
  try {
    support.push(
      invoice.is_proforma
        ? refProforma(invoice.invoice_number, invoice.invoice_date)
        : refInvoice(invoice.invoice_number, invoice.invoice_date),
    );
  } catch {}
  for (const d of template?.canonical_h1?.item_supporting_documents || [])
    if (d?.type && d?.referenceNumber)
      support.push({
        type: String(d.type),
        referenceNumber: String(d.referenceNumber),
      });
  for (const d of extras.dossier_docs || []) {
    try {
      support.push(refInvoice(d.number, d.date));
    } catch {}
  }
  for (const d of extras.supporting_documents || [])
    if (d?.type && d?.referenceNumber)
      support.push({
        type: String(d.type),
        referenceNumber: String(d.referenceNumber),
      });
  for (const d of extras.transport_documents || [])
    if (d?.type && d?.referenceNumber)
      transport.push({
        type: String(d.type),
        referenceNumber: String(d.referenceNumber),
      });
  return { support, transport, additional };
}
export async function buildDeclaration(
  invoice: any,
  template: any,
  catalog: Catalog,
  extras: any = {},
): Promise<[Declaration, any]> {
  const [profile, caseCtx, boundary] = resolveContext(template, extras, 'IM');
  const ctx = mergeObj(profile, caseCtx),
    defaults = template?.defaults || {};
  const raw = (invoice?.lines || []).map((l: any, i: number) => ({
    ...l,
    no: l.no ?? i + 1,
    subtotal: num(
      l.subtotal ??
        l.total_amount ??
        num(l.qty ?? l.quantity) * num(l.unit_price),
    ),
  }));
  if (!raw.length) throw new Error('invoice has no lines');
  const chargeLines = raw.filter(isChargeLine),
    goods = raw.filter((l: any) => !isChargeLine(l)),
    chargeTotal = chargeLines.reduce(
      (a: number, l: any) => a + l.subtotal,
      0,
    );
  if (!goods.length)
    throw new Error('invoice has only charge rows, no goods lines');
  const matches: any[] = [],
    new_goods: any[] = [],
    warnings: string[] = [],
    groupsMap = new Map<string, any>();
  if (chargeLines.length)
    warnings.push(
      `ред(ове) ${JSON.stringify(chargeLines.map((l: any) => l.no))} са служебни разходи (${chargeLines.map((l: any) => clean(l.description)).join('; ')}) — не са стокови позиции; ${f2(chargeTotal)} отива към транспортната добавка (АК), не в цените`,
    );
  for (const line of goods) {
    const [entry, score] = catalog.match(clean(line.description), line.hs_code);
    const invCode = code10(line.hs_code);
    let source = 'invoice_code_fallback',
      effective: any = null;
    if (entry) {
      effective = entry;
      source = entry.source || 'learned';
      matches.push({
        line_no: line.no,
        group: entry.map_group || entry.key,
        key: entry.key,
        score,
        source,
      });
    } else if (invCode) {
      effective = {
        key: `invoice:${line.no}`,
        bg_name: clean(line.description),
        bg_phrase: '',
        hs: {
          hs6: invCode.slice(0, 6),
          cn: invCode.slice(6, 8),
          taric: invCode.slice(8, 10),
        },
        origin: iso(line.origin || invoice?.seller?.country),
        source: 'invoice_code_fallback',
      };
      warnings.push(
        `ред ${line.no}: HS от фактурата е fallback и изисква човешко потвърждение`,
      );
    } else {
      effective = {
        key: `new:${line.no}`,
        bg_name: `[NEW GOOD - CONFIRM] ${clean(line.description)}`,
        bg_phrase: '',
        hs: { hs6: '999999', cn: '00', taric: '00' },
        origin: iso(line.origin || invoice?.seller?.country),
        source: 'placeholder_user_input',
      };
      new_goods.push({
        group: clean(line.description).slice(0, 120) || `line-${line.no}`,
        descriptions: [edgeCollapse(clean(line.description))],
        line_nos: [String(line.no)],
      });
      warnings.push(
        `ред ${line.no}: not in catalog — човешка класификация е задължителна`,
      );
    }
    line.catalog_key = effective.key;
    const group = String(
        effective.map_group || effective.key || `line:${line.no}`,
      ),
      key = `${group}|${effective.hs?.hs6 || ''}${effective.hs?.cn || ''}${effective.hs?.taric || ''}|${effective.origin || line.origin || ''}`;
    let g = groupsMap.get(key);
    if (!g) {
      g = {
        group,
        entry: effective,
        lines: [],
        source,
        invoice_codes: [],
        line_nos: [],
      };
      groupsMap.set(key, g);
    }
    g.lines.push(line);
    g.line_nos.push(String(line.no));
    if (invCode && !g.invoice_codes.includes(invCode))
      g.invoice_codes.push(invCode);
  }
  for (const l of goods)
    if (l.subtotal < 0)
      warnings.push(
        `ред ${l.no}: отрицателна стойност ${l.subtotal} — приспада към 0.00 при деклариране, проверете кредитния ред`,
      );
  const groups = [...groupsMap.values()],
    goodsValue = num(invoice.total_goods_value),
    // Freight embedded in the invoice (a charge row or the shipping_cost
    // field) is folded into the item prices by gross-weight share — the
    // canonical presentation: Σ ItemPrice == TotalAmountInvoiced ==
    // grand_total, no AK row. extras.valuation_freight_total is the TOTAL
    // freight to declare; only the part beyond what the invoice embeds is
    // emitted as an AK valuation addition (external transport invoices).
    embeddedFreight = chargeTotal || num(invoice.shipping_cost),
    declaredFreight =
      Math.max(0, num(extras.valuation_freight_total) - embeddedFreight) +
      num(extras.valuation_freight_external),
    lineTotal = goods.reduce((a: number, l: any) => a + l.subtotal, 0),
    totalInvoice =
      num(invoice.grand_total) ||
      (goodsValue > 0 ? goodsValue + embeddedFreight : 0) ||
      lineTotal + embeddedFreight;
  if (Math.abs(totalInvoice - lineTotal - embeddedFreight) > 0.02)
    warnings.push(
      `Крайна сума ${f2(totalInvoice)} надвишава сбора на редовете ${f2(lineTotal + embeddedFreight)} с ${f2(Math.abs(totalInvoice - lineTotal - embeddedFreight))} (напр. транспорт/такси) — разликата е разпределена пропорционално по позициите`,
    );
  const masses = itemMasses(
    groups.map((g) => ({
      no: g.line_nos[0],
      subtotal: g.lines.reduce((a: number, l: any) => a + l.subtotal, 0),
      qty: g.lines.reduce(
        (a: number, l: any) => a + num(l.qty ?? l.quantity),
        0,
      ),
      qty_unit: g.lines[0]?.qty_unit ?? g.lines[0]?.unit,
      catalog_key: g.entry.key,
    })),
    extras,
    invoice,
  );
  const exchange = Math.max(
    0.0000001,
    num(
      extras.exchange_rate,
      String(invoice.currency || '').toUpperCase() === 'EUR' ? 1 : 1,
    ),
  );
  const addInsurance = num(extras.valuation_insurance_total),
    totalBase =
      groups.reduce(
        (a, g) => a + g.lines.reduce((x: number, l: any) => x + l.subtotal, 0),
        0,
      ) || 1,
    totalPackages = String(extras.total_packages ?? invoice.pieces ?? '1');
  const docs = docsForItem(invoice, extras, template);
  const items: GoodItem[] = [];
  const grouping: any[] = [];
  // Exact-anchoring (money to the cent, mass at 6dp): force Σ ItemPrice == TotalAmountInvoiced and
  // Σ GrossMassKg == TotalGrossMassKg; the rounding remainder lands on the biggest line. Kills
  // conformance 'totals'/'totals.gross' penny-drift at the source instead of tolerating it.
  const goodsAnchor = Math.max(0, totalInvoice - embeddedFreight);
  const priceCents = groups.map((g) => {
    const pr = g.lines.reduce((a: number, l: any) => a + l.subtotal, 0);
    return Math.round(
      (pr + (goodsAnchor - lineTotal) * (pr / (lineTotal || 1))) * 100,
    );
  });
  {
    const diffC =
      Math.round(goodsAnchor * 100) - priceCents.reduce((a, c) => a + c, 0);
    if (diffC) {
      let k = 0;
      for (let i = 1; i < priceCents.length; i++)
        if (priceCents[i] > priceCents[k]) k = i;
      priceCents[k] += diffC;
    }
  }
  const grossUnits = groups.map((g, i) =>
    Math.round(
      Math.max(Number(masses.nets[i]) || 0, Number(masses.gross[i]) || 0) * 1e6,
    ),
  );
  {
    let diffU =
      Math.round(Number(masses.totalGross) * 1e6) -
      grossUnits.reduce((a, c) => a + c, 0);
    if (diffU) {
      // Distribute the rounding remainder across lines (largest first); a
      // negative diff may need several lines since no line may dip below net.
      const order = [...grossUnits.keys()].sort(
        (a, b) => grossUnits[b] - grossUnits[a],
      );
      for (const i of order) {
        if (!diffU) break;
        const floor = Math.round((Number(masses.nets[i]) || 0) * 1e6),
          delta =
            diffU > 0 ? diffU : Math.max(diffU, floor - grossUnits[i]);
        grossUnits[i] += delta;
        diffU -= delta;
      }
      if (diffU)
        warnings.push(
          `бруто: позициите не могат да се изравнят с общото тегло (разлика ${(diffU / 1e6).toFixed(6)} kg) — проверете нето/бруто в Декларация`,
        );
    }
  }
  // Embedded invoice freight folds into the item price by gross-weight share
  // (canonical presentation: Σ ItemPrice == grand_total). Explicit freight
  // beyond the embedded part is a separate AK addition. Both are cent-anchored;
  // Σ BC anchors to the insurance total (remainder lands on the largest item).
  const grossAll = grossUnits.reduce((a: number, u: number) => a + u, 0) || 1,
    foldCents = groups.map((g, i) =>
      Math.round(((embeddedFreight * grossUnits[i]) / grossAll) * 100),
    ),
    freightCents = groups.map((g, i) => {
      const rawVal = g.lines.reduce((a: number, l: any) => a + l.subtotal, 0),
        wShare = grossAll > 0 ? grossUnits[i] / grossAll : rawVal / totalBase;
      return Math.round(declaredFreight * wShare * 100);
    }),
    insCents = groups.map((g) =>
      Math.round(
        addInsurance *
          (g.lines.reduce((a: number, l: any) => a + l.subtotal, 0) /
            totalBase) *
          100,
      ),
    );
  for (const [cents, total] of [
    [foldCents, embeddedFreight],
    [freightCents, declaredFreight],
    [insCents, addInsurance],
  ] as const) {
    const diff = Math.round(total * 100) - cents.reduce((a, b) => a + b, 0);
    if (diff && cents.length) {
      let k = 0;
      for (let i = 1; i < cents.length; i++) if (cents[i] > cents[k]) k = i;
      cents[k] += diff;
    }
  }
  // Waybill/invoice package count is the truth — apportion it across items by
  // gross-weight share (largest remainder) so Σ NumberOfPackages == header.
  const pkgTotal = Math.max(0, Math.round(num(totalPackages))),
    rawPkgShares = groups.map(
      (g, i) => (pkgTotal * grossUnits[i]) / (grossAll || 1),
    ),
    itemPkgs = rawPkgShares.map((s) => Math.floor(s));
  {
    let rem = pkgTotal - itemPkgs.reduce((a: number, b: number) => a + b, 0);
    for (const i of [...groups.keys()].sort(
      (a, b) => rawPkgShares[b] - itemPkgs[b] - (rawPkgShares[a] - itemPkgs[a]),
    )) {
      if (rem <= 0) break;
      itemPkgs[i] += 1;
      rem -= 1;
    }
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i],
      entry = g.entry,
      priceRaw = g.lines.reduce((a: number, l: any) => a + l.subtotal, 0),
      price = (priceCents[i] + foldCents[i]) / 100,
      freight = freightCents[i] / 100,
      insurance = insCents[i] / 100,
      stat = (price + freight + insurance) * exchange,
      code =
        String(entry.hs?.hs6 || '999999') +
        String(entry.hs?.cn || '00') +
        String(entry.hs?.taric || '00'),
      canonicalDescription = dynamicDescription(
        entry,
        g.lines,
        Number(masses.nets[i]) || 0,
      ),
      hasDynamicTemplate = !!String(
        entry.declaration_description_template || '',
      ).trim(),
      descBase =
        canonicalDescription ||
        clean(
          entry.bg_name || g.lines.map((l: any) => l.description).join('; '),
        ),
      phrase = canonicalDescription ? '' : clean(entry.bg_phrase),
      maxDesc =
        Number(template?.canonical_h1?.max_description_length) ||
        ALPHA_TEXT_LIMITS.descriptionOfGoods,
      descFull =
        canonicalDescription || `${descBase}${phrase ? ` - ${phrase}` : ''}`,
      desc = descFull.slice(0, maxDesc),
      it = newGoodItem({
        GoodsItemNo: String(i + 1),
        StatisticalValue: f2(stat),
      });
    it.Commodity.descriptionOfGoods = desc;
    if (descFull.length > maxDesc)
      warnings.push(
        `позиция ${i + 1}: описанието е ${descFull.length} символа > ${maxDesc} — съкратено до максимума, проверете загубения текст`,
      );
    it.Commodity.CommodityCode = {
      harmonizedSystemSubheadingCode: code.slice(0, 6),
      combinedNomenclatureCode: code.slice(6, 8),
      taricCode: code.slice(8, 10),
      TaricAddCode: [...(entry.taric_add_codes || [])],
      NationalCode: [...(entry.national_codes || [])],
    };
    it.Commodity.Preference = String(entry.preference || '100');
    it.Commodity.GOODSMEASURE = {
      NetMassKg: f6(masses.nets[i]),
      GrossMassKg: f6(grossUnits[i] / 1e6),
      SupplementaryUnits: entry.supplementary
        ? f6(
            g.lines.reduce(
              (a: number, l: any) => a + num(l.qty ?? l.quantity),
              0,
            ),
          )
        : null,
    };
    it.Commodity.ItemPrice = f2(price);
    it.Commodity.InvDest = String(
      entry.inv_dest || defaults.inv_dest || extras.inv_dest || '1',
    );
    it.CUSTOMSVALUATION = {
      ValuationMethod: '1',
      // AlphaAgent always serialises BC + FF (FF is a permanent 0); AK only
      // appears when a freight addition exists.
      AdditionsAndDeductions: [
        ...(freight ? [{ code: 'AK', amount: f2(freight) }] : []),
        { code: 'BC', amount: insurance ? f2(insurance) : '0' },
        { code: 'FF', amount: '0' },
      ],
    };
    it.Procedure = {
      requestedProcedure: String(entry.requested_procedure || '40'),
      previousProcedure: String(entry.previous_procedure || '00'),
      additionalProcedure: String(entry.additional_procedure || '000'),
    };
    it.ORIGIN = {
      CountryOfOrigin: iso(
        entry.origin ||
          g.lines.find((l: any) => l.origin)?.origin ||
          invoice?.seller?.country,
      ),
      CountryOfPrefOrigin: null,
    };
    it.PACKAGING = {
      ShippingMarks: String(
        extras.shipping_marks || defaults.shipping_marks || 'Колет',
      ).slice(0, ALPHA_TEXT_LIMITS.shippingMarks),
      NumberOfPackages: String(itemPkgs[i]),
      TypeOfPackages: String(
        extras.package_type || defaults.package_type || 'CT',
      ),
    };
    it.SupportingDocument = structuredClone(docs.support);
    it.TransportDocument = structuredClone(docs.transport);
    it.AdditionalReference =
      (extras.additional_refs_scope || 'first') === 'all' || i === 0
        ? structuredClone(extras.additional_refs || []).map((r: any) => ({
            ...r,
            referenceNumber: String(r?.referenceNumber ?? '').slice(
              0,
              ALPHA_TEXT_LIMITS.additionalReference,
            ),
          }))
        : [];
    it.ValuationIndicator = String(
      entry.valuation_indicator ||
        extras.valuation_indicator ||
        defaults.valuation_indicator ||
        '0000',
    );
    items.push(it);
    const source = g.source,
      confirmed = ![
        'invoice_code_fallback',
        'client_dossier_completion',
        'placeholder_user_input',
      ].includes(source);
    grouping.push({
      item: i + 1,
      group: g.group,
      line_nos: g.line_nos,
      descriptions: [
        ...new Set(
          g.lines.map((l: any) => edgeCollapse(clean(l.description))),
        ),
      ],
      invoice_codes: g.invoice_codes,
      catalog_key: entry.key,
      source,
      classification_state: confirmed ? 'confirmed' : 'review_required',
      declaration_hs: code,
      declaration_origin: it.ORIGIN.CountryOfOrigin,
      net_kg: it.Commodity.GOODSMEASURE.NetMassKg,
      price: it.Commodity.ItemPrice,
    });
  }
  const d = newDeclaration();
  d.Sender = 'TRA.APP';
  d.SenderCode = String(
    template.sender_code || template.representative?.tin || '',
  );
  d.Recipient = String(template.recipient || 'MISV.BG');
  d.RecipientCode = String(template.recipient_code || 'BG005100');
  d.preparationDateAndTime = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  d.MessageType = 'BG415A';
  d.REPRESENTATIVE_TIN = String(
    template.representative?.tin || template.sender_code || '',
  );
  d.REPRESENTATIVE_StatusCode = String(template.representative?.status || '2');
  const au = ctx.authorisation || template.authorisation;
  if (au?.type)
    d.Authorisation = {
      type: String(au.type),
      referenceNumber: String(au.referenceNumber || ''),
      holderOfTheAuthorisation: String(
        au.holderOfTheAuthorisation || d.REPRESENTATIVE_TIN,
      ),
    };
  d.NatOfMeansOfTransCrosBorder = String(
    ctx.border_transport?.nationality ??
      defaults.nat_of_means ??
      invoice?.seller?.country ??
      '',
  ).slice(0, ALPHA_TEXT_LIMITS.borderNationality);
  d.ModeOfTransAtBorder = String(
    ctx.border_transport?.mode ?? defaults.mode_of_trans_at_border ?? '4',
  );
  d.DECLARANT_TIN = String(
    template.declarant_tin || template.importer_tin || '',
  );
  d.EXPORTER = partyFromInvoice(
    invoice.seller,
    String(template?.canonical_h1?.exporter_name || ''),
    template?.canonical_h1?.field_max || {},
  );
  d.LODGINGOFFICE_CustOfficeCode = String(
    ctx.lodging_office ?? template.lodging_office ?? '',
  );
  d.DECHEA = {
    DeclarationCode: String(
      ctx.declaration_code ?? defaults.declaration_code ?? 'H1',
    ),
    Lrn: String(extras.lrn || template.lrn || ''),
    DeclarationType: 'IM',
    AddDeclarationType: String(
      ctx.add_declaration_type ?? defaults.add_declaration_type ?? 'A',
    ),
    TotalAmountInvoiced: f2(totalInvoice),
    InvoiceCurrency: String(invoice.currency || 'EUR').toUpperCase(),
    TotalGrossMassKg: f6(masses.totalGross),
    TotalNumberOfItems: String(items.length),
    TotalPackages: String(totalPackages),
  };
  const loc = ctx.location_of_goods ?? template.location_of_goods,
    dterms = ctx.delivery_terms ?? {
      incotermCode: invoice.price_term,
      country: ['C', 'D'].includes(String(invoice.price_term || '')[0])
        ? iso(invoice.buyer?.country, 'BG')
        : iso(invoice.seller?.country, 'CN'),
      location: invoice.price_term_place,
    };
  d.GOODSSHIPMENT = {
    NatureOfTransaction: String(
      ctx.nature_of_transaction ?? defaults.nature_of_transaction ?? '11',
    ),
    CONSIGNMENT: {
      ContainerInd: String(
        ctx.container_indicator ?? defaults.container_ind ?? '0',
      ),
      InlandModeOfTransport: String(
        ctx.inland_mode ?? defaults.inland_mode ?? '3',
      ).slice(0, ALPHA_TEXT_LIMITS.inlandMode),
      ARRIVALTRANSPORTMEANS: (() => {
        const at = ctx.arrival_transport || extras.arrival_transport;
        return at
          ? {
              IdeOfMeaOfTraAtArrival: String(
                at.IdeOfMeaOfTraAtArrival || '',
              ).slice(0, ALPHA_TEXT_LIMITS.arrivalMeans),
              IdeOfMeaOfTraAtArrivalCode: String(
                at.IdeOfMeaOfTraAtArrivalCode || '',
              ),
            }
          : null;
      })(),
      LocationOfGoods: loc
        ? {
            typeOfLocation: String(loc.typeOfLocation || 'D').slice(
              0,
              ALPHA_TEXT_LIMITS.locationType,
            ),
            qualifierOfIdentification: String(
              loc.qualifierOfIdentification || 'Z',
            ).slice(0, ALPHA_TEXT_LIMITS.locationQualifier),
            ADDRESS: loc.ADDRESS
              ? address({
                  City: String(loc.ADDRESS.City || '').slice(
                    0,
                    ALPHA_TEXT_LIMITS.locationCity,
                  ),
                  Country: loc.ADDRESS.Country,
                  StreetAndNumber: String(
                    loc.ADDRESS.StreetAndNumber || '',
                  ).slice(0, ALPHA_TEXT_LIMITS.locationStreet),
                  Postcode: String(loc.ADDRESS.Postcode || '').slice(
                    0,
                    ALPHA_TEXT_LIMITS.locationPostcode,
                  ),
                })
              : null,
          }
        : null,
    },
    DestinationCountryCode: iso(
      ctx.destination_country ?? invoice.buyer?.country,
      'BG',
    ),
    CountryOfDispatch: iso(
      ctx.country_of_dispatch ?? invoice.seller?.country,
      'CN',
    ),
    GOODITEM: items,
    IMPORTER_TIN: String(template.importer_tin || template.declarant_tin || ''),
    CONSIGNEE: null,
    SELLER: partyFromInvoice(invoice.seller),
    DeliveryTerms: dterms
      ? {
          incotermCode: String(dterms.incotermCode || invoice.price_term || ''),
          country: iso(dterms.country || invoice.buyer?.country, 'BG'),
          location: String(dterms.location || invoice.price_term_place || ''),
        }
      : null,
    PreviousDocument: [
      ...((ctx.previous_documents?.length
        ? ctx.previous_documents
        : extras.previous_documents) || []),
    ],
  };
  const rep = {
    schema: 'declgen.build-report/v2',
    warnings,
    new_goods,
    matched: matches,
    grouping,
    goods_items: items.map((it) => ({
      item_no: it.GoodsItemNo,
      hs_code: `${it.Commodity.CommodityCode.harmonizedSystemSubheadingCode}${it.Commodity.CommodityCode.combinedNomenclatureCode}${it.Commodity.CommodityCode.taricCode}`,
      description: it.Commodity.descriptionOfGoods,
      net_kg: it.Commodity.GOODSMEASURE.NetMassKg,
      gross_kg: it.Commodity.GOODSMEASURE.GrossMassKg,
      price: it.Commodity.ItemPrice,
      statistical_value: it.StatisticalValue,
      origin: it.ORIGIN.CountryOfOrigin,
    })),
    declaration_context: ctx,
    context_boundary: boundary,
    exchange_rate: exchange,
    valuation: {
      freight_total: declaredFreight,
      freight_embedded_in_prices: embeddedFreight,
      insurance_total: addInsurance,
    },
  };
  return [d, rep];
}
