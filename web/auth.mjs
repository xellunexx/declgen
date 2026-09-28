// Accounts gate for the declgen web surface. Zero deps; file-backed.
// Contract: owns users.json + sessions.json under <dataRoot>/auth. Guarantees:
// register/login/logout/resolve are the ONLY ways to create or read sessions.
// Absent (DECLGEN_AUTH=off in server.mjs): this module is never called.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const MIN_PASSWORD = 10;

let DIR = null, USERS = null, SESSIONS = null;

// Serializes every read-modify-write of users.json / sessions.json.
let writeChain = Promise.resolve();
const locked = (fn) => { const r = writeChain.then(fn); writeChain = r.catch(() => {}); return r; };

const scryptAsync = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(String(password), salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex')))));
const tokenDigest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function initAuth(dataRoot) {
  DIR = path.join(dataRoot, 'auth');
  USERS = path.join(DIR, 'users.json');
  SESSIONS = path.join(DIR, 'sessions.json');
  fsSync.mkdirSync(DIR, { recursive: true });
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, data) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

const validName = (s) => /^[A-Za-zА-Яа-я0-9 _.-]{2,40}$/.test(String(s || '').trim());
const cleanId = (name) => String(name).trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'user';

export async function register({ name, password }) {
  name = String(name || '').trim();
  if (!validName(name)) return { ok: false, error: 'Името трябва да е 2–40 знака (букви/цифри).' };
  if (String(password || '').length < MIN_PASSWORD) return { ok: false, error: `Паролата трябва да е поне ${MIN_PASSWORD} знака.` };
  const salt = crypto.randomBytes(16).toString('hex');
  const pass_hash = await scryptAsync(password, salt);
  return locked(async () => {
    const users = await readJson(USERS, []);
    const base = cleanId(name);
    let id = base, i = 2;
    while (users.some((u) => u.id === id)) id = `${base}_${i++}`;
    const user = { id, name, salt, pass_hash, created_at: new Date().toISOString() };
    users.push(user);
    await writeJson(USERS, users);
    return { ok: true, user: { id, name } };
  });
}

function newSession(user) {
  return locked(async () => {
    const sessions = await readJson(SESSIONS, []);
    const alive = sessions.filter((s) => s.token_sha256 && Date.now() - Date.parse(s.created_at) < SESSION_TTL_MS);
    const token = crypto.randomBytes(32).toString('hex');
    alive.push({ token_sha256: tokenDigest(token), user_id: user.id, name: user.name, created_at: new Date().toISOString() });
    await writeJson(SESSIONS, alive);
    return token;
  });
}

export async function registerAndLogin(input) {
  const reg = await register(input);
  if (!reg.ok) return reg;
  return { ok: true, user: reg.user, token: await newSession(reg.user) };
}

export async function login({ name, password }) {
  const users = await readJson(USERS, []);
  const id = cleanId(name || '');
  const user = users.find((u) => u.id === id || u.name.toLowerCase() === String(name || '').trim().toLowerCase());
  const attempt = await scryptAsync(password || '', user ? user.salt : 'no-such-user');
  const ok = !!user && crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(user.pass_hash, 'hex'));
  if (!ok) return { ok: false, error: 'Грешно име или парола.' };
  return { ok: true, user: { id: user.id, name: user.name }, token: await newSession(user) };
}

export async function resolveSession(token) {
  if (!token) return null;
  const sessions = await readJson(SESSIONS, []);
  const digest = tokenDigest(token);
  const s = sessions.find((x) => x.token_sha256 === digest);
  if (!s) return null;
  if (Date.now() - Date.parse(s.created_at) >= SESSION_TTL_MS) return null;
  return { user_id: s.user_id, name: s.name };
}

export async function logout(token) {
  if (!token) return { ok: true };
  const digest = tokenDigest(token);
  return locked(async () => {
    const sessions = await readJson(SESSIONS, []);
    await writeJson(SESSIONS, sessions.filter((x) => x.token_sha256 !== digest));
    return { ok: true };
  });
}

export async function hasAnyUser() {
  return (await readJson(USERS, [])).length > 0;
}
