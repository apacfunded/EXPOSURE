import { db } from "../../lib/db.js";
import { isAddress } from "../../lib/keys.js";
import { send, allow, guard, sameOrigin, limited, paused } from "../../lib/http.js";

const MAX_BODY = 2.5 * 1024 * 1024, MAX_IMG = 2 * 1024 * 1024;

function imageType(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null; // SVG and everything else refused
}

async function pin(blob, filename) {
  const fd = new FormData(); fd.append("file", blob, filename); fd.append("network", "public");
  const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  const cid = j && j.data && j.data.cid;
  if (!r.ok || !cid) throw Object.assign(new Error("upload_failed"), { status: 502 });
  return `https://${process.env.PINATA_GATEWAY || "ipfs.io"}/ipfs/${cid}`;
}

// Prepares a launch. Returns a transaction the launcher's own wallet signs and pays for.
export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused() || process.env.LAUNCHES_ENABLED !== "1") return send(res, 503, { error: "Launches aren't open yet." });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "launch", 5, 3600)) return;

  // read the multipart body ourselves with a hard size cap
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, { error: "The image is too big. Keep it under 2 MB." }); chunks.push(c); }
  const form = await new Request("http://x/", { method: "POST", headers: { "content-type": req.headers["content-type"] || "" }, body: Buffer.concat(chunks) }).formData().catch(() => null);
  if (!form) return send(res, 400, { error: "bad_form" });
  const f = k => String(form.get(k) || "").trim();

  const name = f("name"), ticker = f("ticker").replace(/^\$/, ""), description = f("description"), twitter = f("twitter"), creator = f("creator");
  if (!name || name.length > 32) return send(res, 400, { error: "Names can be up to 32 characters." });
  if (!/^[A-Za-z0-9]{2,13}$/.test(ticker)) return send(res, 400, { error: "Tickers are 2 to 13 letters or numbers." });
  if (description.length > 500) return send(res, 400, { error: "Keep the description under 500 characters." });
  if (!isAddress(creator)) return send(res, 400, { error: "Connect your wallet first." });
  if (twitter && !/^(https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?|@?[A-Za-z0-9_]{1,15})$/.test(twitter)) return send(res, 400, { error: "That X link doesn't look right." });
  if (f("quote") && f("quote") !== "SOL") return send(res, 400, { error: "Stock pairs open soon. Pick SOL for now." });
  if (Number(f("devBuy") || 0) > 0) return send(res, 400, { error: "Dev buys open soon. Set it to 0 for now and buy right after launch." });

  const img = form.get("image");
  if (!img || typeof img.arrayBuffer !== "function" || img.size > MAX_IMG) return send(res, 400, { error: "Add an image under 2 MB." });
  const bytes = new Uint8Array(await img.arrayBuffer()), type = imageType(bytes);
  if (!type) return send(res, 400, { error: "Images must be PNG, JPG, GIF or WebP." });

  const imageUrl = await pin(new Blob([bytes], { type }), "image");
  const tw = twitter ? (twitter.startsWith("http") ? twitter : "https://x.com/" + twitter.replace(/^@/, "")) : undefined;
  const meta = { name, symbol: ticker, description, image: imageUrl, showName: true, createdOn: process.env.SITE_URL, ...(tw ? { twitter: tw } : {}), website: process.env.SITE_URL };
  const uri = await pin(new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
  if (uri.length > 200) return send(res, 500, { error: "server" });

  const { buildLaunchTx } = await import("../../lib/chain.js");
  const built = await buildLaunchTx({ user: creator, name, symbol: ticker, uri });
  await db.insert("coins", [{ mint: built.mint, ticker, name, img: imageUrl, description, twitter: tw || null, quote: "SOL", fee_pct: 0.3, creator, pool_wallet: built.poolWallet }]);
  send(res, 200, { tx: built.tx, mint: built.mint });
});
