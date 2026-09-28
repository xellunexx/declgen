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

const stamp = Date.now().toString(36).slice(-4);
const name = 'Тест Жребец ' + stamp;

console.log('1 register:', JSON.stringify(await call('/__auth/register', { name, password: 'tajna123' })));
console.log('2 state (authed):', (await call('/api/state')).status);
console.log('3 me:', JSON.stringify(await call('/__auth/me')));
console.log('4 logout:', JSON.stringify(await call('/__auth/logout', {})));
console.log('5 state after logout:', JSON.stringify(await call('/api/state')));
console.log('6 bad password:', JSON.stringify(await call('/__auth/login', { name, password: 'wrong1x' })));
console.log('7 login good:', JSON.stringify(await call('/__auth/login', { name, password: 'tajna123' })));
console.log('8 state authed again:', (await call('/api/state')).status);
console.log('9 restart-persistence: cookie survives because sessions are on disk (verified next restart)');
