// Case-history store for the declgen web surface. Owns <dataRoot>/history/*.json.
// Guarantee: snapshots are append-only, immutable once written, server-generated only.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

let DIR = null;
export function initHistory(dataRoot) {
  DIR = path.join(dataRoot, 'history');
  fsSync.mkdirSync(DIR, { recursive: true });
}

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));

// Snapshot shape produced server-side from the live DeclgenService (see server.mjs).
export async function saveSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('invalid snapshot');
  const id = snapshot.id;
  if (!safeId(id)) throw new Error('invalid history id');
  await fs.mkdir(DIR, { recursive: true });
  const file = path.join(DIR, id + '.json');
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return id;
}

export async function listSnapshots(userId) {
  let files = [];
  try { files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8'));
      if (j.user_id === userId) out.push({ id: j.id, saved_at: j.saved_at, client_id: j.client_id, invoice_number: j.invoice_number, direction: j.direction, totals: j.totals, items_count: (j.items || []).length });
    } catch {}
  }
  out.sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
  return out;
}

export async function getSnapshot(id, userId) {
  if (!safeId(id)) return null;
  try {
    const j = JSON.parse(await fs.readFile(path.join(DIR, id + '.json'), 'utf8'));
    return j.user_id === userId ? j : null;
  } catch { return null; }
}
