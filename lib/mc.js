// Current market cap in USD: pump.fun bonding curve for coins still on the curve, DexScreener after graduation.
import { curveMarketCaps } from "./chain.js";
import { marketCaps } from "./sources.js";

export const solUsd = () => fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd").then(r => r.json()).then(j => +j.solana.usd || 0).catch(() => 0);

export async function currentMcUsd(mints) {
  if (!mints.length) return {};
  const [px, curve] = await Promise.all([solUsd(), curveMarketCaps(mints).catch(() => ({}))]);
  const out = {};
  for (const [m, v] of Object.entries(curve)) if (!v.complete && px) out[m] = Math.round(v.mcSol * px);
  const rest = mints.filter(m => !(m in out));
  if (rest.length) Object.assign(out, await marketCaps(rest).catch(() => ({})));
  return out;
}
