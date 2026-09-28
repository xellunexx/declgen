/** Reconstructed export transform. Original transform_ex.py was referenced but absent. */
import { Catalog } from './catalog.js';
import { newExport, type ExDeclaration, type ExGoodItem } from './bg515c.js';
const n = (v: any, d = 0) => {
    const s = String(v ?? '')
      .trim()
      .replace(',', '.');
    if (s === '') return d;
    const x = Number(s);
    return Number.isFinite(x) ? x : d;
  },
  f2 = (x: number) => Math.max(0, x).toFixed(2),
  f5 = (x: number) => Math.max(0, x).toFixed(5),
  f6 = (x: number) => Math.max(0, x).toFixed(6),
  clean = (x: any) =>
    String(x ?? '')
      .replace(/\s+/g, ' ')
      .trim();
const code8 = (v: any) => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length >= 8 ? d.slice(0, 8) : d.length === 6 ? d + '00' : null;
  },
  iso = (v: any, f = 'BG') =>
    /^[A-Z]{2}$/.test(String(v ?? '').toUpperCase())
      ? String(v).toUpperCase()
      : f;
export async function buildExport(
  invoice: any,
  tpl: any,
  catalog: Catalog,
  extras: any = {},
): Promise<[ExDeclaration, any]> {
  const lines = (invoice?.lines || []).map((l: any, i: number) => ({
    ...l,
    no: l.no ?? i + 1,
    subtotal: n(
      l.subtotal ?? l.total_amount ?? n(l.qty ?? l.quantity) * n(l.unit_price),
    ),
  }));
  if (!lines.length) throw new Error('invoice has no lines');
  const total = n(
      invoice.grand_total ??
        lines.reduce((a: number, l: any) => a + l.subtotal, 0),
    ),
    sum = lines.reduce((a: number, l: any) => a + l.subtotal, 0) || 1,
    totalNet = n(extras.total_net_kg ?? invoice.total_net_weight_kg),
    totalGross = n(extras.total_gross_kg ?? invoice.total_gross_weight_kg),
    rate = n(
      extras.exchange_rate,
      String(invoice.currency || '').toUpperCase() === 'EUR' ? 1 : 1,
    ),
    warnings: string[] = [],
    new_goods: any[] = [],
    grouping: any[] = [],
    items: ExGoodItem[] = [];
  const statCents = lines.map((l: any) =>
    Math.max(0, Math.round(l.subtotal * rate * 100)),
  );
  {
    const diffC =
      Math.round(total * rate * 100) -
      statCents.reduce((a: number, c: number) => a + c, 0);
    if (diffC) {
      let k = 0;
      for (let i = 1; i < statCents.length; i++)
        if (statCents[i] > statCents[k]) k = i;
      statCents[k] += diffC;
    }
  }
  const netsArr = lines.map((l: any) =>
      totalNet > 0
        ? totalNet * (l.subtotal / sum)
        : String(l.qty_unit ?? l.unit).toLowerCase() === 'kg'
          ? n(l.qty ?? l.quantity)
          : Math.max(0.001, n(l.qty ?? l.quantity) * 0.1),
    ),
    grossUnits = lines.map((l: any, i: number) =>
      Math.round(
        Math.max(
          netsArr[i],
          totalGross > 0 ? totalGross * (l.subtotal / sum) : netsArr[i] * 1.05,
        ) * 1e6,
      ),
    );
  if (totalGross > 0) {
    const diffU =
      Math.round(totalGross * 1e6) -
      grossUnits.reduce((a: number, c: number) => a + c, 0);
    if (diffU) {
      let k = 0;
      for (let i = 1; i < grossUnits.length; i++)
        if (grossUnits[i] > grossUnits[k]) k = i;
      if (grossUnits[k] + diffU >= Math.round(netsArr[k] * 1e6))
        grossUnits[k] += diffU;
    }
  }
  for (const l of lines)
    if (l.subtotal < 0)
      warnings.push(
        `ред ${l.no}: отрицателна стойност ${l.subtotal} — приспада към 0.00 при деклариране, проверете кредитния ред`,
      );
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i],
      [entry] = catalog.match(clean(l.description), l.hs_code),
      fallback = code8(l.hs_code);
    let code = entry
        ? `${entry.hs?.hs6 || ''}${entry.hs?.cn || '00'}`
        : fallback,
      source = entry?.source || 'invoice_code_fallback',
      desc = entry
        ? `${entry.bg_name || l.description}${entry.bg_phrase ? ` - ${entry.bg_phrase}` : ''}`
        : clean(l.description),
      origin = iso(entry?.origin || l.origin || invoice?.seller?.country, 'BG');
    if (!code) {
      code = '99999900';
      source = 'placeholder_user_input';
      desc = `[NEW GOOD - CONFIRM] ${desc}`;
      new_goods.push({
        group: clean(l.description),
        descriptions: [clean(l.description)],
        line_nos: [String(l.no)],
      });
    }
    if (source === 'invoice_code_fallback')
      warnings.push(
        `ред ${l.no}: кодът от фактурата изисква човешко потвърждение`,
      );
    const net = netsArr[i],
      gross = grossUnits[i] / 1e6,
      stat = statCents[i] / 100,
      qty = n(l.qty ?? l.quantity);
    const sd: any[] = [];
    if (invoice.invoice_number)
      sd.push({
        sequenceNumber: '1',
        type: invoice.is_proforma ? 'N325' : 'N380',
        referenceNumber: String(invoice.invoice_number),
      });
    items.push({
      declarationGoodsItemNumber: String(i + 1),
      statisticalValue: f2(stat),
      requestedProcedure: String(
        entry?.requested_procedure || tpl?.default_procedure || '10',
      ),
      previousProcedure: '00',
      countryOfOrigin: origin,
      Commodity: {
        descriptionOfGoods: desc.slice(0, 510),
        CommodityCode: {
          harmonizedSystemSubHeadingCode: code.slice(0, 6),
          combinedNomenclatureCode: code.slice(6, 8),
          TARICAdditionalCode: [],
        },
        GoodsMeasure: {
          grossMass: f6(gross),
          netMass: f6(net),
          supplementaryUnits: entry?.supplementary ? f6(qty) : null,
          supplementaryUnitsCode: entry?.supplementary_code || null,
        },
      },
      Packaging: {
        sequenceNumber: '1',
        typeOfPackages: String(extras.package_type || 'CT'),
        numberOfPackages:
          i === 0
            ? String(extras.total_packages ?? invoice.pieces ?? '1')
            : '0',
        shippingMarks: String(
          extras.shipping_marks || invoice.invoice_number || 'Кашон',
        ),
      },
      SupportingDocument: sd,
      AdditionalReference:
        (extras.additional_refs_scope || 'first') === 'all' || i === 0
          ? (extras.additional_refs || []).map((r: any, j: number) => ({
              sequenceNumber: String(j + 1),
              type: String(r.type),
              referenceNumber: String(r.referenceNumber),
            }))
          : [],
      AdditionalInformation: null,
    });
    grouping.push({
      item: i + 1,
      group: entry?.map_group || entry?.key || `line:${l.no}`,
      line_nos: [String(l.no)],
      descriptions: [clean(l.description)],
      invoice_codes: [fallback].filter(Boolean),
      catalog_key: entry?.key || null,
      source,
      classification_state: [
        'invoice_code_fallback',
        'placeholder_user_input',
      ].includes(source)
        ? 'review_required'
        : 'confirmed',
      declaration_hs: code,
      declaration_origin: origin,
      net_kg: f6(net),
      price: f2(l.subtotal),
    });
  }
  const d = newExport(),
    seller = invoice?.seller || {},
    buyer = invoice?.buyer || {};
  d.messageSenderCode = String(
    tpl?.sender_code ||
      tpl?.representative_tin ||
      tpl?.representative?.tin ||
      '',
  );
  d.messageRecipient = String(tpl?.export_recipient || 'NECA.BG');
  d.messageRecipientCode = String(
    tpl?.export_recipient_code || tpl?.recipient_code || 'BG005100',
  );
  d.preparationDateAndTime = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  d.ExportOperation = {
    LRN: String(extras.lrn || tpl?.export_lrn || ''),
    declarationType: 'EX',
    additionalDeclarationType: 'A',
    presentationOfTheGoodsDateAndTime: new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14),
    security: String(extras.security || '2'),
    totalAmountInvoiced: f2(total),
    invoiceCurrency: String(invoice.currency || 'EUR').toUpperCase(),
  };
  d.CustomsOfficeOfExport = String(
    extras.office_of_export ||
      tpl?.office_of_export ||
      tpl?.lodging_office ||
      '',
  );
  d.CustomsOfficeOfExitDeclared = String(
    extras.office_of_exit || tpl?.office_of_exit || '',
  );
  d.Exporter = String(
    tpl?.exporter_id || tpl?.declarant_tin || seller?.eori || seller?.tin || '',
  );
  d.Declarant = String(
    tpl?.export_declarant || tpl?.exporter_id || tpl?.declarant_tin || '',
  );
  d.Representative = String(
    tpl?.representative_tin ||
      tpl?.representative?.tin ||
      tpl?.sender_code ||
      '',
  );
  d.RepresentativeStatus = String(
    tpl?.representative_status || tpl?.representative?.status || '2',
  );
  d.CurrencyExchange = ['EUR', f5(rate)];
  const dt = {
      incotermCode: String(invoice.price_term || extras.incoterm || 'FCA'),
      location: String(invoice.price_term_place || extras.term_location || ''),
      country: iso(extras.term_country || seller?.country, 'BG'),
    },
    consignee = {
      name: String(buyer.company || buyer.name || '').slice(0, 70),
      Address: {
        streetAndNumber: String(buyer.address || '').slice(0, 70),
        postcode: String(buyer.postcode || ''),
        city: String(buyer.city || ''),
        country: iso(buyer.country, 'BG'),
      },
    };
  d.GoodsShipment = {
    natureOfTransaction: String(
      extras.nature_of_transaction ||
        tpl?.defaults?.nature_of_transaction ||
        '11',
    ),
    countryOfExport: iso(extras.country_of_export || seller?.country, 'BG'),
    countryOfDestination: iso(
      extras.destination_country || buyer?.country,
      'BG',
    ),
    DeliveryTerms: dt,
    Consignment: {
      containerIndicator: String(
        extras.container_indicator || tpl?.defaults?.container_ind || '0',
      ),
      inlandModeOfTransport: String(
        extras.inland_mode || tpl?.defaults?.inland_mode || '3',
      ),
      modeOfTransportAtTheBorder: String(
        extras.mode_border || tpl?.defaults?.mode_of_trans_at_border || '3',
      ),
      grossMass: f6(
        totalGross ||
          items.reduce(
            (a, it) => a + n(it.Commodity.GoodsMeasure.grossMass),
            0,
          ),
      ),
      Carrier: extras.carrier || null,
      Consignee: consignee,
      TransportEquipment: [],
      LocationOfGoods:
        extras.location_of_goods || tpl?.location_of_goods_ex || null,
      DepartureTransportMeans: extras.departure_transport || [],
      CountryOfRoutingOfConsignment: extras.routing_countries || [],
      ActiveBorderTransportMeans: extras.active_border_transport || null,
      TransportDocument: (extras.transport_documents || []).map(
        (r: any, i: number) => ({
          sequenceNumber: String(i + 1),
          type: String(r.type),
          referenceNumber: String(r.referenceNumber),
        }),
      ),
      TransportCharges: String(extras.transport_charges || 'D'),
    },
    GoodsItem: items,
  };
  const report = {
    schema: 'declgen.build-report-ex/v2',
    warnings,
    new_goods,
    grouping,
    goods_items: items.map((it) => ({
      item_no: it.declarationGoodsItemNumber,
      hs_code: `${it.Commodity.CommodityCode.harmonizedSystemSubHeadingCode}${it.Commodity.CommodityCode.combinedNomenclatureCode}`,
      description: it.Commodity.descriptionOfGoods,
      net_kg: it.Commodity.GoodsMeasure.netMass,
      gross_kg: it.Commodity.GoodsMeasure.grossMass,
      price: '—',
      statistical_value: it.statisticalValue,
      origin: it.countryOfOrigin,
    })),
    declaration_context: extras.declaration_context || {},
  };
  return [d, report];
}
