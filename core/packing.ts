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
    usedPl = new Set<number>(),
    plToInv = new Map<number, number>();
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
      plToInv.set(i, i);
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
          .filter((w) => w.length >= 3 || (w.length >= 2 && /\d/.test(w))),
      );
    // Fraction/qty digits ('1','2','5' from '6 5/8', 'API 1/2') are noise —
    // only multi-char size/model tokens can contradict a pairing.
    const digitTok = (s: Set<string>) =>
      new Set([...s].filter((w) => /\d/.test(w) && w.length >= 2));
    const bCand = pl
      .map((p: any, pi: number) => [key(p), pi] as const)
      .filter(([k]: any) => invByNo.has(k));
    if (bCand.length >= th) {
      const dScore = (a: Set<string>, b: Set<string>) => {
        let s = 0;
        for (const w of a)
          if (b.has(w))
            s += w.length + 2 + (/\d/.test(w) && w.length >= 2 ? 40 : 0);
        return s;
      };
      let bn = 0;
      for (const [k, pi] of bCand) {
        const i = invByNo.get(k)!;
        if (usedInv.has(i) || usedPl.has(pi)) continue;
        const p = pl[pi],
          a = tok(p.description),
          b = tok(inv[i].description);
        if (a.size && b.size && ![...a].some((w) => b.has(w))) continue;
        // size/model tokens ('125mm' vs '200mm') must not contradict each other
        const da = digitTok(a),
          db = digitTok(b);
        if (da.size && db.size && ![...da].some((w) => db.has(w))) continue;
        // Off-by-one guard: when the PL inserts detail rows its numbering
        // drifts, so a coincidental number pair is only kept when no unused
        // invoice line is a clearly better textual match.
        const own = dScore(a, b);
        let alt = 0;
        inv.forEach((x: any, j: number) => {
          if (j === i || usedInv.has(j)) return;
          alt = Math.max(alt, dScore(a, tok(x.description)));
        });
        if (alt > own * 1.2) continue;
        if (p.net_kg != null) masses[key(inv[i])] = p.net_kg;
        usedInv.add(i);
        usedPl.add(pi);
        plToInv.set(pi, i);
        bn++;
      }
      if (bn)
        notes.push(`packing list matched by line number (${bn} rows)`);
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
        plToInv.set(pi, hits[0][1]);
      }
    });
    // Strategy C2: token-overlap alignment for docs that itemize the same
    // goods in different order/wording. Digit-bearing tokens (model codes,
    // sizes) weigh more; pairs are assigned greedily by unique best score.
    const pairTok = (s: any) =>
      new Set(
        norm(s)
          .split(' ')
          .filter((w) => w.length >= 3 || (w.length >= 2 && /\d/.test(w))),
      );
    const scored: [number, number, number][] = [];
    pl.forEach((p: any, pi: number) => {
      if (usedPl.has(pi)) return;
      const a = pairTok(p.description);
      if (a.size < 2) return;
      const cand: [number, number, number][] = [];
      inv.forEach((x: any, i: number) => {
        if (usedInv.has(i)) return;
        const b = pairTok(x.description);
        let s = 0,
          ds = 0;
        for (const w of a)
          if (b.has(w)) {
            s += w.length + 2;
            if (/\d/.test(w) && w.length >= 2) ds++;
          }
        if (s >= 8) cand.push([ds, s, i]);
      });
      // Shared size/model tokens decide before raw text overlap — '250mm'
      // outweighs a longer coincidental phrase match.
      cand.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
      if (
        cand.length &&
        (cand[0][0] > (cand[1]?.[0] ?? -1) || cand[0][1] > cand[1]?.[1])
      )
        scored.push([cand[0][1] + cand[0][0] * 100, pi, cand[0][2]]);
    });
    scored.sort((x, y) => y[0] - x[0]);
    let c2 = 0;
    for (const [, pi, i] of scored) {
      if (usedInv.has(i) || usedPl.has(pi)) continue;
      const p = pl[pi];
      if (p.net_kg != null) masses[key(inv[i])] = p.net_kg;
      usedInv.add(i);
      usedPl.add(pi);
      plToInv.set(pi, i);
      c2++;
    }
    if (c2)
      notes.push(`packing list matched by description similarity (${c2} rows)`);
    // Strategy C3: an invoice line billed once can be packed as several rows
    // (50 pcs of drill rod = 3 bundles on the PL). A leftover *weighted* row
    // accumulates onto the used invoice line sharing a real model token; a
    // leftover unweighted row only if it is a "bundle sibling" — same model
    // codes as a PL row already bound to that line — and has real words
    // (code-only fragments belong to positional package grouping).
    pl.forEach((p: any, pi: number) => {
      if (usedPl.has(pi)) return;
      const a = pairTok(p.description);
      const da = digitTok(a);
      if (!da.size) return;
      const codeOnly = ![...a].some((w) => !/\d/.test(w));
      let bi = -1,
        bs = 0;
      if (p.net_kg != null) {
        inv.forEach((x: any, i: number) => {
          if (!usedInv.has(i)) return;
          const db = digitTok(pairTok(x.description));
          const shared = [...da].filter((w) => db.has(w));
          if (!shared.some((w) => w.length >= 4)) return;
          const s =
            shared.reduce((t, w) => t + w.length, 0) -
            (db.size - shared.length) * 3;
          if (s > bs) {
            bs = s;
            bi = i;
          }
        });
      } else if (!codeOnly && [...da].some((w) => w.length >= 4)) {
        plToInv.forEach((i, qi) => {
          const dq = digitTok(pairTok(pl[qi].description));
          if (
            dq.size >= da.size &&
            [...da].every((w) => dq.has(w)) &&
            10 + dq.size > bs
          ) {
            bs = 10 + dq.size;
            bi = i;
          }
        });
      }
      if (bi >= 0) {
        const p2 = pl[pi];
        if (p2.net_kg != null) {
          const k = key(inv[bi]);
          masses[k] = (masses[k] || 0) + p2.net_kg;
        }
        usedPl.add(pi);
        plToInv.set(pi, bi);
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
        plToInv.set(pi, hits[0][1]);
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
        plToInv.set(pi, hits[0][1]);
      }
    });
  }
  // Package-group distribution: a net/gross cell on this style of packing
  // list is vertically merged across the product rows sharing one box or
  // pallet, so the weight sits on a single "anchor" row while the group's
  // other rows carry none. An unweighted row joins the most similar anchor
  // (shared product-family tokens, nearest wins ties) and the anchor weight
  // is split across the whole group by quantity.
  const anchors: number[] = [];
  pl.forEach((p: any, i: number) => {
    if (p.net_kg != null) anchors.push(i);
  });
  const tok2 = (s: any) =>
    new Set(
      norm(s)
        .split(' ')
        .filter((w) => w.length >= 4 || (w.length >= 2 && /\d/.test(w))),
    );
  const grouped = new Map<number, number[]>(),
    inGroup = new Set<number>();
  for (const ai of anchors) grouped.set(ai, [ai]);
  pl.forEach((p: any, pi: number) => {
    if (p.net_kg != null) return;
    const a = tok2(p.description);
    if (!a.size) return;
    // A merged weight cell spans a contiguous run of product rows, so an
    // unweighted row belongs to one of its two bounding anchors — bind to
    // the side its tokens favor (tie: nearer). A lone unweighted row
    // scoring zero both ways is genuinely unweighed (e.g. the engine) and
    // stays unbound so the warning reaches the user.
    const codeOnly = ![...a].some((w) => !/\d/.test(w));
    const score = (ai: number) => {
      const b = tok2(pl[ai].description);
      let s = 0;
      for (const w of a) if (b.has(w)) s += w.length + (/\d/.test(w) ? 2 : 0);
      return s;
    };
    let prev = -1,
      next = -1;
    for (const ai of anchors) {
      if (ai < pi) {
        if (prev < 0 || ai > prev) prev = ai;
      } else if (next < 0 || ai < next) next = ai;
    }
    const sp = prev >= 0 ? score(prev) : 0,
      sn = next >= 0 ? score(next) : 0;
    let best = -1;
    if (sp > 0 || sn > 0)
      best =
        sp === sn
          ? (prev >= 0 ? pi - prev : Infinity) <=
              (next >= 0 ? next - pi : Infinity)
            ? prev
            : next
          : sp > sn
            ? prev
            : next;
    else if (codeOnly)
      best =
        (prev >= 0 ? pi - prev : Infinity) <=
        (next >= 0 ? next - pi : Infinity)
          ? prev
          : next;
    else if (pl[pi - 1]?.net_kg == null || pl[pi + 1]?.net_kg == null) {
      // Row inside an unweighted run — part of a shared crate but with no
      // token link to either neighbour (e.g. hammers boxed with bits).
      // Take the best global anchor discounted by distance.
      let eff = -Infinity;
      for (const ai of anchors) {
        const e = score(ai) * 2 - Math.abs(pi - ai);
        if (e > eff) {
          eff = e;
          best = ai;
        }
      }
    }
    if (best >= 0) {
      grouped.get(best)!.push(pi);
      inGroup.add(pi);
    }
  });
  // Group fill: members sharing a package are variants of the same goods;
  // when several invoice rows tie on tokens (same description modulo size),
  // take the best unused invoice line anyway — position and family already
  // bound it. Unambiguous-only matching would leave them weightless.
  let filled = 0;
  for (const members of grouped.values()) {
    // Rows between two matched siblings tend to be the invoice lines between
    // those siblings' matches too — use that to break score ties.
    const siblingInv = members
      .map((mi) => plToInv.get(mi))
      .filter((i): i is number => i != null)
      .sort((a, b) => a - b);
    const mid = siblingInv.length
      ? siblingInv[Math.floor(siblingInv.length / 2)]
      : -1;
    for (const mi of members) {
      if (usedPl.has(mi)) continue;
      const a = tok2(pl[mi].description);
      if (!a.size) continue;
      let bi = -1,
        bs = 0,
        bd = Infinity;
      inv.forEach((x: any, i: number) => {
        if (usedInv.has(i)) return;
        const b = tok2(x.description);
        let s = 0;
        for (const w of a) if (b.has(w)) s += w.length + 2;
        const d = mid >= 0 ? Math.abs(i - mid) : 0;
        if (s > bs || (s === bs && s > 0 && d < bd)) {
          bs = s;
          bi = i;
          bd = d;
        }
      });
      if (bi >= 0 && bs >= 6) {
        usedPl.add(mi);
        usedInv.add(bi);
        plToInv.set(mi, bi);
        filled++;
      }
    }
  }
  if (filled)
    notes.push(`package-group rows aligned to invoice lines (${filled} rows)`);
  if (inGroup.size) {
    // Re-anchor: replace full-anchor weights with per-member qty shares.
    const share = new Map<number, number>();
    for (const [ai, members] of grouped) {
      const w = Number(pl[ai].net_kg),
        q = (i: number) => Math.max(1e-9, Number(pl[i]?.qty) || 1),
        total = members.reduce((s, i) => s + q(i), 0);
      for (const mi of members) share.set(mi, (w * q(mi)) / total);
    }
    masses = {};
    for (const [pi, i] of plToInv) {
      const w = share.get(pi);
      if (w == null) continue;
      const k = key(inv[i]);
      masses[k] = (masses[k] || 0) + w;
    }
    notes.push(
      `package weights distributed across shared boxes/pallets (${inGroup.size} unweighted rows)`,
    );
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
  // Compatibility is judged against rows that can carry a weight at all —
  // shared-box/pallet rows have no net_kg and can never add to `matched`.
  const weighted = pl.filter((p: any) => p.net_kg != null).length;
  if (pl.length && inv.length && pl.length !== inv.length) {
    const th = Math.max(3, Math.ceil(0.6 * (weighted || pl.length)));
    if (matched < th) {
      incompatible = true;
      warnings.push(
        `packing list не съответства на фактурата (съвпаднаха ${matched}/${weighted || pl.length} реда с тегло) — теглата са изхвърлени`,
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
      matched >= Math.max(3, Math.ceil(0.6 * (weighted || pl.length))))
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
