// Builds the JSON the site reads (GET /api/state and /api/wallet/:addr). Shapes match the site's CONFIG notes.
import { db, eq } from "./db.js";
import { getBalance } from "./rpc.js";
import { LAMPORTS } from "./payout.js";
import { top20Wallet } from "./keys.js";
const top20Address = () => { try { return top20Wallet(process.env.POOL_MASTER_SEED).publicKey; } catch { return ""; } };

// Coin pictures are stored on IPFS; serve them through our own /api/img so they load fast and reliably.
const imgUrl = u => { const m = String(u || "").match(/\/ipfs\/([A-Za-z0-9]+)/); return m ? `${(process.env.SITE_URL || "").replace(/\/$/, "")}/api/img?cid=${m[1]}` : (u || ""); };
const holdOf = c => +(Math.min(+c.tokens_at_call || 0, +c.tokens_now || 0) / 1e7).toFixed(4); // % of supply
const pnlOf = c => +((+c.pnl || 0) * 100).toFixed(1);                                         // percent
const ms = t => (t ? Date.parse(t) : 0);
const sol = l => (+l || 0) / LAMPORTS;
const shortW = w => (w ? w.slice(0, 4) + "…" + w.slice(-4) : "");

function nameOf(w, callersBy, fallback) { const c = callersBy.get(w); return (c && (c.x_handle || c.username)) || fallback || shortW(w); }
const xOf = c => (c && c.x_handle ? { handle: c.x_handle, name: c.x_name || c.x_handle, avatar: c.x_avatar || "" } : undefined);

export function callerStats(w, calls, earnedByW, starsBy, now = Date.now()) {
  const mine = calls.filter(c => c.wallet === w), m30 = mine.filter(c => now - ms(c.posted_at) < 30 * 864e5);
  const judged = a => a.filter(c => c.won !== null && c.won !== undefined);
  const peak = a => a.filter(c => c.mc_at_call > 0 && c.peak_mc_24h > 0).map(c => c.peak_mc_24h / c.mc_at_call);
  const avg = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0);
  const best = a => (a.length ? +Math.max(...a).toFixed(1) : 0);
  let streak = 0; for (const c of judged(mine).sort((a, b) => ms(b.posted_at) - ms(a.posted_at))) { if (c.won) streak++; else break; }
  const e = earnedByW.get(w) || { all: 0, d30: 0 }, s = starsBy.get(w);
  return {
    calls: judged(mine).length, wins: judged(mine).filter(c => c.won).length,
    calls30: judged(m30).length, wins30: judged(m30).filter(c => c.won).length,
    avgPeak: avg(peak(mine)), bestX: best(peak(mine)), avgPeak30: avg(peak(m30)), bestX30: best(peak(m30)),
    earned: sol(e.all), earned30: sol(e.d30), stars: s ? +s.stars : 0, starsN: s ? +s.stars_n : 0, streak
  };
}

export async function loadAll() {
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const [coins, calls, callers, pays, act, stars] = await Promise.all([
    db.select("coins", "confirmed=eq.true&order=created_at.desc&limit=300"),
    db.select("callouts", `posted_at=gte.${since}&order=posted_at.desc&limit=5000`),
    db.select("callers", "limit=5000"),
    db.select("payouts", "status=eq.sent&order=created_at.desc&limit=2000"),
    db.select("activity", "order=at.desc&limit=200"),
    db.select("caller_stars", "limit=5000")
  ]);
  return { coins, calls, callers, pays, act, stars };
}

