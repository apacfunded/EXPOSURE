// Background jobs, called every few minutes by GitHub Actions with the CRON_SECRET (Vercel Hobby cron only runs daily).
//   /api/cron/tick    confirm launches, market caps, judge calls, pull callouts
//   /api/cron/claim   claim pump.fun creator fees into each coin's pool wallet
//   /api/cron/payout  pay any pool at 1 SOL+ (only when PAYOUTS_ENABLED=1; otherwise a dry run that shows what it would send)
import { db, eq } from "../../lib/db.js";
import { send, guard, cronAuthorized, paused } from "../../lib/http.js";
import { currentMcUsd } from "../../lib/mc.js";
import { tokenBalance } from "../../lib/rpc.js";
import { planPayout, planTop20, isWin, LAMPORTS, calloutScore } from "../../lib/payout.js";
import { rpc } from "../../lib/rpc.js";
import { claimFees, balance, sendFromPool, vaultBalances, sendFromTop20, top20Keypair } from "../../lib/chain.js";

const RENT_KEEP = 2_000_000; // leave a little in each pool wallet for rent + network fees

async function tick() {
  const out = { confirmed: 0, mc: 0, judged: 0, callouts: 0 };
  // 1) launches whose confirm call never arrived: live if the mint account exists on chain
  const pending = await db.select("coins", `confirmed=eq.false&created_at=lt.${new Date(Date.now() - 120e3).toISOString()}&created_at=gt.${new Date(Date.now() - 864e5).toISOString()}&limit=50`);
  for (const c of pending) {
    const acc = await rpc("getAccountInfo", [c.mint, { encoding: "base64", commitment: "confirmed" }]).catch(() => null);
    if (acc && acc.value) { await db.update("coins", `mint=${eq(c.mint)}`, { confirmed: true }); out.confirmed++; }
  }
  // 2) market caps + history
  const coins = await db.select("coins", "confirmed=eq.true&select=mint&limit=1000");
  const mints = coins.map(c => c.mint);
  const mcs = await currentMcUsd(mints);
  const t = new Date().toISOString();
  const hist = Object.entries(mcs).map(([mint, mc]) => ({ mint, t, mc }));
  if (hist.length) { await db.insert("mc_history", hist); out.mc = hist.length; }
  for (const [mint, mc] of Object.entries(mcs)) await db.update("coins", `mint=${eq(mint)}`, { mc });
  // 3) refresh every open Exposure callout: caller's holdings now, coin's PnL since the call, score
  const live = await db.select("callouts", "round_paid_at=is.null&platform=eq.exposure&limit=2000");
  for (const k of live) {
    const now = await tokenBalance(k.wallet, k.mint).catch(() => null);
    if (now === null) continue;
    const s = calloutScore({ tokensAtCall: +k.tokens_at_call, tokensNow: now, mcAtCall: +k.mc_at_call, mcNow: mcs[k.mint] || 0 });
    await db.update("callouts", `id=${eq(k.id)}`, { tokens_now: now, pnl: mcs[k.mint] ? +s.pnl.toFixed(4) : k.pnl, weight: s.score });
    out.callouts++;
  }
  // 4) peak within 24h, and the win/loss verdict once 24h have passed
  const open = await db.select("callouts", `won=is.null&posted_at=gt.${new Date(Date.now() - 3 * 864e5).toISOString()}&limit=2000`);
  for (const c of open) {
    if (!Number.isFinite(Date.parse(c.posted_at))) continue;
    const end = new Date(Date.parse(c.posted_at) + 864e5).toISOString();
    const h = await db.select("mc_history", `mint=${eq(c.mint)}&t=gte.${encodeURIComponent(new Date(c.posted_at).toISOString())}&t=lte.${end}&select=mc&order=mc.desc&limit=1`);
    const peak = h[0] ? +h[0].mc : 0, patch = {};
    if (peak > (+c.peak_mc_24h || 0)) patch.peak_mc_24h = peak;
    if (Date.now() > Date.parse(end)) { patch.won = isWin(+c.mc_at_call, Math.max(peak, +c.peak_mc_24h || 0)); out.judged++; }
    if (Object.keys(patch).length) await db.update("callouts", `id=${eq(c.id)}`, patch);
  }
  await db.rpc("cleanup", {}).catch(() => {});
  return out;
}

