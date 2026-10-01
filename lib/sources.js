// Where callouts come from. Each source returns [{id, platform, wallet, username, mint, likes, holder_likes, weight, mc_at_call, posted_at}].
//
// STATUS (Oct 2026): none of pump.fun, Fomo or GMGN publishes an API that lists callouts together with
// WHO liked them, which the holder-weighted payout needs. pump.fun's callout endpoints are private
// (login token required); Fomo's only API is unofficial with no likes; GMGN's Callout OpenAPI is
// partner-only (apply at docs.gmgn.ai). Until a source is approved, these return nothing and no payouts
// are made — fees simply keep building in each coin's pool wallet, untouched.

export async function pumpCallouts(/* mints */) { return []; }

export async function fomoCallouts(/* mints */) { return []; }

// GMGN partner API (AK/SK HMAC). Fill in once GMGN approves the partner application.
export async function gmgnCallouts(/* mints */) {
  if (!process.env.GMGN_AK || !process.env.GMGN_SK) return [];
  return [];
}

export async function allCallouts(mints) {
  const r = await Promise.allSettled([pumpCallouts(mints), fomoCallouts(mints), gmgnCallouts(mints)]);
  return r.flatMap(x => (x.status === "fulfilled" ? x.value : []));
}

// Current market caps from DexScreener (free, no key, 300 req/min). Up to 30 mints per call.
export async function marketCaps(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`).then(r => r.json()).catch(() => []);
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const m = p && p.baseToken && p.baseToken.address, mc = +(p.marketCap || p.fdv || 0);
      if (m && mc > 0 && (!out[m] || mc > out[m])) out[m] = mc;
    }
  }
  return out;
}
