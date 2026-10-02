// Payout math. Pure functions only, so it can be tested without a chain or a database.
// Same rules the site shows: 70% callers by callout score (holdings × PnL), 5% Top 20, 25% $EXPO reserve.
export const LAMPORTS = 1_000_000_000;
export const W = { exposure: 1, pump: 0.45, fomo: 0.35, gmgn: 0.20 };
export const BONUS = n => Math.min(1 + 0.25 * (Math.max(1, n) - 1), 1.75);
export const THRESH_LAMPORTS = 1 * LAMPORTS;     // a pool pays out at 1 SOL
export const CAP_LAMPORTS = 0.5 * LAMPORTS;      // no wallet gets more than 0.5 SOL from one payout
export const MIN_SEND_LAMPORTS = 1_000_000;      // skip dust under 0.001 SOL (it stays in the pool)

// entries: [{w, pl, n, wt}] — one per caller wallet for this coin's round. wt = callout score.
export function planPayout(poolLamports, entries) {
  poolLamports = Math.floor(Number(poolLamports));
  if (!Number.isFinite(poolLamports) || poolLamports < THRESH_LAMPORTS) return null;
  const valid = entries.filter(e => W[e.pl] !== undefined && Number.isFinite(+e.wt) && +e.wt > 0 && typeof e.w === "string");
  // one line per wallet: if a wallet appears twice, keep its best entry
  const byW = new Map();
  for (const e of valid) { const prev = byW.get(e.w); if (!prev || +e.wt > +prev.wt) byW.set(e.w, e); }
  const list = [...byW.values()];
  const avg = {};
  for (const k in W) { const xs = list.filter(r => r.pl === k).map(r => +r.wt); avg[k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1; }
  const scored = list.map(r => ({ ...r, sc: W[r.pl] * (+r.wt / avg[r.pl]) * BONUS(r.n | 0) }));
  const tot = scored.reduce((a, b) => a + b.sc, 0);

  const callersShare = Math.floor(poolLamports * 0.7);
  const top20 = Math.floor(poolLamports * 0.05);
  const reserve = Math.floor(poolLamports * 0.25);
  const sends = [];
  let paid = 0;
  if (tot > 0) {
    for (const r of scored) {
      const amt = Math.min(Math.floor(callersShare * r.sc / tot), CAP_LAMPORTS);
      if (amt >= MIN_SEND_LAMPORTS) { sends.push({ w: r.w, pl: r.pl, lamports: amt, sc: r.sc }); paid += amt; }
    }
  }
  // Anything not paid to callers (caps, dust, no callers) stays in the coin's pool for the next round.
  const leftover = poolLamports - paid - top20 - reserve;
  return { sends: sends.sort((a, b) => b.lamports - a.lamports), top20, reserve, leftover, total: poolLamports };
}

// Caller ranks (same as the site): Wilson lower bound at z = 1.64, 10 calls to be ranked.
export function wilson(w, n) { if (!n) return 0; const z = 1.64, p = w / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n); }

// A call wins if the coin reaches 1.5x the market cap at callout time within 24 hours.
export function isWin(calloutMc, peakMcWithin24h) { return calloutMc > 0 && peakMcWithin24h >= calloutMc * 1.5; }

// Callout score (Exposure callouts): holdings × PnL.
//  - holdings = the lower of what you held when you called and what you hold now, as % of supply, capped at 1% (whale cap);
//    square-rooted so a big bag counts more, but not proportionally more
//  - PnL = coin's market cap now vs at your call; losses count as 0%, gains capped at +400% (5×)
//  - sell out and your score is 0
export const HOLD_CAP_PCT = 1, PNL_CAP = 4;
export function calloutScore({ tokensAtCall, tokensNow, supply = 1e9, mcAtCall, mcNow }) {
  const held = Math.min(+tokensAtCall || 0, +tokensNow || 0);
  if (!(held > 0) || !(supply > 0)) return { holdPct: 0, pnl: 0, score: 0 };
  const holdPct = Math.min(held / supply * 100, HOLD_CAP_PCT);
  const pnl = mcAtCall > 0 && mcNow > 0 ? Math.max(0, Math.min(mcNow / mcAtCall - 1, PNL_CAP)) : 0;
  return { holdPct, pnl, score: Math.sqrt(holdPct) * (1 + pnl) };
}

// Daily Top 20 bonus: the Top 20 pool is split by rank, #1 gets 20 shares, #2 gets 19 ... #20 gets 1 (210 shares in all).
// ranked: [{w, gain}] best first, one per wallet. Dust under 0.001 SOL is skipped and stays for tomorrow.
export function planTop20(poolLamports, ranked) {
  poolLamports = Math.floor(Number(poolLamports));
  const seen = new Set(), list = [];
  for (const r of ranked) { if (typeof r.w !== "string" || seen.has(r.w)) continue; seen.add(r.w); list.push(r); if (list.length === 20) break; }
  if (!list.length || !(poolLamports > 0)) return { sends: [], leftover: Math.max(0, poolLamports || 0) };
  const sends = []; let paid = 0;
  list.forEach((r, i) => { const amt = Math.floor(poolLamports * (20 - i) / 210); if (amt >= MIN_SEND_LAMPORTS) { sends.push({ w: r.w, rank: i + 1, lamports: amt }); paid += amt; } });
  return { sends, leftover: poolLamports - paid };
}
