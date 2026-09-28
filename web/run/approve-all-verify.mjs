const H = 'http://127.0.0.1:48913';
let cookie = '';
const call = async (ep, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(H + ep, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('declgen_sess=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
console.log('login:', (await call('/__auth/login', { name: 'Тест Жребец u8jw', password: 'tajna123' })).j?.ok);
let st = (await call('/api/state')).j;
let cls = (await call('/api/classification')).j;
console.log('before: pending =', (cls.rows || []).filter(r => !r.approved).length, '/', (cls.rows || []).length, '| rev', st.case_revision);
// stale-guard must reject wrong revision
console.log('stale guard:', JSON.stringify((await call('/api/classification/approve_all', { case_id: st.case_id, base_revision: 999 })).j).slice(0, 110));
// real one
console.log('approve_all:', JSON.stringify((await call('/api/classification/approve_all', { case_id: st.case_id, base_revision: st.case_revision })).j));
cls = (await call('/api/classification')).j;
console.log('after: pending =', (cls.rows || []).filter(r => !r.approved).length, '/', (cls.rows || []).length);
st = (await call('/api/state')).j;
console.log('rebuild …');
const b = await call('/api/build', { case_id: st.case_id, base_revision: st.case_revision });
console.log('build ok:', b.j?.ok, b.j?.error || '');
const dash = (await call('/api/dashboard')).j;
console.log('blockers now:', JSON.stringify(dash.j?.dashboard?.blockers || []));
console.log('stage:', ((await call('/api/state')).j?.stage));
