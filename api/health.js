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
    const b = await c.buildLaunchTx({ user: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", name: "Sim Test", symbol: "SIMT", uri: "https://example.com/m.json" });
    const r = await s.rpc("simulateTransaction", [b.tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    return { txErr: r.value.err, units: r.value.unitsConsumed, logs: (r.value.logs || []).slice(-14) };
  });
  // ?coin=MINT: public view of that coin's pool wallet and the creator fees waiting in pump.fun's vaults
  let coin = null;
  if (req.query && req.query.coin && chain.ok) coin = await run(async () => {
    const c = await import("../lib/chain.js"), s = await import("../lib/sol.js"), k = await import("../lib/keys.js");
    if (!k.isAddress(String(req.query.coin))) throw new Error("bad_mint");
    const pool = c.poolKeypair(String(req.query.coin)).publicKey;
    const v = await c.vaultBalances(pool);
    const curve = (await c.curveMarketCaps([String(req.query.coin)]))[String(req.query.coin)] || null;
    const claimSim = req.query.simclaim === "1" ? await c.claimFees(String(req.query.coin), 1, { simulate: true }).catch(e => ({ error: e.message })) : undefined;
    return { claimSim, curveMarketCapSol: curve && +curve.mcSol.toFixed(2), graduated: curve ? curve.complete : null, poolWallet: pool, poolBalanceSol: (await s.getBalance(pool)) / 1e9, unclaimedBondingCurveSol: v.bondingCurve / 1e9, unclaimedPumpSwapSol: v.amm / 1e9, opsBalanceSol: opsWallet ? (await s.getBalance(opsWallet)) / 1e9 : null };
  });
  send(res, 200, { node: process.version, opsWallet, launchesEnabled: process.env.LAUNCHES_ENABLED === "1", env, chain, simulation, coin });
});
