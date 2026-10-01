import crypto from "node:crypto";
import { db, useSignatureOnce } from "../../lib/db.js";
import { parseSigned } from "../../lib/auth.js";
import { send, allow, guard, readJson, sameOrigin, limited, paused } from "../../lib/http.js";

const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Step 1 of linking X: the wallet signs, we start X sign-in (OAuth 2.0 with PKCE) and send the browser to x.com.
export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused()) return send(res, 503, { error: "paused" });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "xlink", 10, 600)) return;
  const { X_CLIENT_ID, SITE_URL } = process.env;
  if (!X_CLIENT_ID || !SITE_URL) return send(res, 503, { error: "x_not_ready" });
  const b = await readJson(req);
  const v = parseSigned(b, "Link an X account to Exposure");
  if (v.error) return send(res, 401, { error: v.error });
  if (!(await useSignatureOnce(v.sigHash, "xlink"))) return send(res, 409, { error: "replayed" });

  const site = new URL(SITE_URL);
  let back = site.origin + "/#me";
  try { const r = new URL(String(b.returnTo || "")); if (r.origin === site.origin) back = r.origin + r.pathname + "#me"; } catch {}

  const state = b64url(crypto.randomBytes(24)), verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  await db.insert("x_oauth", [{ state, wallet: b.wallet, verifier, return_to: back }]);
  const q = new URLSearchParams({ response_type: "code", client_id: X_CLIENT_ID, redirect_uri: site.origin + "/api/x/callback", scope: "users.read tweet.read", state, code_challenge: challenge, code_challenge_method: "S256" });
  send(res, 200, { url: "https://x.com/i/oauth2/authorize?" + q });
});
