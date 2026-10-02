// Serves coin pictures from IPFS through this site, cached at Vercel's edge for a year.
// Only real IPFS content IDs are accepted and only images are passed through.
import { send } from "../lib/http.js";

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;
const TYPES = /^image\/(png|jpeg|gif|webp)$/;

export default async function handler(req, res) {
  const cid = String((req.query && req.query.cid) || "");
  if (req.method !== "GET" || !CID.test(cid)) return send(res, 400, { error: "bad_cid" });
  const gw = (process.env.PINATA_GATEWAY || "gateway.pinata.cloud").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const r = await fetch(`https://${gw}/ipfs/${cid}`, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !TYPES.test(type)) return send(res, 404, { error: "not_image", upstream: r.status, type: type.slice(0, 60) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024) return send(res, 413, { error: "too_big" });
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.end(buf);
  } catch { send(res, 502, { error: "gateway" }); }
}
