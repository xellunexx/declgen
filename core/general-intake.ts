import { Catalog } from './catalog.js';

export const NEW_CLIENT_LABEL = 'Нова фирма / неизвестен вносител';
export const NEW_CLIENT_ID = 'draft-new-importer';
export const PLACEHOLDER_IMPORTER_EORI = 'BGC000000000ZZZZ0';
export const PLACEHOLDER_REPRESENTATIVE_EORI = 'BGA000000000ZZZZ0';
export const PLACEHOLDER_HS10 = '9999990000';
export const PLACEHOLDER_OFFICE = 'BG005100';
export const PLACEHOLDER_LOCATION = 'ДАННИ ОТ ПОДАТЕЛЯ';
const EORI_RE = /^BG[A-Z]\d{9}ZZZZ\d$/;
const LRN_RE = /^\d{17}H\d{6}$|^\d{15}H\d{6}$/;
const HS10_RE = /^\d{10}$/;
export const INCOTERMS_ANY_MODE = new Set(['EXW','FCA','CPT','CIP','DAP','DPU','DDP']);
export const INCOTERMS_SEA_ONLY = new Set(['FAS','FOB','CFR','CIF']);
export const INCOTERMS_2020 = new Set([...INCOTERMS_ANY_MODE, ...INCOTERMS_SEA_ONLY]);
const SEA_MODES = new Set(['1','8']);

export const isNewClient = (v: unknown) => String(v ?? '').trim() === NEW_CLIENT_LABEL;
export function clientIdFromEori(eori: unknown): string { const s = String(eori ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ''); return s || NEW_CLIENT_ID; }
export function generatedLrn(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2);
  return `${yy}${'0'.repeat(15)}H000001`;
}
function country(v: unknown, fallback='CN'): string { const s=String(v??'').trim().toUpperCase(); return /^[A-Z]{2}$/.test(s)?s:fallback; }
export function normalizeHs10(code: unknown): string | null { const d=String(code??'').replace(/\D/g,''); if(d.length===10)return d; if(d.length>=6&&d.length<10)return d.padEnd(10,'0'); return null; }

export function defaults(invoice: any, _packing?: any, now=new Date()): any {
  const seller=invoice?.seller||{}, buyer=invoice?.buyer||{};
  let term=String(invoice?.price_term||'CIP').toUpperCase(); if(!/^[A-Z]{3}$/.test(term))term='CIP';
  const dispatch=country(seller.country,'CN'), destination=country(buyer.country,'BG');
  const modes:Record<string,string>={air:'4',road:'3',rail:'2',sea:'1',post:'5'};
  const mode=modes[String(invoice?.transport_mode||'').toLowerCase()]||'4';
  const goods_hs:Record<string,string>={};
  (invoice?.lines||[]).forEach((line:any,i:number)=>{const no=String(line.no||i+1);goods_hs[no]=normalizeHs10(line.hs_code)||PLACEHOLDER_HS10});
  return {
    lrn:generatedLrn(now), declarant_eori:PLACEHOLDER_IMPORTER_EORI, importer_eori:PLACEHOLDER_IMPORTER_EORI,
    representative_eori:PLACEHOLDER_REPRESENTATIVE_EORI, representative_status:'2', lodging_office:PLACEHOLDER_OFFICE,
    nature_of_transaction:'11', border_nationality:dispatch, border_mode:mode, inland_mode:/^[1-9]$/.test(mode)?mode:'3',
    container_indicator:mode==='1'?'1':'0', arrival_id:PLACEHOLDER_LOCATION, arrival_code:'30', dispatch, destination,
    incoterm:term, terms_country:['C','D'].includes(term[0])?destination:dispatch,
    terms_location:String(invoice?.price_term_place||PLACEHOLDER_LOCATION), loc_type:'D', loc_qualifier:'Z',
    loc_city:String(buyer.city||'SOFIA'), loc_country:destination, loc_street:String(buyer.address||PLACEHOLDER_LOCATION),
    loc_postcode:String(buyer.postcode||'1000'), exchange_rate:String(invoice?.currency||'').toUpperCase()==='EUR'?'1.0000':'0.8604',
    exchange_rate_date:String(invoice?.invoice_date||now.toISOString().slice(0,10)), transport_document_type:'N740', transport_reference:'',
    route_confirmed:'0', mrn:'', mrn_status:'MRN се присвоява от митницата след приемане; не се попълва за нова декларация.', goods_hs,
  };
}
function merge(base:any, values:any):any { const out=structuredClone(base); for(const [k,v] of Object.entries(values||{})){if(k==='goods_hs'&&v&&typeof v==='object')Object.assign(out.goods_hs,Object.fromEntries(Object.entries(v as any).map(([a,b])=>[String(a),String(b??'').trim()])));else if(v!==null&&v!==undefined)out[k]=String(v).trim()}return out; }
export function validate(values:any, invoice:any):string[]{
  const errors:string[]=[];
  for(const [k,l] of [['declarant_eori','EORI на декларатор'],['importer_eori','EORI на вносител'],['representative_eori','EORI на представител']] as const)if(!EORI_RE.test(String(values?.[k]||'')))errors.push(`${l}: нужен е формат BGC/BGA + 9 цифри + ZZZZ + цифра`);
  if(!LRN_RE.test(String(values?.lrn||'')))errors.push('LRN: нужен е локален референтен номер с 17 (или 15) цифри, H и 6 цифри');
  if(!/^BG\d{6}$/.test(String(values?.lodging_office||'')))errors.push('Митническо учреждение: нужен е код BG + 6 цифри');
  const inc=String(values?.incoterm||'').toUpperCase(); if(!INCOTERMS_2020.has(inc))errors.push('Incoterm: изберете валиден Incoterms® 2020 код'); else if(INCOTERMS_SEA_ONLY.has(inc)&&!SEA_MODES.has(String(values?.border_mode||'')))errors.push(`Incoterm ${inc}: разрешен е само при морски или вътрешен воден транспорт`);
  for(const [k,l] of [['border_nationality','Националност на границата'],['dispatch','Държава на изпращане'],['destination','Държава на получаване'],['loc_country','Държава на място на стоките']] as const)if(!/^[A-Z]{2}$/.test(String(values?.[k]||'')))errors.push(`${l}: нужен е двубуквен ISO код`);
  for(const [k,l] of [['border_mode','Вид транспорт на границата'],['inland_mode','Вътрешен транспорт']] as const)if(!/^[1-9]$/.test(String(values?.[k]||'')))errors.push(`${l}: нужен е код 1-9`);
  if(!['0','1'].includes(String(values?.container_indicator||'')))errors.push('Контейнер: изберете 0 или 1');
  (invoice?.lines||[]).forEach((line:any,i:number)=>{const key=String(line.no||i+1),v=values?.goods_hs?.[key]??values?.goods_hs?.[String(i+1)];if(!HS10_RE.test(String(v||'')))errors.push(`Стока ред ${key}: нужен е 10-цифрен HS/CN/TARIC код`)});
  return errors;
}

