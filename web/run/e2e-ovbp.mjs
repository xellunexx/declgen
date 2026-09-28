const H = 'http://127.0.0.1:48913';
const post = async (ep, body, ms) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), ms);
  try { const r = await fetch(H + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); return await r.json(); }
  finally { clearTimeout(t); }
};
const get = async (ep) => (await fetch(H + ep)).json();

// pick the real pair the user flagged
const up = await post('/api/dossier/upload', { paths: [
  'C:\\Users\\ochak\\Downloads\\fw\\ORVIBO-INVOICE-OVBP20260320001BGA.pdf',
  'C:\\Users\\ochak\\Downloads\\fw\\PL-OVBP20260320001BGA-SYNTHETIC.pdf',
] }, 30000);
console.log('upload:', JSON.stringify(up));

const ex = await post('/api/dossier/extract', {}, 300000);
console.log('extract ok:', ex.ok, ex.error || '');

const st = await get('/api/state');
const doses = Object.entries(st.dossier || {}).map(([k, v]) => `${k.split(/[\\/]/).pop()} → ${v.type} (${v.confidence ?? '-'})`);
console.log('dossier:', doses);
console.log('invoice lines:', st.invoice?.lines?.length, '| invoice no:', st.invoice?.invoice_number);
const pkg = st.packing || {};
console.log('packing lines:', pkg.lines?.length, '| net_total:', pkg.total_net_weight_kg, '| gross:', pkg.total_gross_weight_kg);
const warns = (pkg._warnings || []).filter(w => !w.startsWith('deterministic'));
console.log('packing warnings:', JSON.stringify(warns));
const dash = await get('/api/dashboard');
const blockers = dash.dashboard?.blockers || dash.blockers || [];
console.log('blockers:', JSON.stringify(blockers));
