import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogDir } from './paths.js';
import { assertClientId } from './clients.js';
export function norm(s: string) {
  return String(s || '')
    .replace(/%/g, ' percent ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
function overlap(a: string, b: string) {
  const A = new Set(a.split(' ').filter(Boolean)),
    B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}
export function patternHits(pattern: string, text: string) {
  const p = norm(pattern),
    t = norm(text);
  return !!p && (t.includes(p) || overlap(p, t) >= 0.66);
}
function sequenceRatio(a: string, b: string) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length,
    n = b.length,
    prev = new Uint16Array(n + 1),
    cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++)
      cur[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev.set(cur);
    cur.fill(0);
  }
  const l = prev[n];
  return (2 * l) / (m + n);
}
const cleanJoined = (s: string) =>
  String(s || '')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[ ()/]+|[ ()/]+$/g, '');
const cleanDoc = (s: string) => String(s || '').replace(/\b\d{4,10}\b/g, ' ');
async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
const SOURCE_RANK: Record<string, number> = {
  human_verified: 50,
  client_dossier_override: 40,
  client_dossier_xlsx: 30,
  client_history: 20,
  learned: 10,
};
// Learned entries key by product, never by invoice line number: the same good at a
// different line reuses the key (human decisions accumulate); a different good never overwrites it.
export function productKey(name: string, fallback = '') {
  const slug = norm(name).replace(/\s+/g, '-').slice(0, 80);
  return slug ? `prod:${slug}` : fallback;
}
export async function readEntries(p: string) {
  const raw = JSON.parse(await fs.readFile(p, 'utf8'));
  if (!Array.isArray(raw))
    throw new Error(`catalog must contain a JSON list: ${p}`);
  const keyed = new Map<string, any>(),
    anon: any[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const k = String(e.key || '').trim();
    if (k) keyed.set(k, e);
    else anon.push(e);
  }
  return [...anon, ...keyed.values()];
}
export async function loadGlobal(directory = catalogDir()) {
  const p = path.join(directory, '_global', 'base.json');
  try {
    const d = JSON.parse(await fs.readFile(p, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}
export async function upsertGlobal(records: any[], directory = catalogDir()) {
  const p = path.join(directory, '_global', 'base.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  const cur = new Map<string, any>(
    (await loadGlobal(directory)).map((e: any) => [e.code, e]),
  );
  for (const r of records) {
    const code = String(r.code || '').replace(/\D/g, '');
    if (![8, 10].includes(code.length)) continue;
    const e = cur.get(code) || {
      code,
      hs6: code.slice(0, 6),
      cn: code.slice(6, 8),
      taric: code.slice(8, 10) || '00',
      names: [],
      origins: [],
      clients: [],
      filings: 0,
    };
    e.filings++;
    for (const [field, key] of [
      ['names', 'bg_name'],
      ['origins', 'origin'],
      ['clients', 'client'],
    ] as const) {
      const v = String(r[key] || '').trim();
      if (v && !e[field].includes(v)) e[field].push(v);
    }
    cur.set(code, e);
  }
  const arr = [...cur.values()].sort((a, b) => b.filings - a.filings),
    tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf8');
  await fs.rename(tmp, p);
  return arr.length;
}
export class Catalog {
  entries: any[];
  constructor(entries: any[] = []) {
    this.entries = entries;
  }
  static async load(directory = catalogDir(), clientId?: string) {
    const keyed = new Map<string, any>(),
      anon: any[] = [],
      push = (e: any) => {
        const k = String(e?.key || '').trim();
        if (!k) {
          anon.push(e);
          return;
        }
        const cur = keyed.get(k);
        if (
          !cur ||
          (SOURCE_RANK[e?.source] || 0) >= (SOURCE_RANK[cur?.source] || 0)
        )
          keyed.set(k, e);
      };
    if (await exists(directory)) {
      if (clientId) {
        assertClientId(clientId);
        for (const p of [
          path.join(directory, 'clients', `${clientId}.json`),
          path.join(directory, 'clients', `${clientId}.canonical.json`),
          path.join(directory, `${clientId}.json`),
          path.join(directory, 'learned.json'),
        ])
          if (await exists(p)) for (const e of await readEntries(p)) push(e);
      } else
        for (const f of (await fs.readdir(directory))
          .filter((x) => x.endsWith('.json'))
          .sort())
          for (const e of await readEntries(path.join(directory, f))) push(e);
    }
    return new Catalog([...anon, ...keyed.values()]);
  }
  add(e: any) {
    this.entries.push(e);
  }
  getFamily(k: string) {
    return this.entries.find((e) => e.family && e.key === k) || null;
  }
  async saveAppend(entry: any, clientId?: string, directory = catalogDir()) {
    await fs.mkdir(directory, { recursive: true });
    let p: string;
    if (clientId) {
      if (
        path.basename(clientId) !== clientId ||
        ['.', '..'].includes(clientId)
      )
        throw new Error('invalid client_id');
      p = path.join(directory, 'clients', `${clientId}.json`);
      await fs.mkdir(path.dirname(p), { recursive: true });
    } else p = path.join(directory, 'learned.json');
    if (!entry || typeof entry !== 'object')
      throw new Error('catalog entry must be an object');
    const key = String(entry.key || '').trim();
    if (!key) throw new Error('catalog entry key is required');
    let cur = (await exists(p)) ? await readEntries(p) : [];
    const replacement = structuredClone({ ...entry, key }),
      idx = cur.findIndex((e) => String(e.key || '').trim() === key);
    cur = cur.filter((e) => String(e.key || '').trim() !== key);
    if (idx >= 0) cur.splice(Math.min(idx, cur.length), 0, replacement);
    else cur.push(replacement);
    const tmp = p + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(cur, null, 2), 'utf8');
    await fs.rename(tmp, p);
    const verified = await readEntries(p),
      saved = verified.filter((e) => String(e.key || '').trim() === key);
    if (
      saved.length !== 1 ||
      JSON.stringify(saved[0]) !== JSON.stringify(replacement)
    )
      throw new Error(`catalog upsert verification failed for ${key}: ${p}`);
    this.entries = this.entries.filter(
      (e) => String(e.key || '').trim() !== key,
    );
    this.entries.push(replacement);
  }
  async delete(key: string, clientId: string, directory = catalogDir()) {
    if (!clientId || path.basename(clientId) !== clientId)
      throw new Error('valid client_id is required');
    const p = path.join(directory, 'clients', `${clientId}.json`),
      entries = (await exists(p)) ? await readEntries(p) : [];
    if (!entries.some((e) => e.key === key))
      throw new Error(`entry ${key} is not in the selected client catalog`);
    const next = entries.filter((e) => e.key !== key),
      tmp = p + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(tmp, p);
    this.entries = (await Catalog.load(directory, clientId)).entries;
  }
  static proposeEntries(newGoods: any[], hints: any[], globalBase: any[] = []) {
    const out: any[] = [],
      fam = new Map(hints.filter((h) => h.family).map((h) => [h.key, h])),
      pat = hints.filter((h) => h.pattern);
    for (const g of newGoods) {
      const hay = norm(`${g.group || ''} ${(g.descriptions || []).join(' ')}`);
      let hit = pat.find((h) => patternHits(h.pattern, hay)),
        entry: any = null,
        marker: any = null;
      if (hit) {
        entry = {
          key: hit.key,
          bg_name: hit.bg_name || '',
          bg_phrase: hit.bg_phrase || '',
          hs: {
            hs6: hit.hs6 || '',
            cn: hit.cn || '00',
            taric: hit.taric || '00',
          },
          origin: String(hit.origin || '').toUpperCase(),
          map_group: hit.map_group,
        };
        if (entry.map_group && fam.has(entry.map_group)) {
          const f: any = fam.get(entry.map_group);
          entry._family_shell = {
            key: f.key,
            family: true,
            bg_name: f.bg_name || '',
            bg_phrase: '',
            aliases: [],
            hs: { hs6: f.hs6 || '', cn: f.cn || '00', taric: f.taric || '00' },
            origin: f.origin || '',
          };
        }
        marker = hit.pattern;
      }
      if (!entry) {
        for (const ge of globalBase) {
          if (
            (ge.names || [])
              .slice(0, 4)
              .some((n: string) => patternHits(n, hay))
          ) {
            const c = ge.code;
            entry = {
              key: `glob-${c}`,
              bg_name: (ge.names || [''])[0],
              bg_phrase: '',
              hs: {
                hs6: c.slice(0, 6),
                cn: c.slice(6, 8),
                taric: c.length >= 10 ? c.slice(8, 10) : '00',
              },
              origin: (ge.origins || [''])[0],
              map_group: null,
              _advisory: true,
            };
            marker = `global:${c} (файлвано ${ge.filings}x)`;
            break;
          }
        }
      }
      out.push({
        group: g.group,
        descriptions: g.descriptions || [],
        entry,
        matched_pattern: marker,
      });
    }
    return out;
  }
  match(description: string, hsCode?: string): [any | null, number] {
    const name = norm(cleanJoined(cleanDoc(description))),
      hs6 = String(hsCode || '').slice(0, 6),
      rank = SOURCE_RANK;
    let best: any = null,
      bestScore = 0,
      bestRank = -1;
    for (const e of this.entries) {
      const aliases = [
        e.key || '',
        e.bg_name || '',
        e.bg_phrase || '',
        ...(e.aliases || []),
      ];
      let score = 0;
      for (const a of aliases) {
        if (
          String(a || '').trim() &&
          String(a).trim().toLocaleLowerCase() ===
            String(description || '')
              .trim()
              .toLocaleLowerCase()
        )
          score = 1;
        const na = norm(a);
        if (!na || !name) continue;
        if (na === name) score = 1;
        else if (na.includes(name) || name.includes(na))
          score = Math.max(score, 0.92);
        else
          score = Math.max(
            score,
            0.55 * sequenceRatio(na, name) + 0.45 * overlap(na, name),
          );
      }
      if (e.hs && hs6 && e.hs.hs6 === hs6) score = Math.min(1, score + 0.08);
      const r = rank[e.source] || 0;
      if (score > bestScore || (score === bestScore && r > bestRank)) {
        best = e;
        bestScore = score;
        bestRank = r;
      }
    }
    const threshold = name.split(' ').filter(Boolean).length >= 2 ? 0.75 : 0.88;
    return best && bestScore >= threshold
      ? [best, Math.round(bestScore * 1000) / 1000]
      : [null, Math.round(bestScore * 1000) / 1000];
  }
}
