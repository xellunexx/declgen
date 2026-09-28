const H = 'http://127.0.0.1:48913';
const post = async (ep, body, ms = 60000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(H + ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(t); }
};
const P = 'C:\\Users\\ochak\\Downloads\\инв (1).pdf';

console.log('1. quoted FILE -> select_folder:', JSON.stringify(await post('/api/dossier/select_folder', { path: '"' + P + '"' })));
console.log('2. quoted real path -> upload:', JSON.stringify(await post('/api/dossier/upload', { paths: ['"' + P + '"'] })));
console.log('3. bogus path -> upload:', JSON.stringify(await post('/api/dossier/upload', { paths: ['C:\\no\\such\\file.pdf'] })));
const st = await (await fetch(H + '/api/state')).json();
console.log('4. dossier keys:', JSON.stringify(Object.keys(st.dossier || {})), '| wan:', st.wan_url, '| wan_status:', st.wan_status);
if (st.dossier && st.dossier['инв (1).pdf']) {
  const ex = await post('/api/dossier/extract', {}, 180000);
  console.log('5. extract:', JSON.stringify({ ok: ex.ok, error: ex.error || null, invoice: ex.invoice ? 'parsed' : null }));
  const st2 = await (await fetch(H + '/api/state')).json();
  console.log('6. dossier after extract:', JSON.stringify(st2.dossier?.['инв (1).pdf']));
}
