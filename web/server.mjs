// declgen standalone web server — wraps the embedded DeclgenService over HTTP.
// Binds 127.0.0.1 only. The Electron app remains the primary runtime; this is a
// same-machine browser surface (native pickers degrade to typed paths).
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.DECLGEN_WEB_PORT || 48913);
const HOST = process.env.DECLGEN_WEB_HOST || '127.0.0.1';

const { DeclgenService } = await import(pathToFileURL(path.join(ROOT, 'dist-electron', 'electron', 'backend', 'declgen-service.js')).href);
const { dataRoot } = await import(pathToFileURL(path.join(ROOT, 'dist-electron', 'core', 'paths.js')).href);

const service = new DeclgenService();
await service.init();
// Accounts gate ON ⇒ case state is owned per account, never the shared boot case.
// Boot unbinds the service from 'local'; the first request binds the requesting account (web/server.mjs gate -> switchUser).
if (process.env.DECLGEN_AUTH !== 'off') service._owner = null;
// Serialize swap+request so two accounts never interleave case state.
let opChain = Promise.resolve();
const queued = (fn) => { const r = opChain.then(fn); opChain = r.catch(() => {}); return r; };

// Module: accounts gate (owns declgen-data/auth/*). Declgen_AUTH=off detaches it.
const auth = await import(pathToFileURL(path.join(ROOT, 'web', 'auth.mjs')).href);
auth.initAuth(dataRoot());
const AUTH_ENABLED = process.env.DECLGEN_AUTH !== 'off';

// Module: case history (owns declgen-data/history/*).
const history = await import(pathToFileURL(path.join(ROOT, 'web', 'history.mjs')).href);
history.initHistory(dataRoot());

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const cookieFlags = (req) => `HttpOnly; SameSite=Lax; Path=/${isLocalRequest(req) ? '' : '; Secure'}`;
const sessCookie = (req, token) => `declgen_sess=${token}; ${cookieFlags(req)}; Max-Age=2592000`;
const killCookie = (req) => `declgen_sess=; ${cookieFlags(req)}; Max-Age=0`;

// Remote (tunnel) registration requires DECLGEN_INVITE_CODE; same-machine registration is always allowed.
const INVITE_CODE = String(process.env.DECLGEN_INVITE_CODE || '');
function inviteAccepted(req, body) {
  if (isLocalRequest(req)) return true;
  if (!INVITE_CODE) return false;
  const a = Buffer.from(String(body?.invite || '')), b = Buffer.from(INVITE_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
const authAttempts = new Map();
function clientKey(req) {
  return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
}
function authRateLimited(req) {
  const now = Date.now(), key = clientKey(req);
  const recent = (authAttempts.get(key) || []).filter((t) => now - t < AUTH_WINDOW_MS);
  recent.push(now);
  authAttempts.set(key, recent);
  if (authAttempts.size > 10000) for (const [k, v] of authAttempts) if (!v.some((t) => now - t < AUTH_WINDOW_MS)) authAttempts.delete(k);
  return recent.length > AUTH_MAX_ATTEMPTS;
}

async function handleAuth(req, res, url) {
  if (url.pathname === '/__auth' && req.method === 'GET') {
    const data = await fs.readFile(path.join(ROOT, 'web', 'auth.html'));
    return send(res, 200, data, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  }
  if ((url.pathname === '/__auth/register' || url.pathname === '/__auth/login') && req.method === 'POST' && authRateLimited(req)) {
    return json(res, 429, { ok: false, error: 'Твърде много опити. Опитайте отново след 10 минути.' });
  }
  if (url.pathname === '/__auth/register' && req.method === 'POST') {
    const b = await readBody(req);
    if (!inviteAccepted(req, b)) return json(res, 403, { ok: false, error: 'Регистрацията изисква валиден код за покана.' });
    const r = await auth.registerAndLogin(b);
    if (r.ok) res.setHeader('set-cookie', sessCookie(req, r.token));
    return json(res, r.ok ? 200 : 400, { ok: r.ok, error: r.error, user: r.user });
  }
  if (url.pathname === '/__auth/login' && req.method === 'POST') {
    const b = await readBody(req);
    const r = await auth.login(b);
    if (r.ok) res.setHeader('set-cookie', sessCookie(req, r.token));
    return json(res, r.ok ? 200 : 401, { ok: r.ok, error: r.error, user: r.user });
  }
  if (url.pathname === '/__auth/logout' && req.method === 'POST') {
    await auth.logout(cookies(req).declgen_sess);
    res.setHeader('set-cookie', killCookie(req));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/__auth/me' && req.method === 'GET') {
    const s = await auth.resolveSession(cookies(req).declgen_sess);
    return json(res, 200, { ok: !!s, user: s || null, auth: AUTH_ENABLED });
  }
  return json(res, 404, { ok: false, error: 'not found' });
}

const WAN_FILE = path.join(dataRoot(), 'wan.json');
async function readWan() {
  try { return JSON.parse(await fs.readFile(WAN_FILE, 'utf8')); } catch { return null; }
}

const TELEMETRY_DIR = path.join(dataRoot(), 'telemetry');
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'events.jsonl');
const TELEMETRY_MAX = 5 * 1024 * 1024;
const BROWSER_UPLOAD_MAX_FILES = 20;
const BROWSER_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;
const BROWSER_UPLOAD_MAX_REQUEST_BYTES = 100 * 1024 * 1024;
const BROWSER_UPLOAD_EXTENSIONS = new Set(['.pdf', '.csv', '.xml', '.xlsx']);
async function appendTelemetry(events) {
  await fs.mkdir(TELEMETRY_DIR, { recursive: true });
  const lines = events
    .filter((e) => e && typeof e === 'object' && typeof e.type === 'string')
    .map((e) => JSON.stringify({ ...e, srv: new Date().toISOString() }))
    .join('\n');
  if (!lines) return 0;
  await fs.appendFile(TELEMETRY_FILE, lines + '\n', 'utf8');
  try {
    const st = await fs.stat(TELEMETRY_FILE);
    if (st.size > TELEMETRY_MAX) {
      await fs.rename(TELEMETRY_FILE, TELEMETRY_FILE + '.1').catch(() => {});
    }
  } catch {}
  return lines.split('\n').length - 1;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'content-length': buf.length, ...headers });
  res.end(buf);
}
const json = (res, code, obj) => send(res, code, obj, { 'content-type': 'application/json; charset=utf-8' });

