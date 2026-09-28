// Native-picker host-gate proof: tunnel hostname must now behave like loopback.
// PASS criteria: bogus Host = instant 'native-unavailable'; tunnel Host = enters dialog branch
// (request hangs waiting on the Windows dialog) -> we abort; 2nd request then hits the
// already-open guard message, which only exists INSIDE the allowed branch.
import http from 'node:http';
import fs from 'node:fs';

const BASE = '127.0.0.1:48913';
const DATA = process.env.DECLGEN_DATA_ROOT || `${(await import('node:os')).homedir()}/.declgen-data`;
const wan = JSON.parse(fs.readFileSync(`${DATA}/wan.json`, 'utf8'));
const TUNNEL_HOST = new URL(wan.url).host;

const login = await fetch(`http://${BASE}/__auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'NativeProbe' + Date.now() % 100000, password: 'probe-pass-9' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie.startsWith('declgen_sess=')) { console.log('FAIL no session'); process.exit(1); }

function selectViaHost(host, abortMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request({
      host: '127.0.0.1', port: 48913, path: '/__native/select', method: 'POST',
      headers: { 'content-type': 'application/json', cookie, host },
    }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ ms: Date.now() - t0, body: b }));
    });
    req.on('error', () => resolve({ ms: Date.now() - t0, body: '__aborted__' }));
    req.end(JSON.stringify({ mode: 'files' }));
    setTimeout(() => { req.destroy(); }, abortMs);
  });
}

let pass = 0, fail = 0;
const ok = (c, l, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, x); };

// 1. Bogus host still refused, instantly.
let r = await selectViaHost('evil.example.com', 5000);
ok(r.body.includes('native-unavailable') && r.ms < 3000, 'bogus host refused instantly', `${r.ms}ms ${r.body}`);

// 2. Tunnel hostname enters the dialog branch (hangs -> we abort after 4s).
r = await selectViaHost(TUNNEL_HOST, 4000);
ok(r.body === '__aborted__', 'tunnel host accepted (dialog branch entered, no instant refusal)', `${r.ms}ms`);

// 3. While that dialog is open, a loopback request hits the already-open guard (= allowed path).
r = await selectViaHost('127.0.0.1:48913', 8000);
ok(r.body.includes('Вече има отворен прозорец'), 'already-open guard reached via loopback', r.body.slice(0, 120));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
