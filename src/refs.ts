// Reference pickers for combo-box fields (dropdown + free text). Keep values exact:
// these land in BG415A/BG515C XML, so codes must stay the machine-readable truth.
export const INCOTERMS: Array<[string, string]> = [
  ['EXW', 'Ex Works'],
  ['FCA', 'Free Carrier'],
  ['FAS', 'Free Alongside Ship'],
  ['FOB', 'Free On Board'],
  ['CFR', 'Cost and Freight'],
  ['CIF', 'Cost, Insurance and Freight'],
  ['CPT', 'Carriage Paid To'],
  ['CIP', 'Carriage and Insurance Paid To'],
  ['DPU', 'Delivered at Place Unloaded'],
  ['DAP', 'Delivered at Place'],
  ['DDP', 'Delivered Duty Paid'],
];

export const CURRENCIES: Array<[string, string]> = [
  ['EUR', 'Евро'],
  ['USD', 'Щатски долар'],
  ['BGN', 'Български лев'],
  ['GBP', 'Британска лира'],
  ['CNY', 'Китайски юан'],
  ['CHF', 'Швейцарски франк'],
  ['TRY', 'Турска лира'],
  ['RSD', 'Сръбски динар'],
  ['RON', 'Румънска лея'],
  ['MKD', 'Македонски денар'],
  ['JPY', 'Японска йена'],
  ['AED', 'Дирхам ОАЕ'],
];

// Вид сделка (Наредба за KД — поле 1 ДЕХЕА): двузначни кодове 01–11.
export const DEAL_TYPES: Array<[string, string]> = [
  ['01', 'продажба'],
  ['02', 'насрещна продажба'],
  ['03', 'лизинг'],
  ['04', 'усъвършенстване/обработка'],
  ['05', 'ремонт'],
  ['06', 'временен внос/износ'],
  ['07', 'съвместни проекти'],
  ['08', 'доставки на строителни материали'],
  ['09', 'други непреки сделки'],
  ['10', 'безплатни доставки'],
  ['11', 'крайна покупко-продажба'],
];

const ISO2 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';
export const COUNTRIES: Array<[string, string]> = ISO2.split(' ').map(
  (c) => [c, c] as [string, string],
);

export type ComboOptions = Array<[string, string]>;
