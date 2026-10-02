// Coins launched outside Exposure (straight on pump.fun) that are listed so holders can call them out here.
// Name, ticker, image and creator are read from the chain and the coin's own metadata file, never typed in by hand.
// Their creator fees go to whoever launched them on pump.fun, not to an Exposure pool wallet, so their pool only
// fills if someone sends SOL to the pool wallet shown on the coin page.
import { db, eq } from "./db.js";
import { rpc } from "./rpc.js";
import { pk, pda } from "./sol.js";
import { b58encode } from "./keys.js";
import { poolKeypair, parseBondingCurve, PUMP_PROGRAM } from "./chain.js";

export const EXTERNAL_COINS = [
  "66BhYPnx1JhqTz8N2HTzsodGDXCV5tDNcxbx2AHNpump" // $EXPO
];

const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const clean = s => String(s || "").replace(/\0/g, "").trim();

// Metaplex metadata account: key u8, update_authority 32, mint 32, then borsh strings name, symbol, uri.
function parseMetaplex(buf) {
  let o = 65; const str = () => { const n = buf.readUInt32LE(o); o += 4; const s = buf.subarray(o, o + n).toString("utf8"); o += n; return clean(s); };
  return { name: str(), symbol: str(), uri: str() };
}

async function onChainMeta(mint) {
  const acc = (await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }])).value;
  if (!acc) return null;
  const ext = ((acc.data.parsed || {}).info || {}).extensions || [];
  const tm = ext.find(e => e.extension === "tokenMetadata");
  if (tm && tm.state) return { name: clean(tm.state.name), symbol: clean(tm.state.symbol), uri: clean(tm.state.uri) };
  const mp = pda(["metadata", pk(METAPLEX), pk(mint)], METAPLEX).toBase58();
  const m = (await rpc("getAccountInfo", [mp, { encoding: "base64", commitment: "confirmed" }])).value;
  return m ? parseMetaplex(Buffer.from(m.data[0], "base64")) : null;
}

async function curveCreator(mint) {
  const bc = pda(["bonding-curve", pk(mint)], PUMP_PROGRAM).toBase58();
  const a = (await rpc("getAccountInfo", [bc, { encoding: "base64", commitment: "confirmed" }])).value;
  const p = a && parseBondingCurve(Buffer.from(a.data[0], "base64"));
  return p ? b58encode(p.creator) : null;
}

// Read-only preview for /api/health?external=1
export async function previewExternal(mint) { const meta = await onChainMeta(mint); return { meta, creator: await curveCreator(mint), inDb: (await db.select("coins", `mint=${eq(mint)}&select=mint`)).length > 0 }; }

// Called by the tick job. Adds any listed coin that isn't in the database yet.
export async function ensureExternalCoins() {
  const out = [];
  for (const mint of EXTERNAL_COINS) {
    if ((await db.select("coins", `mint=${eq(mint)}&select=mint`)).length) continue;
    const meta = await onChainMeta(mint);
    if (!meta || !meta.symbol) { out.push({ mint, error: "no_metadata" }); continue; }
    let j = {};
    if (/^https:\/\//.test(meta.uri)) j = await fetch(meta.uri, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => ({}));
    const tw = typeof j.twitter === "string" && /^https:\/\/(x|twitter)\.com\//.test(j.twitter) ? j.twitter : null;
    const creator = (await curveCreator(mint)) || "unknown";
    await db.insert("coins", [{
      mint, ticker: meta.symbol.replace(/^\$/, "").slice(0, 13), name: meta.name.slice(0, 32) || meta.symbol,
      img: typeof j.image === "string" && /^https:\/\//.test(j.image) ? j.image : null,
      description: typeof j.description === "string" ? j.description.slice(0, 500) : null, twitter: tw,
      quote: "SOL", fee_pct: 0.3, creator, pool_wallet: poolKeypair(mint).publicKey, confirmed: true
    }]);
    out.push({ mint, added: meta.symbol });
  }
  return out;
}
