// Public health check: says which pieces are working. Never prints secret values, only whether they're set.
import { send, guard } from "../lib/http.js";

const ENV = ["SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SOLANA_RPC_URL", "POOL_MASTER_SEED", "CRON_SECRET", "PINATA_JWT", "TOP20_WALLET", "RESERVE_WALLET", "LAUNCHES_ENABLED", "PAYOUTS_ENABLED", "PAUSED"];

const check = async f => { try { const m = await f(); return { ok: true, keys: Object.keys(m).slice(0, 15) }; } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 400) }; } };

export default guard(async (req, res) => {
  const env = Object.fromEntries(ENV.map(k => [k, !!process.env[k]]));
  const modules = {
    chain: await check(() => import("../lib/chain.js"))
  };
  let opsWallet = null, launchBuild = null;
  try { opsWallet = (await import("../lib/keys.js")).opsWallet(process.env.POOL_MASTER_SEED).publicKey; } catch {}
  if (modules.chain.ok) launchBuild = await check(async () => { const c = await import("../lib/chain.js"); const b = await c.buildLaunchTx({ user: "11111111111111111111111111111112", name: "Test", symbol: "TEST", uri: "https://example.com/m.json" }); return { bytes: Buffer.from(b.tx, "base64").length, mintOk: !!b.mint, poolOk: !!b.poolWallet }; });
  send(res, 200, { node: process.version, opsWallet, launchBuild, launchesEnabled: process.env.LAUNCHES_ENABLED === "1", env, modules });
});
