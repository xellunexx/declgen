import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { clientsDir } from './paths.js';
export const PROFILE_SCHEMA = 'declgen.client-profile-import/v1';
export const REVIEW_FIELDS: [string, string][] = [
  ['sender_code', 'Код на подателя'],
  ['recipient', 'Получател на съобщението'],
  ['recipient_code', 'Код на получателя'],
  ['declarant_tin', 'EORI на декларатора'],
  ['importer_tin', 'EORI на вносителя'],
  ['representative_tin', 'EORI на представителя'],
  ['representative_status', 'Статус на представителя'],
  ['lodging_office', 'Митническо учреждение'],
  ['authorisation_type', 'Вид разрешение'],
  ['authorisation_reference', 'Референция разрешение'],
  ['authorisation_holder', 'Титуляр на разрешението'],
  ['declaration_code', 'Код декларация'],
  ['declaration_type', 'Посока'],
  ['add_declaration_type', 'Допълнителен вид'],
  ['nature_of_transaction', 'Вид сделка'],
  ['border_nationality', 'Националност на транспортното средство'],
  ['border_mode', 'Вид транспорт на границата'],
  ['inland_mode', 'Вътрешен вид транспорт'],
  ['container_indicator', 'Контейнер'],
  ['destination_country', 'Държава на получаване'],
  ['dispatch_country', 'Държава на изпращане (само като подсказка)'],
  ['incoterm', 'Incoterm'],
  ['term_location', 'Място по Incoterm'],
  ['term_country', 'Държава по Incoterm'],
  ['location_type', 'Тип местонахождение на стоките'],
  ['location_qualifier', 'Квалификатор на местонахождението'],
  ['location_city', 'Град на местонахождението'],
  ['location_country', 'Държава на местонахождението'],
  ['location_street', 'Адрес на местонахождението'],
  ['location_postcode', 'Пощенски код на местонахождението'],
];
const MUTABLE = new Set([
  'lrn',
  'mrn',
  'preparationdateandtime',
  'invoicecurrency',
  'totalamountinvoiced',
  'totalgrossmasskg',
  'totalnumberofitems',
  'totalpackages',
  'goodsitemno',
  'statisticalvalue',
  'itemprice',
  'grossmasskg',
  'netmasskg',
  'referencenumber',
  'ideofmeaoftraatarrival',
  'supportingdocument',
  'transportdocument',
  'previousdocument',
]);
const local = (s: any) =>
    String(s ?? '')
      .split('}')
      .pop()!
      .split(':')
      .pop()!,
  norm = (s: any) =>
    local(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string[][]> = {
  sender_code: [
    ['SenderCode'],
    ['Sender', 'Code'],
    ['ApplicationSender', 'Id'],
  ],
  recipient: [['Recipient'], ['ApplicationRecipient']],
  recipient_code: [['RecipientCode'], ['Recipient', 'Code']],
  declarant_tin: [
    ['DECLARANT', 'TIN'],
    ['Declarant', 'EORI'],
    ['DeclarantEORI'],
  ],
  importer_tin: [
    ['IMPORTER', 'TIN'],
    ['Importer', 'EORI'],
    ['ImporterEORI'],
    ['Consignee', 'EORI'],
  ],
  representative_tin: [
    ['REPRESENTATIVE', 'TIN'],
    ['Representative', 'EORI'],
    ['RepresentativeEORI'],
    ['CustomsAgent', 'EORI'],
  ],
  representative_status: [
    ['REPRESENTATIVE', 'StatusCode'],
    ['Representative', 'Status'],
  ],
  lodging_office: [
    ['LODGINGOFFICE', 'CustOfficeCode'],
    ['LodgingOffice'],
    ['CustomsOffice', 'Code'],
    ['CustomsOfficeCode'],
  ],
  authorisation_type: [
    ['Authorisation', 'type'],
    ['Authorization', 'type'],
    ['AuthorisationType'],
    ['AuthorizationType'],
  ],
  authorisation_reference: [
    ['Authorisation', 'referenceNumber'],
    ['Authorization', 'referenceNumber'],
    ['AuthorisationReference'],
    ['AuthorizationReference'],
  ],
  authorisation_holder: [
    ['Authorisation', 'holderOfTheAuthorisation'],
    ['Authorization', 'holderOfAuthorisation'],
    ['AuthorisationHolder'],
    ['AuthorizationHolder'],
  ],
  declaration_code: [['DECHEA', 'DeclarationCode'], ['DeclarationCode']],
  declaration_type: [
    ['DECHEA', 'DeclarationType'],
    ['DeclarationType'],
    ['Direction'],
  ],
  add_declaration_type: [
    ['DECHEA', 'AddDeclarationType'],
    ['AdditionalDeclarationType'],
  ],
  nature_of_transaction: [
    ['GOODSSHIPMENT', 'NatureOfTransaction'],
    ['NatureOfTransaction'],
    ['TransactionNature'],
  ],
  border_nationality: [
    ['BORTRANSMEANS', 'NatOfMeansOfTransCrosBorder'],
    ['BorderTransport', 'Nationality'],
    ['TransportNationality'],
  ],
  border_mode: [
    ['BORTRANSMEANS', 'ModeOfTransAtBorder'],
    ['BorderTransport', 'Mode'],
    ['ModeOfTransportAtBorder'],
  ],
  inland_mode: [
    ['CONSIGNMENT', 'InlandModeOfTransport'],
    ['InlandModeOfTransport'],
  ],
  container_indicator: [
    ['CONSIGNMENT', 'ContainerInd'],
    ['ContainerIndicator'],
  ],
  destination_country: [
    ['DESTINATION', 'DestinationCountryCode'],
    ['DestinationCountry'],
    ['CountryOfDestination'],
  ],
  dispatch_country: [
    ['EXPORTCOUNTRY', 'CountryOfDispatch'],
    ['CountryOfDispatch'],
    ['DispatchCountry'],
  ],
  incoterm: [['DeliveryTerms', 'incotermCode'], ['Incoterm'], ['IncotermCode']],
  term_location: [
    ['DeliveryTerms', 'location'],
    ['IncotermLocation'],
    ['DeliveryPlace'],
  ],
  term_country: [
    ['DeliveryTerms', 'country'],
    ['IncotermCountry'],
    ['DeliveryCountry'],
  ],
  location_type: [
    ['LocationOfGoods', 'typeOfLocation'],
    ['GoodsLocation', 'Type'],
  ],
  location_qualifier: [
    ['LocationOfGoods', 'qualifierOfIdentification'],
    ['GoodsLocation', 'Qualifier'],
  ],
  location_city: [
    ['LocationOfGoods', 'ADDRESS', 'City'],
    ['GoodsLocation', 'Address', 'City'],
  ],
  location_country: [
    ['LocationOfGoods', 'ADDRESS', 'Country'],
    ['GoodsLocation', 'Address', 'Country'],
  ],
  location_street: [
    ['LocationOfGoods', 'ADDRESS', 'StreetAndNumber'],
    ['GoodsLocation', 'Address', 'Street'],
  ],
  location_postcode: [
    ['LocationOfGoods', 'ADDRESS', 'Postcode'],
    ['GoodsLocation', 'Address', 'Postcode'],
  ],
};
interface Rec {
  path: string[];
  normal: string[];
  value: string;
}
// fast-xml-parser preserveOrder represents text as #text objects; normalize with a separate walker.
function orderedRecords(xml: string): { root: string; records: Rec[] } {
  if (/<!doctype|<!entity/i.test(xml))
    throw new Error(
      'XML шаблонът съдържа DTD/entity и не се приема за импорт.',
    );
  const parser = new XMLParser({
    ignoreAttributes: false,
    preserveOrder: true,
    parseTagValue: false,
    trimValues: true,
  });
  const tree: any[] = parser.parse(xml),
    out: Rec[] = [];
  let root = '';
  const walk = (arr: any[], p: string[]) => {
    for (const obj of arr || []) {
      for (const [k, v] of Object.entries(obj || {})) {
        if (k === '#text') {
          const text = String(v ?? '').trim();
          if (text && p.length)
            out.push({ path: [...p], normal: p.map(norm), value: text });
          continue;
        }
        if (k.startsWith(':@')) continue;
        if (!root) root = local(k);
        if (Array.isArray(v)) walk(v, [...p, local(k)]);
      }
    }
  };
  walk(tree, []);
  return { root, records: out };
}
function pick(records: Rec[], alts: string[][]): [string, string] {
  for (const a of alts) {
    const wanted = a.map(norm);
    for (const r of records)
      if (
        r.normal.length >= wanted.length &&
        r.normal.slice(-wanted.length).every((x, i) => x === wanted[i])
      )
        return [r.value, r.path.join('/')];
  }
  return ['', ''];
}
export async function inspect(file: string) {
  const xml = await fs.readFile(file, 'utf8'),
    { root, records } = orderedRecords(xml),
    values: Record<string, string> = {},
    evidence: Record<string, string> = {};
  for (const [k, a] of Object.entries(aliases)) {
    const [v, p] = pick(records, a);
    values[k] = v;
    if (p) evidence[k] = p;
  }
  const ignored = [
      ...new Set(
        records
          .filter((r) => MUTABLE.has(norm(r.path.at(-1))))
          .map((r) => r.path.at(-1)!),
      ),
    ].sort(),
    missing = REVIEW_FIELDS.filter(([k]) => !values[k]).map(([k]) => k);
  const result: any = {
    schema: PROFILE_SCHEMA,
    source_file: path.basename(file),
    root_tag: root,
    source_format:
      norm(root) === 'bg415a' ? 'BG415A' : 'external-xml-normalized',
    values,
    evidence,
    missing,
    ignored_shipment_tags: ignored,
  };
  result.suggested_id = suggestClientId(result);
  result.fields = REVIEW_FIELDS.map(([key, label]) => ({
    key,
    label,
    value: values[key] || '',
    evidence: evidence[key] || '',
  }));
  return result;
}
export function suggestClientId(result: any) {
  return (
    String(result?.values?.importer_tin || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '') || 'new-corporate-client'
  ).slice(0, 48);
}
const present = (o: any) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) =>
        v != null &&
        v !== '' &&
        !(Array.isArray(v) && !v.length) &&
        !(
          typeof v === 'object' &&
          !Array.isArray(v) &&
          !Object.keys(v as any).length
        ),
    ),
  );