async function claim() {
  const coins = await db.select("coins", "confirmed=eq.true&limit=1000");
  const out = [];
  for (const c of coins) {
    let r;
    try { r = await claimFees(c.mint); if (r.sig) await db.insert("activity", [{ kind: "claim", mint: c.mint, wallet: c.pool_wallet, lamports: r.vault || 0, tx: r.sig }]); }
    catch (e) { r = { error: e.message }; }
    // pool shown on the site = SOL already in the pool wallet + fees still waiting in pump.fun's vaults
    const bal = await balance(c.pool_wallet).catch(() => null);
    const waiting = await vaultBalances(c.pool_wallet).then(v => v.bondingCurve + v.amm).catch(() => 0);
    if (bal !== null) await db.update("coins", `mint=${eq(c.mint)}`, { pool_lamports: Math.max(0, bal - RENT_KEEP) + waiting });
    out.push({ mint: c.mint, ...r });
  }
  return out;
}

async function payout() {
  const live = process.env.PAYOUTS_ENABLED === "1";
  const runCap = Math.round(Number(process.env.MAX_PAYOUT_SOL_PER_RUN || "5") * LAMPORTS);
  const { RESERVE_WALLET } = process.env;
  if (!RESERVE_WALLET) return { error: "RESERVE_WALLET must be set" };
  const TOP20_POOL = top20Keypair().publicKey; // the daily Top 20 job pays this out
  const coins = await db.select("coins", "confirmed=eq.true&limit=1000");
  const out = []; let sentThisRun = 0;
  for (const c of coins) {
    // a round that failed or stopped midway is never retried automatically: a person checks it first
    const stuck = await db.select("payout_rounds", `mint=${eq(c.mint)}&status=in.(sending,failed)&limit=1`);
    if (stuck.length) { out.push({ mint: c.mint, skipped: "needs_review", round: stuck[0].id }); continue; }
    const pool = Math.max(0, (await balance(c.pool_wallet)) - RENT_KEEP);
    const entries = (await db.select("callouts", `mint=${eq(c.mint)}&round_paid_at=is.null&limit=1000`)).map(k => ({ w: k.wallet, pl: k.platform, n: 1, wt: +k.weight, likes: 0, hold: Math.min(+k.tokens_at_call || 0, +k.tokens_now || 0) / 1e7, pnl: +k.pnl || 0 }));
    // merge multiple callouts by the same wallet+platform into one line with n = count
    const merged = new Map(); for (const e of entries) { const k = e.w + e.pl, m = merged.get(k); if (m) { m.n++; m.wt += e.wt; m.likes += e.likes; } else merged.set(k, { ...e }); }
    const plan = planPayout(pool, [...merged.values()]);
    if (!plan || !plan.sends.length) { out.push({ mint: c.mint, pool, skipped: !plan ? "under_1_sol" : "no_callers" }); continue; }
    const total = plan.total - plan.leftover;
    if (sentThisRun + total > runCap) { out.push({ mint: c.mint, skipped: "run_cap" }); continue; }
    if (!live) { out.push({ mint: c.mint, dryRun: true, plan }); continue; }

    // claim the round first: the unique (mint, round_no) row makes a double payout impossible
    const roundNo = c.round_no + 1;
    let round;
    try { round = (await db.insert("payout_rounds", [{ mint: c.mint, round_no: roundNo, pool_lamports: pool, plan, status: "sending" }]))[0]; }
    catch (e) { out.push({ mint: c.mint, skipped: "round_exists" }); continue; }
    await db.update("coins", `mint=${eq(c.mint)}`, { round_no: roundNo });
    const lines = [...plan.sends.map(s => ({ to: s.w, lamports: s.lamports, kind: "payout", pl: s.pl, hold: (merged.get(s.w + s.pl) || {}).hold || 0, pnl: (merged.get(s.w + s.pl) || {}).pnl || 0 })),
      { to: TOP20_POOL, lamports: plan.top20, kind: "top20" }, { to: RESERVE_WALLET, lamports: plan.reserve, kind: "reserve" }];
    await db.insert("payouts", lines.map(l => ({ round_id: round.id, mint: c.mint, wallet: l.to, platform: l.pl || null, hold_pct: l.hold || null, pnl: l.pnl ?? null, lamports: l.lamports, kind: l.kind })));
    try {
      const sigs = await sendFromPool(c.mint, lines);
      for (const { sig, batch } of sigs) for (const l of batch) {
        await db.update("payouts", `round_id=eq.${round.id}&wallet=${eq(l.to)}&kind=${eq(l.kind)}`, { tx: sig, status: "sent" });
        await db.insert("activity", [{ kind: l.kind, mint: c.mint, wallet: l.to, lamports: l.lamports, tx: sig }]);
      }
      const now = new Date().toISOString();
      await db.update("callouts", `mint=${eq(c.mint)}&round_paid_at=is.null`, { round_paid_at: now });
      await db.update("payout_rounds", `id=eq.${round.id}`, { status: "done", finished_at: now });
      await db.update("coins", `mint=${eq(c.mint)}`, { paid_lamports: (+c.paid_lamports || 0) + total });
      sentThisRun += total;
      out.push({ mint: c.mint, paid: total, txs: sigs.map(s => s.sig) });
    } catch (e) {
      // stop everything on the first failure; a person looks at it before anything else is sent
      await db.update("payout_rounds", `id=eq.${round.id}`, { status: "failed" });
      out.push({ mint: c.mint, error: e.message, sig: e.sig });
      break;
    }
  }
  return { live, results: out };
}

