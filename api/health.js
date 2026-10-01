// Public health check: says which pieces are working. Never prints secret values, only whether they're set.
import { send, guard } from "../lib/http.js";

const ENV = ["SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SOLANA_RPC_URL", "POOL_MASTER_SEED", "CRON_SECRET", "PINATA_JWT", "TOP20_WALLET", "RESERVE_WALLET", "LAUNCHES_ENABLED", "PAYOUTS_ENABLED", "PAUSED"];
const tryImport = async m => { try { const x = await import(m); return { ok: true, exports: Object.keys(x).slice(0, 12) }; } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 300) }; } };

export default guard(async (req, res) => {
  const env = Object.fromEntries(ENV.map(k => [k, !!process.env[k]]));
  const modules = { web3: await tryImport("@solana/web3.js"), pumpSdk: await tryImport("@pump-fun/pump-sdk"), chain: await tryImport("../lib/chain.js") };
  send(res, 200, { node: process.version, launchesEnabled: process.env.LAUNCHES_ENABLED === "1", env, modules });
});