// Same-machine requests only: loopback Host and no proxy/tunnel forwarding headers.
// Native dialogs and server-filesystem/process endpoints are restricted to these.
function isLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  return !['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded'].some((h) => req.headers[h]);
}
async function nativeAllowed(req) {
  return isLocalRequest(req);
}
const LOCAL_ONLY_API = new Set([
  'POST /api/dossier/select_folder',
  'POST /api/profile_import/inspect',
  'POST /api/llm/start',
  'POST /api/llm/stop',
  'POST /api/llm/config',
  'POST /api/llm/verify',
]);
let nativeDialogActive = false;
async function nativeSelect(req, res, body) {
  if (!(await nativeAllowed(req))) {
    return json(res, 200, { ok: false, error: 'native-unavailable' });
  }
  const mode = ['files', 'folder', 'profile'].includes(body?.mode) ? body.mode : 'files';
  if (nativeDialogActive) return json(res, 200, { ok: false, error: 'Вече има отворен прозорец за избор.' });
  nativeDialogActive = true;
  const ps = spawn('powershell', ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(ROOT, 'web', 'native-dialog.ps1'), '-Mode', mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const killTimer = setTimeout(() => { try { ps.kill(); } catch {} }, 180000);
  ps.stdout.on('data', (d) => { out += d.toString('utf8'); });
  ps.stderr.on('data', (d) => { err += d.toString('utf8'); });
  ps.on('error', (e) => { clearTimeout(killTimer); nativeDialogActive = false; json(res, 200, { ok: false, error: 'native-unavailable: ' + e.message }); });
  ps.on('close', (code) => {
    clearTimeout(killTimer); nativeDialogActive = false;
    if (code !== 0) return json(res, 200, { ok: false, error: 'native-unavailable: ' + (err.trim() || 'exit ' + code).slice(0, 200) });
    const paths = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return json(res, 200, { ok: true, paths });
  });
}

const JSON_BODY_MAX_BYTES = 2 * 1024 * 1024;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > JSON_BODY_MAX_BYTES) throw new HttpError(413, 'Заявката е твърде голяма.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function safeUploadSegment(value) {
  return String(value || 'local').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'local';
}

