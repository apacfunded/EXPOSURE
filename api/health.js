// Public health check: says which pieces are working. Never prints secret values, only whether they're set.
// ?sim=1 also dry-runs a launch transaction on mainnet (simulation only; nothing is sent or paid).
import { send, guard } from "../lib/http.js";

const ENV = ["SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SOLANA_RPC_URL", "POOL_MASTER_SEED", "CRON_SECRET", "PINATA_JWT", "TOP20_WALLET", "RESERVE_WALLET", "LAUNCHES_ENABLED", "PAYOUTS_ENABLED", "PAUSED"];
const run = async f => { try { return { ok: true, ...(await f()) }; } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 400) }; } };

export default guard(async (req, res) => {
  const env = Object.fromEntries(ENV.map(k => [k, !!process.env[k]]));
  const chain = await run(async () => ({ exports: Object.keys(await import("../lib/chain.js")) }));
  let opsWallet = null;
  try { opsWallet = (await import("../lib/keys.js")).opsWallet(process.env.POOL_MASTER_SEED).publicKey; } catch {}
  let simulation = null;
  if (req.query && req.query.sim === "1" && chain.ok) simulation = await run(async () => {
    const c = await import("../lib/chain.js"), s = await import("../lib/sol.js");
    // fee payer: a large public exchange wallet, used only so the simulation has SOL to spend on paper
    // &dev=0.1 adds a dev buy of that many SOL (max 1 here); &long=1 uses the longest name/ticker to check size
    const dev = Math.min(Math.max(Number(req.query.dev) || 0, 0), 1), long = req.query.long === "1";
    const b = await c.buildLaunchTx({ user: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", name: long ? "N".repeat(32) : "Sim Test", symbol: long ? "SIMTESTSIMTES" : "SIMT", uri: long ? "https://gateway.pinata.cloud/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy" : "https://example.com/m.json", devBuyLamports: Math.round(dev * 1e9) });
    const r = await s.rpc("simulateTransaction", [b.tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    return { devBuySol: dev, bytes: b.bytes, lut: dev ? ((await c.findLaunchLut().catch(() => null)) || {}).address || null : undefined, txErr: r.value.err, units: r.value.unitsConsumed, logs: (r.value.logs || []).slice(-14) };
  });
  // launch lookup table (needed for dev buys with long names)
  let lut = null;
  if (chain.ok) lut = await run(async () => { const c = await import("../lib/chain.js"); const t = await c.findLaunchLut(); return { address: t ? t.address : null, authority: (await import("../lib/keys.js")).lutAuthority(process.env.POOL_MASTER_SEED).publicKey }; });
  let external = null;
  if (req.query && req.query.external === "1") external = await run(async () => { const x = await import("../lib/external.js"); return { list: await Promise.all(x.EXTERNAL_COINS.map(m => x.previewExternal(m).catch(e => ({ mint: m, error: e.message })))) }; });
  // ?coin=MINT: public view of that coin's pool wallet and the creator fees waiting in pump.fun's vaults
  let coin = null;
  if (req.query && req.query.coin && chain.ok) coin = await run(async () => {
    const c = await import("../lib/chain.js"), s = await import("../lib/sol.js"), k = await import("../lib/keys.js");
    if (!k.isAddress(String(req.query.coin))) throw new Error("bad_mint");
    const pool = c.poolKeypair(String(req.query.coin)).publicKey;
    const v = await c.vaultBalances(pool);
    const curve = (await c.curveMarketCaps([String(req.query.coin)]))[String(req.query.coin)] || null;
    const claimSim = req.query.simclaim === "1" ? await c.claimFees(String(req.query.coin), 1, { simulate: true }).catch(e => ({ error: e.message })) : undefined;
    const { db, eq } = await import("../lib/db.js");
    const calls = await db.select("callouts", `mint=${eq(String(req.query.coin))}&order=posted_at.desc&limit=20&select=wallet,platform,tokens_at_call,tokens_now,pnl,weight,mc_at_call,posted_at,round_paid_at`).catch(e => ({ error: e.message, detail: e.detail }));
    const holder = req.query.holder && k.isAddress(String(req.query.holder)) ? await (await import("../lib/rpc.js")).tokenBalance(String(req.query.holder), String(req.query.coin)).catch(e => ({ error: e.message })) : undefined;
    return { holder: holder === undefined ? undefined : { wallet: String(req.query.holder), tokens: holder, enough: typeof holder === "number" && holder >= 1e9 * Number(process.env.CALLOUT_MIN_PCT || "0.01") / 100 }, calls, claimSim, curveMarketCapSol: curve && +curve.mcSol.toFixed(2), graduated: curve ? curve.complete : null, poolWallet: pool, poolBalanceSol: (await s.getBalance(pool)) / 1e9, unclaimedBondingCurveSol: v.bondingCurve / 1e9, unclaimedPumpSwapSol: v.amm / 1e9, opsBalanceSol: opsWallet ? (await s.getBalance(opsWallet)) / 1e9 : null };
  });
  // ?selftest=1: sign a callout with a throwaway key and run it through the real handler (never reaches the chain)
  let selftest = null;
  if (req.query && req.query.selftest === "1") selftest = await run(async () => {
    const crypto = await import("node:crypto"), k = await import("../lib/keys.js"), { Readable } = await import("node:stream");
    const kp = k.keypairFromSeed(crypto.randomBytes(32)), mint = String(req.query.coin || "");
    if (!k.isAddress(mint)) throw new Error("pass ?coin=MINT too");
    const message = ["Exposure callout", "Coin: " + mint, "Wallet: " + kp.publicKey, "Time: " + new Date().toISOString()].join("\n");
    const signature = Buffer.from(kp.sign(new TextEncoder().encode(message))).toString("base64");
    const body = JSON.stringify({ mint, wallet: kp.publicKey, message, signature });
    const r = Readable.from([Buffer.from(body)]); Object.assign(r, { method: "POST", headers: { host: req.headers.host, "content-type": "application/json" }, query: {} });
    const out = await new Promise(resolve => { const res2 = { statusCode: 200, h: {}, setHeader(a, b) { this.h[a] = b; }, end(b) { resolve({ status: this.statusCode, body: b && JSON.parse(b) }); }, get headersSent() { return false; } }; import("./callout.js").then(m => m.default(r, res2)); });
    return { status: out.status, body: out.body, expected: "403 with a 'Hold at least' message means signing, rate limiting and the holder check all work" };
  });
  send(res, 200, { node: process.version, opsWallet, launchesEnabled: process.env.LAUNCHES_ENABLED === "1", env, chain, lut, external, simulation, coin, selftest });
});
