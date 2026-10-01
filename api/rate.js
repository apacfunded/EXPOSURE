import { db, eq, useSignatureOnce } from "../lib/db.js";
import { parseSigned } from "../lib/auth.js";
import { tokenBalance } from "../lib/rpc.js";
import { isAddress } from "../lib/keys.js";
import { send, allow, guard, readJson, sameOrigin, limited, paused } from "../lib/http.js";

// Rate a ranked caller 1-5 stars. Signed by the rater's wallet, which must hold $EXPO. One rating per wallet per caller (re-rating replaces it).
export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused()) return send(res, 503, { error: "paused" });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "rate", 20, 600)) return;
  const b = await readJson(req);
  const stars = Number(b.stars);
  if (!isAddress(b.caller) || !Number.isInteger(stars) || stars < 1 || stars > 5) return send(res, 400, { error: "bad_request" });
  if (b.caller === b.wallet) return send(res, 400, { error: "self_rating" });
  const v = parseSigned(b, "Exposure rating");
  if (v.error) return send(res, 401, { error: v.error });
  if (v.fields.Caller !== b.caller || v.fields.Stars !== String(stars)) return send(res, 401, { error: "bad_message" });

  const mint = process.env.EXPO_MINT;
  if (!mint) return send(res, 503, { error: "ratings_closed" });
  const min = Number(process.env.RATE_MIN_EXPO || "1");
  if ((await tokenBalance(b.wallet, mint)) < min) return send(res, 403, { error: "not_holder" });
  if (!(await useSignatureOnce(v.sigHash, "rate"))) return send(res, 409, { error: "replayed" });

  // only callers that are actually on the site can be rated
  const known = await db.select("callouts", `wallet=${eq(b.caller)}&limit=1`);
  if (!known.length) return send(res, 404, { error: "unknown_caller" });

  await db.insert("ratings", [{ caller: b.caller, rater: b.wallet, stars, updated_at: new Date().toISOString() }], { upsert: true, onConflict: "caller,rater" });
  const s = (await db.select("caller_stars", `caller=${eq(b.caller)}`))[0] || { stars: 0, stars_n: 0 };
  send(res, 200, { stars: +s.stars, starsN: +s.stars_n });
});