export function buildTemplate(
  result: any,
  clientId: string,
  overrides: any = {},
) {
  clientId = String(clientId || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!clientId) throw new Error('Посочете кратък идентификатор на клиента.');
  const values = {
    ...(result.values || {}),
    ...Object.fromEntries(
      Object.entries(overrides || {}).filter(
        ([, v]) => v !== null && v !== undefined,
      ),
    ),
  };
  const location = present({
      typeOfLocation: values.location_type,
      qualifierOfIdentification: values.location_qualifier,
      ADDRESS: present({
        City: values.location_city,
        Country: values.location_country,
        StreetAndNumber: values.location_street,
        Postcode: values.location_postcode,
      }),
    }),
    terms = present({
      incotermCode: values.incoterm,
      location: values.term_location,
      country: values.term_country,
    }),
    profile = present({
      declaration_code: values.declaration_code,
      declaration_type: values.declaration_type,
      add_declaration_type: values.add_declaration_type,
      lodging_office: values.lodging_office,
      nature_of_transaction: values.nature_of_transaction,
      border_transport: present({
        nationality: values.border_nationality,
        mode: values.border_mode,
      }),
      inland_mode: values.inland_mode,
      container_indicator: values.container_indicator,
      location_of_goods: location,
      destination_country: values.destination_country,
      delivery_terms: terms,
    }),
    authorisation = present({
      type: values.authorisation_type,
      referenceNumber: values.authorisation_reference,
      holderOfTheAuthorisation: values.authorisation_holder,
    });
  return present({
    client_id: clientId,
    capabilities: ['', 'IM'].includes(values.declaration_type || 'IM')
      ? ['IM']
      : [],
    sender_code: values.sender_code,
    recipient: values.recipient,
    recipient_code: values.recipient_code,
    declarant_tin: values.declarant_tin,
    importer_tin: values.importer_tin,
    representative: present({
      tin: values.representative_tin,
      status: values.representative_status,
    }),
    authorisation,
    lodging_office: values.lodging_office,
    defaults: present({
      declaration_code: values.declaration_code,
      declaration_type: values.declaration_type,
      add_declaration_type: values.add_declaration_type,
      nature_of_transaction: values.nature_of_transaction,
      mode_of_trans_at_border: values.border_mode,
      nat_of_means: values.border_nationality,
      container_ind: values.container_indicator,
      inland_mode: values.inland_mode,
    }),
    location_of_goods: location,
    declaration_profile: profile,
    profile_import: {
      schema: PROFILE_SCHEMA,
      source_file: result.source_file,
      source_format: result.source_format,
      root_tag: result.root_tag,
      evidence: result.evidence || {},
      missing_at_import: result.missing || [],
      ignored_shipment_tags: result.ignored_shipment_tags || [],
    },
    notes: [
      'Imported historical XML profile; shipment identifiers and commercial values excluded.',
    ],
  });
}
export async function saveTemplate(template: any, directory = clientsDir()) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${template.client_id}.json`);
  try {
    await fs.access(target);
    const vd = path.join(directory, `${template.client_id}.versions`);
    await fs.mkdir(vd, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    await fs.copyFile(
      target,
      path.join(vd, `${template.client_id}-${stamp}.json`),
    );
  } catch {}
  await fs.writeFile(target, JSON.stringify(template, null, 2), 'utf8');
  return target;
}
