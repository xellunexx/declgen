// Isolation proof: fresh accounts must see BLANK case state, per-account restore must work,
// and no account may ever see another account's case. Run: node web/run/iso-verify.mjs
const BASE = 'http://127.0.0.1:48913';
const jar = new Map(); // name -> cookie
const cookieOf = (name) => jar.get(name) || '';

async function call(name, method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookieOf(name) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const sc = r.headers.get('set-cookie');
  if (sc) { const m = sc.match(/declgen_sess=([^;]+)/); if (m) jar.set(name, 'declgen_sess=' + m[1]); }
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, extra); } };

const A = 'ProbeA' + Date.now() % 100000;
const B = 'ProbeB' + Date.now() % 100000;

let r = await call(A, 'POST', '/__auth/register', { name: A, password: 'probe-pass-1' });
ok(r.j?.ok === true, 'register A', JSON.stringify(r.j));
r = await call(B, 'POST', '/__auth/register', { name: B, password: 'probe-pass-2' });
ok(r.j?.ok === true, 'register B', JSON.stringify(r.j));

// 1+2. Fresh accounts see blank state: no inovativa, no OVBP, no revived case in the live log.
r = await call(A, 'GET', '/api/state');
const sa = JSON.stringify(r.j || {});
ok(r.status === 200 && !sa.includes('inovativa') && !sa.includes('OVBP'), 'A state is blank (no inovativa pollution)');
r = await call(A, 'GET', '/api/logs');
ok(!JSON.stringify(r.j || {}).includes('inovativa'), 'A live log clean');
r = await call(A, 'GET', '/api/history');
ok(r.j?.ok === true && (r.j.items || []).length === 0, 'A history empty');

// 3. A does real work: select known client evelin29.
r = await call(A, 'POST', '/api/clients/select', { client_id: 'evelin29', direction: 'IM' });
ok(r.j?.ok === true, 'A selects evelin29', JSON.stringify(r.j));
r = await call(A, 'GET', '/api/state');
ok(r.j?.client_id === 'evelin29', 'A state = evelin29');

// 4. B still blank, must not see A's client.
r = await call(B, 'GET', '/api/state');
ok(r.status === 200 && r.j?.client_id !== 'evelin29' && !JSON.stringify(r.j || {}).includes('evelin29'), 'B unaffected by A (still blank)');

// 5. A re-login minutes later => continuity restore (crash/restart window, ≤45min).
jar.delete(A);
r = await call(A, 'POST', '/__auth/login', { name: A, password: 'probe-pass-1' });
ok(r.j?.ok === true, 'A re-login');
r = await call(A, 'GET', '/api/state');
ok(r.j?.client_id === 'evelin29', 'A own in-flight work restored within 45-min continuity window');

// 5b. Page (re)load with stale (2h-old) file => clean bench (no pollution).
const fs = await import('node:fs');
const me = JSON.parse(fs.readFileSync('declgen-data/auth/users.json', 'utf8')).find((u) => u.name === A);
const f = `declgen-data/active-case.${me.id}.json`;
const old = new Date(Date.now() - 2 * 3600 * 1000);
fs.utimesSync(f, old, old);
let rB = await call(A, 'GET', '/api/state?boot=1');
ok(rB.status === 200 && rB.j?.client_id !== 'evelin29', 'page reload with stale (2h-old) work = clean bench (no pollution)');

// 5c. Continuous-tab bind (no boot flag, e.g. after a server restart under an open tab) restores
// own work at ANY file age — this is the crash-continuity path, it is not pollution.
let rC = await call(B, 'GET', '/api/state'); // move owner to B
rC = await call(A, 'GET', '/api/state');
ok(rC.j?.client_id === 'evelin29', 'server-restart continuity: open-tab rebind restores own work at any age');

// 6. Unauthenticated gate still intact.
jar.delete('anon');
r = await call('anon', 'GET', '/api/state');
ok(r.status === 401, 'unauth /api/state => 401');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
