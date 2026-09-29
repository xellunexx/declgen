export class DeclarationContextError extends Error {}
const FIELDS = new Set([
  'declaration_code',
  'declaration_type',
  'add_declaration_type',
  'lodging_office',
  'nature_of_transaction',
  'border_transport',
  'inland_mode',
  'container_indicator',
  'arrival_transport',
  'location_of_goods',
  'country_of_dispatch',
  'destination_country',
  'delivery_terms',
  'authorisation',
  'previous_documents',
]);
const NESTED: Record<string, Set<string>> = {
  border_transport: new Set(['nationality', 'mode']),
  arrival_transport: new Set([
    'IdeOfMeaOfTraAtArrival',
    'IdeOfMeaOfTraAtArrivalCode',
  ]),
  location_of_goods: new Set([
    'typeOfLocation',
    'qualifierOfIdentification',
    'ADDRESS',
  ]),
  delivery_terms: new Set(['incotermCode', 'country', 'location']),
  authorisation: new Set([
    'type',
    'referenceNumber',
    'holderOfTheAuthorisation',
  ]),
};
const ADDRESS = new Set(['City', 'Country', 'StreetAndNumber', 'Postcode']);
const DOC = new Set(['type', 'referenceNumber']);
const clone = <T>(x: T): T => structuredClone(x);
function mapping(value: unknown, label: string): Record<string, any> {
  if (value == null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new DeclarationContextError(`${label} must be a JSON object`);
  return clone(value as Record<string, any>);
}
function known(m: Record<string, any>, allowed: Set<string>, label: string) {
  const u = Object.keys(m)
    .filter((k) => !allowed.has(k))
    .sort();
  if (u.length)
    throw new DeclarationContextError(
      `${label}: unsupported field(s): ${u.join(', ')}`,
    );
}
function code(value: unknown, pattern: RegExp, label: string) {
  if (value != null && value !== '' && !pattern.test(String(value)))
    throw new DeclarationContextError(
      `${label}: invalid value ${JSON.stringify(value)}`,
    );
}
function validate(data: Record<string, any>, label: string) {
  known(data, FIELDS, label);
  for (const [name, allowed] of Object.entries(NESTED)) {
    if (!(name in data)) continue;
    const child = mapping(data[name], `${label}.${name}`);
    known(child, allowed, `${label}.${name}`);
    data[name] = child;
  }
  if (data.location_of_goods?.ADDRESS != null) {
    const a = mapping(
      data.location_of_goods.ADDRESS,
      `${label}.location_of_goods.ADDRESS`,
    );
    known(a, ADDRESS, `${label}.location_of_goods.ADDRESS`);
    data.location_of_goods.ADDRESS = a;
  }
  if ('previous_documents' in data) {
    if (!Array.isArray(data.previous_documents))
      throw new DeclarationContextError(
        `${label}.previous_documents must be a JSON array`,
      );
    data.previous_documents = data.previous_documents.map(
      (raw: any, i: number) => {
        const d = mapping(raw, `${label}.previous_documents[${i + 1}]`);
        known(d, DOC, `${label}.previous_documents[${i + 1}]`);
        if (!d.type || !d.referenceNumber)
          throw new DeclarationContextError(
            `${label}.previous_documents[${i + 1}] needs type and referenceNumber`,
          );
        return d;
      },
    );
  }
  code(data.declaration_code, /^H1$/, `${label}.declaration_code`);
  code(data.declaration_type, /^(?:IM|EX)$/, `${label}.declaration_type`);
  code(data.add_declaration_type, /^[A-Z]$/, `${label}.add_declaration_type`);
  code(data.lodging_office, /^[A-Z]{2}\d{6}$/, `${label}.lodging_office`);
  code(data.nature_of_transaction, /^\d{2}$/, `${label}.nature_of_transaction`);
  code(data.inland_mode, /^[1-9]$/, `${label}.inland_mode`);
  code(data.container_indicator, /^[01]$/, `${label}.container_indicator`);
  for (const n of ['country_of_dispatch', 'destination_country'])
    code(data[n], /^[A-Z]{2}$/, `${label}.${n}`);
  const b = data.border_transport ?? {};
  code(b.nationality, /^[A-Z]{2}$/, `${label}.border_transport.nationality`);
  code(b.mode, /^[1-9]$/, `${label}.border_transport.mode`);
  const t = data.delivery_terms ?? {};
  code(t.incotermCode, /^[A-Z]{3}$/, `${label}.delivery_terms.incotermCode`);
  code(t.country, /^[A-Z]{2}$/, `${label}.delivery_terms.country`);
}
export function resolve(
  template: Record<string, any>,
  extras: Record<string, any>,
  direction: string,
) {
  const profile = mapping(template?.declaration_profile, 'declaration_profile');
  const context = mapping(extras?.declaration_context, 'declaration_context');
  validate(profile, 'declaration_profile');
  validate(context, 'declaration_context');
  const intended = String(direction || '').toUpperCase();
  for (const [label, values] of [
    ['declaration_profile', profile],
    ['declaration_context', context],
  ] as const) {
    const d = values.declaration_type;
    if (d && d !== intended)
      throw new DeclarationContextError(
        `${label}.declaration_type=${JSON.stringify(d)} conflicts with build direction ${JSON.stringify(intended)}`,
      );
  }
  return [
    profile,
    context,
    {
      template_fields: Object.keys(profile).sort(),
      case_fields: Object.keys(context).sort(),
      boundary:
        'BG415A fields only; tariff/payment/warehouse/print state excluded',
    },
  ] as const;
}
