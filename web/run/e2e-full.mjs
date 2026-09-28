const H = 'http://127.0.0.1:48913';
const post = async (ep, body, ms) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), ms);
  try { const r = await fetch(H + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); return await r.json(); }
  finally { clearTimeout(t); }
};
const get = async (ep) => (await fetch(H + ep)).json();

console.log('select:', JSON.stringify(await post('/api/clients/select', { client_id: 'inovativa', direction: 'IM' }, 15000)));
console.log('upload:', JSON.stringify(await post('/api/dossier/upload', { paths: [
  'C:\\Users\\ochak\\Downloads\\fw\\ORVIBO-INVOICE-OVBP20260320001BGA.pdf',
  'C:\\Users\\ochak\\Downloads\\fw\\PL-OVBP20260320001BGA-SYNTHETIC.pdf',
] }, 30000)));
const ex = await post('/api/dossier/extract', {}, 420000);
console.log('extract ok:', ex.ok, ex.error || '');
const st = await get('/api/state');
console.log('invoice:', st.invoice?.invoice_number, 'lines:', st.invoice?.lines?.length, '| client:', st.client_id, '| rev:', st.case_revision);
const cls = await get('/api/classification');
console.log('classification rows:', (cls.rows || []).length);
const b = await post('/api/build', { case_id: st.case_id, base_revision: st.case_revision }, 600000);
console.log('build ok:', b.ok, '| error:', b.error || '(none)');
if (b.ok) {
  const st2 = await get('/api/state');
  const items = st2.decl?.GOODSSHIPMENT?.GOODITEM || [];
  console.log('items:', items.length, '| DECHEA total:', st2.decl?.DECHEA?.TotalAmountInvoiced, st2.decl?.DECHEA?.InvoiceCurrency, '| gross:', st2.decl?.DECHEA?.TotalGrossMassKg, '| LRN:', st2.decl?.DECHEA?.Lrn);
  const zeroStats = items.filter(it => Number(it?.Commodity?.StatisticalValue) <= 0.001).length;
  const missingNet = items.filter(it => !it?.Commodity?.GOODSMEASURE?.NetMassKg || Number(it.Commodity.GOODSMEASURE.NetMassKg) <= 0).length;
  console.log('zeroed stat values:', zeroStats, '| missing net kg:', missingNet);
  console.log('item[0]:', JSON.stringify({ no: items[0]?.GoodsItemNo, net: items[0]?.Commodity?.GOODSMEASURE?.NetMassKg, stat: items[0]?.Commodity?.StatisticalValue, price: items[0]?.Commodity?.ItemPrice }));
  const dash = await get('/api/dashboard');
  console.log('blockers:', JSON.stringify(dash.dashboard?.blockers || []));
  console.log('warnings:', JSON.stringify((dash.dashboard?.warnings || []).slice(0, 6)));
}
