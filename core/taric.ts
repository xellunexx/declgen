export const BASE='https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp';
export const UK_API='https://www.trade-tariff.service.gov.uk/uk/api';
export class TaricError extends Error{}
function ymd(d:Date){return d.toISOString().slice(0,10).replaceAll('-','')} function dmy(d:Date){const s=d.toISOString().slice(0,10);return `${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}`}
export function consultationUrl(text:string,on=new Date(),lang='en',descrLang='en'){const p=new URLSearchParams({Lang:lang,SimDate:ymd(on),GoodsText:text,textSearch:text,search_text:'goods',LangDescr:descrLang,DatePicker:dmy(on),Area:'',MeasType:'',StartPub:'',EndPub:'',MeasText:'',op:'',Taric:'',AdditionalCode:'',OrderNum:'',Regulation:'',measStartDat:'',measEndDat:''});return `${BASE}?${p}`;}
export async function fetchSearchHtml(text:string,on=new Date(),timeout=25000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(consultationUrl(text,on),{headers:{'user-agent':'Mozilla/5.0 declgen/taric'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}catch(e){throw new TaricError(`TARIC fetch failed: ${e}`)}finally{clearTimeout(t)}}
const RE=/>?\s*(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s*(?:<[^>]*>\s*){1,4}([^<]{3,160})/gs;
export function parseCandidates(html:string){const out:any[]=[],seen=new Set<string>();for(const m of html.matchAll(RE)){const code=m.slice(1,5).join('');const ch=Number(code.slice(0,2));if(ch<1||ch>97||code.slice(2,4)==='00')continue;const desc=String(m[5]||'').trim().replace(/\s+/g,' ');if(desc&&!seen.has(code)){seen.add(code);out.push({code,desc})}}return out;}

// Fallback: UK Trade Tariff public JSON API — same WCO HS6 + 8-digit CN alignment as EU TARIC.
async function ukJson(path:string,timeout=25000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(UK_API+path,{headers:{'user-agent':'declgen/taric'},signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t)}}
async function ukCandidates(text:string){const j=await ukJson('/search?q='+encodeURIComponent(text));const d=j?.data;let list:any[]=[];
  if(d&&d.type==='exact_search'&&d.attributes?.entry?.endpoint==='headings'){const h=await ukJson('/headings/'+encodeURIComponent(d.attributes.entry.id));list=(h?.included||[]).filter((x:any)=>x.type==='commodity');}
  else if(Array.isArray(d))list=d.map((x:any)=>x?.attributes?.reference?{attributes:{goods_nomenclature_item_id:x.attributes.reference.goods_nomenclature_item_id,description:x.attributes.reference.description}}:x);
  const seen=new Set<string>(),out:any[]=[];
  for(const x of list){const code=String(x?.attributes?.goods_nomenclature_item_id||'').replace(/\D/g,'');const desc=String(x?.attributes?.description||'').replace(/\s+/g,' ').trim();if(code.length===10&&!seen.has(code)&&desc){seen.add(code);out.push({code,desc,source:'UK Trade Tariff (WCO-изравнен)'})}}
  return out;}

export const split10=(code:string)=>({hs6:code.slice(0,6),cn:code.slice(6,8),taric:code.slice(8,10)});
export function autoPick(candidates:any[],invoiceHs=''){const want=invoiceHs.replace(/\D/g,'');if(want){for(const c of candidates||[])if(String(c.code).startsWith(want)||want.startsWith(String(c.code).slice(0,want.length)))return c;}return (candidates||[]).length===1?candidates[0]:null;}

export async function searchCandidates(text:string, invoiceHs=''){
  let candidates:any[]=[];
  try{candidates=parseCandidates(await fetchSearchHtml(text));}catch{/* EU shell is JS-driven; fall through to UK */}
  if(!candidates.length)candidates=await ukCandidates(text);
  const picked=autoPick(candidates,invoiceHs);
  return picked?[picked,...candidates.filter(c=>c.code!==picked.code)]:candidates;
}
