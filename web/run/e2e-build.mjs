const H = 'http://127.0.0.1:48913';
const post = async (ep, body, ms) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), ms);
  try { const r = await fetch(H + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); return await r.json(); }
  finally { clearTimeout(t); }
};
const get = async (ep) => (await fetch(H + ep)).json();

const st = await get('/api/state');
console.log('client:', st.client_id ?? st.clientId, '| direction:', st.direction);

// classification first (needed before build)
const cls = await get('/api/classification');
console.log('classification rows:', (cls.rows || []).length, '| needs review:', (cls.rows || []).filter(r => r.state !== 'confirmed').length);

const b = await post('/api/build', { case_id: st.case_id, base_revision: st.case_revision }, 600000);
console.log('build ok:', b.ok, '| error:', b.error || '(none)');
if (b.ok) {
  const st2 = await get('/api/state');
  const items = st2.decl?.GOODSSHIPMENT?.GOODITEM || [];
  console.log('items:', items.length);
  console.log('item[1] net:', items[0]?.Commodity?.GOODSMEASURE?.NetMassKg, '| stat:', items[0]?.Commodity?.StatisticalValue, '| price:', items[0]?.Commodity?.ItemPrice);
  console.log('item[4] net:', items[4]?.Commodity?.GOODSMEASURE?.NetMassKg);
  console.log('TotalAmountInvoiced:', st2.decl?.DECHEA?.TotalAmountInvoiced, '| TotalGrossMassKg:', st2.decl?.DECHEA?.TotalGrossMassKg);
  const zeroStats = items.filter(it => Number(it?.Commodity?.StatisticalValue) <= 0.001).length;
  const missingNet = items.filter(it => !it?.Commodity?.GOODSMEASURE?.NetMassKg || Number(it.Commodity.GOODSMEASURE.NetMassKg) <= 0).length;
  console.log('items with zeroed stat value:', zeroStats, '| items missing net kg:', missingNet);
  const dash = await get('/api/dashboard');
  console.log('blockers now:', JSON.stringify(dash.dashboard?.blockers || []));
  console.log('warnings now:', JSON.stringify(dash.dashboard?.warnings || []));
}
