const H = 'http://127.0.0.1:48913';
let cookie = '';
const call = async (ep, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(H + ep, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('declgen_sess=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

log('login:', (await call('/__auth/login', { name: 'Тест Жребец u8jw', password: 'tajna123' })).j?.ok);
log('select:', JSON.stringify((await call('/api/clients/select', { client_id: 'inovativa', direction: 'IM' })).j));
log('upload:', JSON.stringify((await call('/api/dossier/upload', { paths: ['C:\\Users\\ochak\\Downloads\\fw\\ORVIBO-INVOICE-OVBP20260320001BGA.pdf', 'C:\\Users\\ochak\\Downloads\\fw\\PL-OVBP20260320001BGA-SYNTHETIC.pdf'] })).j));
const ex = await call('/api/dossier/extract', {});
log('extract ok:', ex.j?.ok, ex.j?.error || '');
let st = (await call('/api/state')).j;
log('invoice:', st.invoice?.invoice_number, 'lines:', st.invoice?.lines?.length, 'rev:', st.case_revision);
let b = await call('/api/build', { case_id: st.case_id, base_revision: st.case_revision });
log('build#1:', b.j?.ok, b.j?.error || '');
st = (await call('/api/state')).j;
const cls = (await call('/api/classification')).j;
const clsRows = cls.j?.rows || cls.rows || [];
log('pending before:', clsRows.filter((r) => !r.approved).length, '/', clsRows.length);
const ap = await call('/api/classification/approve_all', { case_id: st.case_id, base_revision: st.case_revision });
log('approve_all:', JSON.stringify(ap.j));
const cls2 = (await call('/api/classification')).j;
const rows2 = cls2.j?.rows || cls2.rows || [];
log('pending after:', rows2.filter((r) => !r.approved).length, '/', rows2.length);
st = (await call('/api/state')).j;
b = await call('/api/build', { case_id: st.case_id, base_revision: st.case_revision });
log('build#2:', b.j?.ok, b.j?.error || '');
const dash = (await call('/api/dashboard')).j;
log('blockers:', JSON.stringify(dash.j?.dashboard?.blockers || dash.blockers || []));
log('stage:', (await call('/api/state')).j?.stage);