export function build(invoice:any, packing:any=null, submitted:any=null, now=new Date()):{template:any;catalog:Catalog;extras:any;audit:any;values:any}{
  const values=merge(defaults(invoice,packing,now),submitted); const errors=validate(values,invoice); if(errors.length)throw new Error(errors.join('\n'));
  const placeholder_fields:string[]=[];
  for(const [f,s] of [['declarant_eori',PLACEHOLDER_IMPORTER_EORI],['importer_eori',PLACEHOLDER_IMPORTER_EORI],['representative_eori',PLACEHOLDER_REPRESENTATIVE_EORI],['arrival_id',PLACEHOLDER_LOCATION],['loc_street',PLACEHOLDER_LOCATION]])if(String(values[f]||'')===s)placeholder_fields.push(f);
  if(String(values.route_confirmed||'')!=='1')placeholder_fields.push('route_confirmation');
  const entries=(invoice?.lines||[]).map((line:any,i:number)=>{const no=String(line.no||i+1),code=String(values.goods_hs?.[no]||values.goods_hs?.[String(i+1)]||PLACEHOLDER_HS10),ph=code===PLACEHOLDER_HS10;if(ph)placeholder_fields.push(`goods_hs.${no}`);const extracted=normalizeHs10(line.hs_code);const source=ph?'placeholder_user_input':(extracted&&code===extracted?'invoice_code_fallback':'human_verified');return {key:`draft:${invoice?.invoice_number||'invoice'}:${no}`,aliases:[String(line.description||'')],bg_name:String(line.description||'Стока от фактура'),hs:{hs6:code.slice(0,6),cn:code.slice(6,8),taric:code.slice(8,10)},origin:country(line.origin,country(invoice?.seller?.country)),source,placeholder:ph}});
  const context={declaration_code:'H1',declaration_type:'IM',add_declaration_type:'A',lodging_office:values.lodging_office,nature_of_transaction:values.nature_of_transaction,border_transport:{nationality:values.border_nationality,mode:values.border_mode},inland_mode:values.inland_mode,container_indicator:values.container_indicator,arrival_transport:{IdeOfMeaOfTraAtArrival:values.arrival_id,IdeOfMeaOfTraAtArrivalCode:values.arrival_code},country_of_dispatch:values.dispatch,destination_country:values.destination,delivery_terms:{incotermCode:values.incoterm,country:values.terms_country,location:values.terms_location},location_of_goods:{typeOfLocation:values.loc_type,qualifierOfIdentification:values.loc_qualifier,ADDRESS:{City:values.loc_city,Country:values.loc_country,StreetAndNumber:values.loc_street,Postcode:values.loc_postcode}}};
  const template={client_id:NEW_CLIENT_ID,capabilities:['IM'],generic_intake:true,sender_code:values.representative_eori,recipient:'MISV.BG',recipient_code:'BG005100',representative:{tin:values.representative_eori,status:values.representative_status},declarant_tin:values.declarant_eori,importer_tin:values.importer_eori,lodging_office:values.lodging_office,defaults:{declaration_code:'H1',declaration_type:'IM',add_declaration_type:'A',nature_of_transaction:values.nature_of_transaction,mode_of_trans_at_border:values.border_mode,nat_of_means:values.border_nationality,container_ind:values.container_indicator,inland_mode:values.inland_mode},location_of_goods:context.location_of_goods,declaration_profile:context,goods_hints:[],notes:['Draft new-importer intake; export blocked while placeholders remain.']};
  const extras:any={lrn:values.lrn,exchange_rate:values.exchange_rate,exchange_rate_date:values.exchange_rate_date,declaration_context:context,shipping_marks:invoice?.invoice_number||'DRAFT',package_type:'CT'};
  if(values.transport_reference)extras.transport_documents=[{type:values.transport_document_type,referenceNumber:values.transport_reference}];
  const audit={mode:'new_importer_intake',mrn:null,mrn_note:values.mrn_status,placeholder_fields:[...new Set(placeholder_fields)].sort(),submitted_fields:Object.keys(values).filter(k=>!['goods_hs','mrn','mrn_status'].includes(k)).sort(),values};
  return {template,catalog:new Catalog(entries),extras,audit,values};
}