// Once a day: pay the Top 20 pool to the 20 best callers of the last 7 days (biggest gain within 24h of the call).
// #1 gets 20 shares, #20 gets 1. The unique day row means a day can never be paid twice.
async function top20() {
  const live = process.env.PAYOUTS_ENABLED === "1";
  const w = top20Keypair().publicKey;
  const pool = Math.max(0, (await balance(w)) - RENT_KEEP);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const calls = await db.select("callouts", `posted_at=gte.${since}&mc_at_call=gt.0&peak_mc_24h=gt.0&select=wallet,mc_at_call,peak_mc_24h&limit=5000`);
  const best = new Map();
  for (const c of calls) { const g = +c.peak_mc_24h / +c.mc_at_call; if (!best.has(c.wallet) || g > best.get(c.wallet)) best.set(c.wallet, g); }
  const ranked = [...best.entries()].filter(([, g]) => g > 1).sort((a, b) => b[1] - a[1]).map(([w, gain]) => ({ w, gain }));
  const plan = planTop20(pool, ranked);
  if (!plan.sends.length) return { live, pool, skipped: ranked.length ? "pool_too_small" : "no_ranked_callers" };
  if (!live) return { live, dryRun: true, pool, plan };
  const day = new Date().toISOString().slice(0, 10);
  try { await db.insert("top20_days", [{ day, pool_lamports: pool, plan, status: "sending" }]); }
  catch (e) { return { skipped: "already_paid_today", day }; }
  try {
    const sigs = await sendFromTop20(plan.sends.map(s => ({ to: s.w, lamports: s.lamports, rank: s.rank })));
    for (const { sig, batch } of sigs) for (const l of batch)
      await db.insert("activity", [{ kind: "top20", wallet: l.to, lamports: l.lamports, tx: sig }]);
    await db.update("top20_days", `day=eq.${day}`, { status: "done", finished_at: new Date().toISOString() });
    return { live, day, paid: plan.sends.length, txs: sigs.map(s => s.sig) };
  } catch (e) {
    await db.update("top20_days", `day=eq.${day}`, { status: "failed" });
    return { day, error: e.message, sig: e.sig };
  }
}

const JOBS = { tick, claim, payout, top20 };
export default guard(async (req, res) => {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  const job = JOBS[String(req.query.job || "")];
  if (!job) return send(res, 404, { error: "job" });
  if (paused() && req.query.job !== "tick") return send(res, 200, { paused: true });
  send(res, 200, await job());
});
