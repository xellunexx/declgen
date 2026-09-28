const H = 'http://127.0.0.1:48913';
let cookie = '';
const call = async (ep, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(H + ep, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('declgen_sess=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  if (sc && sc.includes('Max-Age=0')) cookie = '';
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, redirect: r.headers.get('location') };
};

// login as the test account from before (Cyrillic name)
console.log('1 login:', JSON.stringify(await call('/__auth/login', { name: 'Тест Жребец u8jw', password: 'tajna123' })).slice(0, 120));

// save current case (inovativa / OVBP…) to history
console.log('2 save:', JSON.stringify(await call('/api/history/save', {})));

// list
const list = await call('/api/history');
console.log('3 list:', JSON.stringify(list.j).slice(0, 300));

// detail of newest
const id = list.j?.items?.[0]?.id;
if (id) {
  const det = await call('/api/history/item?id=' + id);
  const it = det.j?.item;
  console.log('4 detail:', JSON.stringify({ id: it?.id, inv: it?.invoice_number, client: it?.client_id, files: it?.files, totals: it?.totals, items: (it?.items || []).map(g => g.hs_code).slice(0, 5), xml_len: (it?.xml || '').length }).slice(0, 400));
}

// second account must NOT see it
console.log('5 other-user register:', JSON.stringify(await call('/__auth/register', { name: 'Chujakov Test', password: 'tajna123' })).slice(0, 120));
const list2 = await call('/api/history');
console.log('6 other-user list (must be empty):', JSON.stringify(list2.j));
console.log('7 other-user item fetch (must fail):', JSON.stringify(await call('/api/history/item?id=' + id)));
