import { hsSane } from './extract.js';
export function parsePackageCount(value: unknown): number | null {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(
      /^(\d+)(?:\.0+)?\s*(?:(?:physical\s+)?(?:packages?|pcs?|колета?|колети))?$/i,
    );
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
export function extractMasses(
  invoice: any,
  packing: any,
): [Record<string, any>, string[], string[]] {
  const inv = invoice?.lines ?? [],
    pl = packing?.lines ?? [],
    warnings = [...(packing?._warnings ?? [])],
    notes: string[] = [],
    patch: Record<string, any> = {};
  const usedInv = new Set<number>(),
    usedPl = new Set<number>();
  let masses: Record<string, any> = {};
  const key = (x: any) => String(x?.no);
  const norm = (s: any) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/g, ' ')
      .trim();
  const th = Math.max(3, Math.ceil(0.6 * pl.length));
  if (inv.length && pl.length && inv.length === pl.length) {
    pl.forEach((p: any, i: number) => {
      if (p.net_kg != null) masses[key(inv[i])] = p.net_kg;
      usedInv.add(i);
      usedPl.add(i);
    });
    notes.push(`packing list matched by row order (${pl.length} rows)`);
  } else {
    const invByNo = new Map<string, number>();
    inv.forEach((x: any, i: number) => {
      const k = key(x);
      if (!invByNo.has(k)) invByNo.set(k, i);
    });
    // Strategy B: positional alignment by line number — deterministic when both docs number rows; survives count drift (e.g. PL has one extra/trailing row).
    // The two documents may number rows independently (PL counts package detail
    // rows), so a coincidental number match that pairs unrelated products must
    // not assign a wrong weight — skip pairs whose descriptions share no token.
    const tok = (s: any) =>
      new Set(
        norm(s)
          .split(' ')
          .filter((w) => w.length >= 3),
      );
    const bCand = pl
      .map((p: any, pi: number) => [key(p), pi] as const)
      .filter(([k]: any) => invByNo.has(k));
    if (bCand.length >= th) {
      for (const [k, pi] of bCand) {
        const i = invByNo.get(k)!;
        if (usedInv.has(i) || usedPl.has(pi)) continue;
        const p = pl[pi],
          a = tok(p.description),
          b = tok(inv[i].description);
        if (a.size && b.size && ![...a].some((w) => b.has(w))) continue;
        if (p.net_kg != null) masses[key(inv[i])] = p.net_kg;
        usedInv.add(i);
        usedPl.add(pi);
      }
      notes.push(`packing list matched by line number (${bCand.length} rows)`);
    }
    // Strategy C: normalized description containment (both directions), needs a distinctive string — raw 'mark' first-token matching was too weak ('Pro','Unit','socket'…).
    pl.forEach((p: any, pi: number) => {
      if (usedPl.has(pi)) return;
      const d = norm(p.description || '');
      if (d.length < 10) return;
      const hits = inv
        .map((x: any, i: number) => [x, i] as const)
        .filter(([x, i]: any) => {
          if (usedInv.has(i)) return false;
          const xd = norm(x.description);
          if (!xd) return false;
          return xd === d || xd.includes(d) || d.includes(xd);
        });
      if (hits.length === 1) {
        const p = pl[pi];
        if (p.net_kg != null) masses[key(hits[0][0])] = p.net_kg;
        usedInv.add(hits[0][1]);
        usedPl.add(pi);
      }
    });
    // Strategy D: distinctive mark (first 2 tokens, ≥6 chars) containment in invoice description.
    pl.forEach((p: any, pi: number) => {
      if (usedPl.has(pi)) return;
      const mk = norm(p.mark || '')
        .split(' ')
        .slice(0, 2)
        .join(' ');
      if (mk.length < 6) return;
      const hits = inv
        .map((x: any, i: number) => [x, i] as const)
        .filter(
          ([x, i]: any) => !usedInv.has(i) && norm(x.description).includes(mk),
        );
      if (hits.length === 1) {
        const p = pl[pi];
        if (p.net_kg != null) masses[key(hits[0][0])] = p.net_kg;
        usedInv.add(hits[0][1]);
        usedPl.add(pi);
      }
    });
    // Strategy E: unique HS-code equality (final fallback).
    pl.forEach((p: any, pi: number) => {
      if (usedPl.has(pi)) return;
      const hs = hsSane(p.hs_code);
      if (!hs) return;
      const hits = inv
        .map((x: any, i: number) => [x, i] as const)
        .filter(
          ([x, i]: any) => !usedInv.has(i) && String(x.hs_code ?? '') === hs,
        );
      if (hits.length === 1) {
        if (p.net_kg != null) masses[key(hits[0][0])] = p.net_kg;
        usedInv.add(hits[0][1]);
        usedPl.add(pi);
      }
    });
  }
  const up = pl
    .filter((_: any, i: number) => !usedPl.has(i))
    .map((x: any) => x.no);
  if (up.length)
    warnings.push(
      `ред(ове) ${JSON.stringify(up)} от packing list нямат съответствие във фактурата и са игнорирани`,
    );
  const short = inv
    .filter((x: any) => !(key(x) in masses))
    .map((x: any) => x.no);
  if (short.length)
    warnings.push(
      `ред(ове) ${JSON.stringify(short)} от фактурата нямат нето тегло от packing list`,
    );
  let incompatible = false;
  const matched = Object.keys(masses).length;
  if (pl.length && inv.length && pl.length !== inv.length) {
    const th = Math.max(3, Math.ceil(0.6 * pl.length));
    if (matched < th) {
      incompatible = true;
      warnings.push(
        `packing list не съответства на фактурата (съвпаднаха ${matched}/${pl.length} реда) — теглата са изхвърлени`,
      );
      masses = {};
    }
  }
  if (Object.keys(masses).length) patch.line_masses = masses;
  let gross = incompatible ? null : packing?.total_gross_weight_kg,
    net = packing?.total_net_weight_kg;
  if (gross != null && net != null && Number(gross) < Number(net) - 1e-9) {
    warnings.push(
      `бруто (${gross} кг) е по-малко от нето (${net} кг) — брутото е изхвърлено`,
    );
    gross = null;
  }
  if (
    gross != null &&
    (!pl.length ||
      !inv.length ||
      pl.length === inv.length ||
      matched >= Math.max(3, Math.ceil(0.6 * pl.length)))
  )
    patch.total_gross_kg = gross;
  if (packing?.packages && !incompatible) {
    const c = parsePackageCount(packing.packages);
    if (c == null)
      warnings.push(
        `броят колети не е число (${JSON.stringify(packing.packages)})`,
      );
    else patch.total_packages = c;
  }
  return [patch, warnings, notes];
}