function safeUploadName(value) {
  const name = path.basename(String(value || 'document')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return name.slice(0, 180) || 'document';
}

async function receiveBrowserUpload(req, sessionUser) {
  const contentType = String(req.headers['content-type'] || '');
  const declaredBytes = Number(req.headers['content-length'] || 0);
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new Error('Очаква се избор на файл от браузъра.');
  if (!Number.isFinite(declaredBytes) || declaredBytes <= 0 || declaredBytes > BROWSER_UPLOAD_MAX_REQUEST_BYTES) throw new Error('Качването е празно или надвишава лимита от 100 MB.');

  const webRequest = new Request('http://declgen.local/api/dossier/browser-upload', {
    method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half',
  });
  const form = await webRequest.formData();
  const files = form.getAll('files').filter((value) => value && typeof value === 'object' && typeof value.arrayBuffer === 'function');
  if (!files.length) throw new Error('Не са избрани файлове.');
  if (files.length > BROWSER_UPLOAD_MAX_FILES) throw new Error(`Изберете до ${BROWSER_UPLOAD_MAX_FILES} файла наведнъж.`);

  const userDir = safeUploadSegment(sessionUser?.user_id);
  const uploadDir = path.join(dataRoot(), 'web-uploads', userDir, crypto.randomUUID());
  const written = [];
  const usedNames = new Set();
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    for (const file of files) {
      const name = safeUploadName(file.name);
      const ext = path.extname(name).toLowerCase();
      if (!BROWSER_UPLOAD_EXTENSIONS.has(ext)) throw new Error(`Неподдържан файл: ${name}. Разрешени са PDF, CSV, XML и XLSX.`);
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > BROWSER_UPLOAD_MAX_FILE_BYTES) throw new Error(`Файлът ${name} е празен или надвишава 50 MB.`);
      if (usedNames.has(name.toLowerCase())) throw new Error(`Има два файла със същото име: ${name}. Преименувайте единия и опитайте отново.`);
      usedNames.add(name.toLowerCase());
      const target = path.join(uploadDir, name);
      await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
      written.push(target);
    }
    return written;
  } catch (error) {
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function handleApi(req, res, url, sessionUser) {
  if (LOCAL_ONLY_API.has(`${req.method} ${url.pathname}`) && !isLocalRequest(req)) {
    return json(res, 403, { ok: false, error: 'Тази операция е разрешена само от сървърната машина.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/dossier/browser-upload') {
    const files = await receiveBrowserUpload(req, sessionUser);
    return json(res, 200, await service.uploadPaths(files));
  }
  if (req.method === 'POST' && url.pathname === '/api/profile_import/browser-upload') {
    const files = await receiveBrowserUpload(req, sessionUser);
    if (files.length !== 1 || path.extname(files[0]).toLowerCase() !== '.xml') throw new Error('Изберете точно един XML файл.');
    return json(res, 200, { ok: true, result: await service.profileInspect(files[0]) });
  }
  const body = req.method === 'GET' ? {} : await readBody(req);
  const ep = url.pathname + url.search;
  try {
    // Endpoints that the Electron main process maps outside service.request():
    if (req.method === 'POST' && url.pathname === '/api/profile_import/inspect') {
      return json(res, 200, await service.profileInspect(String(body.path || '')));
    }
    if (req.method === 'POST' && url.pathname === '/api/dossier/upload') {
      if (!(await nativeAllowed(req))) return json(res, 403, { ok: false, error: 'Отдалечените документи се качват през бутона „Избери файлове…“.' });
      return json(res, 200, await service.uploadPaths(Array.isArray(body.paths) ? body.paths : []));
    }
    // History module endpoints — user-scoped, session comes from the gate (fallback 'local' when detached):
    const uid = sessionUser || { user_id: 'local', name: 'локален' };
    if (req.method === 'POST' && url.pathname === '/api/history/save') {
      try { const snap = service.historySnapshot(uid); await history.saveSnapshot(snap); return json(res, 200, { ok: true, id: snap.id }); }
      catch (e) { return json(res, 200, { ok: false, error: String(e instanceof Error ? e.message : e) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      return json(res, 200, { ok: true, items: await history.listSnapshots(uid.user_id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/history/item') {
      const snap = await history.getSnapshot(String(url.searchParams.get('id') || ''), uid.user_id);
      return json(res, 200, snap ? { ok: true, item: snap } : { ok: false, error: 'Няма такъв запис.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/wan/toggle') {
      const wan = await readWan();
      return json(res, 200, wan?.url
        ? { ok: true, wan_url: wan.url, wan_status: 'active' }
        : { ok: false, error: 'Няма активен тунел (cloudflared не е стартиран).' });
    }
    const result = await service.request(ep, req.method, body);
    if (url.pathname === '/api/state' && result && typeof result === 'object') {
      const wan = await readWan();
      if (wan?.url) { result.wan_url = wan.url; result.wan_status = 'active'; result.wan_urls = { wan: wan.url }; }
    }
    return json(res, 200, result);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleDownload(res, url) {
  try {
    let source = null;
    if (url.pathname === '/__download/case_package') source = service.casePackage;
    if (!source || !fsSync.existsSync(source)) return json(res, 404, { ok: false, error: 'Няма готов файл за изтегляне.' });
    const name = url.searchParams.get('name') || path.basename(source);
    const data = await fs.readFile(source);
    return send(res, 200, data, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error) });
  }
}

async function handleStatic(res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return json(res, 403, { ok: false, error: 'forbidden' });
  try {
    let data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      // Inject the browser shim for window.desktop before any module script runs.
      data = Buffer.from(data.toString('utf8').replace('</head>', '  <script src="/__shim.js"></script>\n  <script src="/__annotator.js"></script>\n  </head>'), 'utf8');
    }
    return send(res, 200, data, { 'content-type': MIME[ext] || 'application/octet-stream' });
  } catch {
    return json(res, 404, { ok: false, error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const reqId = crypto.randomUUID();
  res.setHeader('x-request-id', reqId);
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/__health') return json(res, 200, { ok: true, ts: Date.now() });
    if (url.pathname.startsWith('/__auth')) return await handleAuth(req, res, url);
    // ---- accounts gate: everything below requires a session unless detached ----
    let sessionUser = null;
    if (AUTH_ENABLED) {
      sessionUser = await auth.resolveSession(cookies(req).declgen_sess);
      if (!sessionUser) {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__native') || url.pathname.startsWith('/__download') || url.pathname.startsWith('/__telemetry') || url.pathname === '/__shim.js' || url.pathname === '/__annotator.js') {
          return json(res, 401, { ok: false, error: 'Изисква се вход.' });
        }
        return send(res, 302, '', { location: '/__auth' });
      }
      req.user = sessionUser;
    }
    if (url.pathname === '/__telemetry' && req.method === 'POST') {
      const body = await readBody(req);
      const events = Array.isArray(body) ? body : [];
      return json(res, 200, { ok: true, stored: await appendTelemetry(events.slice(0, 500)) });
    }
    if ((url.pathname === '/__telemetry/tail' || url.pathname === '/__telemetry/annotations') && !isLocalRequest(req)) {
      return json(res, 403, { ok: false, error: 'forbidden' });
    }
    if (url.pathname === '/__telemetry/tail') {
      const n = Math.min(Math.max(Number(url.searchParams.get('n') || 100), 1), 2000);
      let lines = [];
      try { lines = (await fs.readFile(TELEMETRY_FILE, 'utf8')).trim().split('\n').slice(-n); } catch {}
      return json(res, 200, { ok: true, count: lines.length, events: lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) });
    }
    if (url.pathname === '/__shim.js') {
      const data = await fs.readFile(path.join(ROOT, 'web', 'shim.js'));
      return send(res, 200, data, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    }
    if (url.pathname === '/__annotator.js') {
      const data = await fs.readFile(path.join(ROOT, 'web', 'annotator.js'));
      return send(res, 200, data, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    }
    if (url.pathname === '/__telemetry/annotations') {
      const n = Math.min(Math.max(Number(url.searchParams.get('n') || 50), 1), 500);
      let events = [];
      for (const file of ['events.jsonl.1', 'events.jsonl']) {
        try {
          const lines = (await fs.readFile(path.join(TELEMETRY_DIR, file), 'utf8')).trim().split('\n');
          for (const l of lines) { try { const e = JSON.parse(l); if (e && e.type === 'annotation') events.push(e); } catch {} }
        } catch {}
      }
      return json(res, 200, { ok: true, count: events.length, annotations: events.slice(-n) });
    }
    if (url.pathname === '/__native/select' && req.method === 'POST') {
      const body = await readBody(req);
      return await nativeSelect(req, res, body);
    }
    const uidFor = AUTH_ENABLED ? sessionUser : { user_id: 'local', name: 'локален' };
    if (url.pathname.startsWith('/api/')) {
      const boot = url.pathname === '/api/state' && url.searchParams.get('boot') === '1';
      return await queued(async () => {
        const sw = await service.switchUser(uidFor ? uidFor.user_id : 'local', boot);
        if (!sw.ok) return json(res, 409, { ok: false, error: sw.error });
        return await handleApi(req, res, url, uidFor);
      });
    }
    if (url.pathname.startsWith('/__download/')) {
      return await queued(async () => {
        const sw = await service.switchUser(uidFor ? uidFor.user_id : 'local', false);
        if (!sw.ok) return json(res, 409, { ok: false, error: sw.error });
        return await handleDownload(res, url);
      });
    }
    return await handleStatic(res, url);
  } catch (error) {
    if (error instanceof HttpError) {
      res.setHeader('connection', 'close');
      return json(res, error.status, { ok: false, error: error.message });
    }
    return json(res, 500, { ok: false, error: String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`declgen web surface: http://${HOST}:${PORT} (data: ${dataRoot()})`);
});