export async function buildState() {
  const { coins, calls, callers, pays, act, stars } = await loadAll(), now = Date.now();
  const callersBy = new Map(callers.map(c => [c.wallet, c])), starsBy = new Map(stars.map(s => [s.caller, s]));
  const coinBy = new Map(coins.map(c => [c.mint, c]));
  const earnedByW = new Map();
  for (const p of pays) { if (p.kind !== "payout") continue; const e = earnedByW.get(p.wallet) || { all: 0, d30: 0 }; e.all += +p.lamports; if (now - ms(p.created_at) < 30 * 864e5) e.d30 += +p.lamports; earnedByW.set(p.wallet, e); }

  const round = {};
  for (const c of calls) {
    if (c.round_paid_at || !coinBy.has(c.mint)) continue;
    const list = (round[c.mint] = round[c.mint] || []);
    const hit = list.find(r => r.w === c.wallet && r.pl === c.platform);
    if (hit) { hit.n++; hit.wt += +c.weight; }
    else list.push({ u: nameOf(c.wallet, callersBy, c.username), w: c.wallet, pl: c.platform, n: 1, hold: holdOf(c), pnl: pnlOf(c), wt: +c.weight, at: ms(c.posted_at), note: c.note || "" });
  }

  const wallets = [...new Set(calls.map(c => c.wallet))];
  const callerRows = wallets.map(w => ({ u: nameOf(w, callersBy), w, x: xOf(callersBy.get(w)), ...callerStats(w, calls, earnedByW, starsBy, now) }));

  const recentPaid = new Map(pays.filter(p => p.kind === "payout").map(p => [p.wallet + p.mint, p]));
  const callouts = calls.slice(0, 200).map(c => ({ u: nameOf(c.wallet, callersBy, c.username), w: c.wallet, coin: c.mint, pl: c.platform, n: 1, hold: holdOf(c), pnl: pnlOf(c), note: c.note || "", sc: +c.weight, earned: sol((recentPaid.get(c.wallet + c.mint) || {}).lamports), at: ms(c.posted_at) }));

  // Top 20: best calls of the last 7 days by peak gain within 24h.
  const top20 = calls.filter(c => now - ms(c.posted_at) < 7 * 864e5 && c.mc_at_call > 0 && c.peak_mc_24h > 0)
    .map(c => ({ u: nameOf(c.wallet, callersBy, c.username), w: c.wallet, tick: (coinBy.get(c.mint) || {}).ticker || "", gain: +(c.peak_mc_24h / c.mc_at_call).toFixed(2), hold: holdOf(c), entered: ms(c.posted_at) }))
    .sort((a, b) => b.gain - a.gain).slice(0, 20);

  const hist = await db.select("mc_history", `t=gte.${new Date(now - 864e5).toISOString()}&order=t.asc&limit=20000`).catch(() => []);
  const histBy = new Map(); for (const h of hist) { const a = histBy.get(h.mint) || []; a.push({ t: ms(h.t), mc: +h.mc }); histBy.set(h.mint, a); }

  const [top20Bal, reserveBal, solUsd] = await Promise.all([
    top20Address() ? getBalance(top20Address()).catch(() => 0) : 0,
    process.env.RESERVE_WALLET ? getBalance(process.env.RESERVE_WALLET).catch(() => 0) : 0,
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd").then(r => r.json()).then(j => +j.solana.usd || 0).catch(() => 0)
  ]);

  return {
    coins: coins.map(c => ({ mint: c.mint, t: c.ticker, n: c.name, img: imgUrl(c.img), mc: +c.mc, pool: sol(c.pool_lamports), calls: (round[c.mint] || []).reduce((a, r) => a + r.n, 0), createdAt: ms(c.created_at), paid: sol(c.paid_lamports), quote: c.quote, fee: +c.fee_pct, creator: c.creator, creatorU: nameOf(c.creator, callersBy), hist: histBy.get(c.mint) || [] })),
    round, callouts, callers: callerRows,
    payouts: pays.filter(p => p.kind === "payout").slice(0, 200).map(p => ({ u: nameOf(p.wallet, callersBy), w: p.wallet, coin: p.mint, sol: sol(p.lamports), pl: p.platform || "exposure", hold: +(+p.hold_pct || 0).toFixed(4), pnl: +((+p.pnl || 0) * 100).toFixed(1), at: ms(p.created_at), tx: p.tx || "" })),
    top20, top20Pool: sol(top20Bal), top20Wallet: top20Address() || "",
    reserve: { balance: sol(reserveBal), history: act.filter(a => a.kind === "reserve").map(a => ({ at: ms(a.at), added: sol(a.lamports) })).reverse().reduce((h, a) => { h.push({ ...a, total: (h.length ? h[h.length - 1].total : 0) + a.added }); return h; }, []) },
    activity: act.slice(0, 50).map(a => ({ kind: a.kind, coin: a.mint || "", w: a.wallet || "", sol: sol(a.lamports), tx: a.tx || "", at: ms(a.at) })),
    paidTotal: sol(pays.filter(p => p.kind === "payout").reduce((a, p) => a + +p.lamports, 0)),
    solUsd
  };
}

export async function buildWallet(w) {
  const [calls, callerRow, pays, coins, stars] = await Promise.all([
    db.select("callouts", `wallet=${eq(w)}&order=posted_at.desc&limit=500`),
    db.select("callers", `wallet=${eq(w)}`),
    db.select("payouts", `wallet=${eq(w)}&status=eq.sent&order=created_at.desc&limit=500`),
    db.select("coins", `creator=${eq(w)}&confirmed=eq.true&order=created_at.desc&limit=100`),
    db.select("caller_stars", `caller=${eq(w)}`)
  ]);
  const c = callerRow[0], now = Date.now();
  const e = { all: 0, d30: 0 }; for (const p of pays) if (p.kind === "payout") { e.all += +p.lamports; if (now - ms(p.created_at) < 30 * 864e5) e.d30 += +p.lamports; }
  const u = (c && (c.x_handle || c.username)) || (calls[0] && calls[0].username) || shortW(w);
  return {
    caller: { u, w, x: xOf(c), ...callerStats(w, calls, new Map([[w, e]]), new Map(stars.map(s => [s.caller, s])), now) },
    callouts: calls.slice(0, 200).map(k => ({ u, w, coin: k.mint, pl: k.platform, n: 1, hold: holdOf(k), pnl: pnlOf(k), note: k.note || "", sc: +k.weight, at: ms(k.posted_at) })),
    payouts: pays.filter(p => p.kind === "payout").map(p => ({ u, w, coin: p.mint, sol: sol(p.lamports), pl: p.platform || "exposure", hold: +(+p.hold_pct || 0).toFixed(4), pnl: +((+p.pnl || 0) * 100).toFixed(1), at: ms(p.created_at), tx: p.tx || "" })),
    coins: coins.map(k => ({ mint: k.mint, t: k.ticker, n: k.name, img: imgUrl(k.img), mc: +k.mc, pool: sol(k.pool_lamports), createdAt: ms(k.created_at), paid: sol(k.paid_lamports), quote: k.quote, fee: +k.fee_pct }))
  };
}
