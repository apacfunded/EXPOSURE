import { db, eq } from "../../lib/db.js";
import { guard } from "../../lib/http.js";

// Step 2 of linking X: X sends the browser back here. We swap the code for a token, read the user's
// handle, name and picture once, save them against the wallet, and throw the token away.
export default guard(async (req, res) => {
  const { X_CLIENT_ID, X_CLIENT_SECRET, SITE_URL } = process.env;
  const site = new URL(SITE_URL).origin;
  const go = u => { res.statusCode = 302; res.setHeader("Location", u); res.setHeader("Cache-Control", "no-store"); res.end(); };
  const state = String(req.query.state || ""), code = String(req.query.code || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(state)) return go(site + "/#me");
  const rows = await db.select("x_oauth", `state=${eq(state)}`);
  const row = rows[0];
  if (row) await db.remove("x_oauth", `state=${eq(state)}`); // single use
  if (!row || Date.now() - Date.parse(row.created_at) > 10 * 60 * 1000 || !code || req.query.error) return go(site + "/#me");

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (X_CLIENT_SECRET) headers.Authorization = "Basic " + Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64");
  const tok = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers, body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: X_CLIENT_ID, redirect_uri: site + "/api/x/callback", code_verifier: row.verifier }) }).then(r => r.json());
  if (!tok.access_token) return go(row.return_to);
  const me = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url,name,username", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
  const u = me && me.data;
  if (!u || !/^[A-Za-z0-9_]{1,15}$/.test(u.username || "")) return go(row.return_to);
  const avatar = /^https:\/\/pbs\.twimg\.com\//.test(u.profile_image_url || "") ? u.profile_image_url.replace("_normal.", "_200x200.") : "";

  // one X account per wallet: unlink it from any other wallet first
  await db.update("callers", `x_id=${eq(u.id)}`, { x_id: null, x_handle: null, x_name: null, x_avatar: null });
  await db.insert("callers", [{ wallet: row.wallet, x_id: u.id, x_handle: u.username, x_name: String(u.name || u.username).slice(0, 50), x_avatar: avatar }], { upsert: true, onConflict: "wallet" });
  go(row.return_to);
});
