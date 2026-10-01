// Shared request helpers: JSON replies, method checks, body limits, client IP, cron auth, kill switch.
import { safeEqual, sha256hex } from "./keys.js";
import { rateLimit } from "./db.js";

export function send(res, status, obj, { cache = "no-store" } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(obj));
}

export const allow = (req, res, method) => { if (req.method !== method) { res.setHeader("Allow", method); send(res, 405, { error: "method" }); return false; } return true; };

// Read a JSON body ourselves with a hard size cap.
export async function readJson(req, max = 8 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) { if (JSON.stringify(req.body).length > max) throw Object.assign(new Error("too_big"), { status: 413 }); return req.body; }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("too_big"), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}

// Same-origin only for writes: the site and the API share one domain, so any other Origin is refused.
export function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true; // wallets/servers without Origin still need a valid signature
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try { return new URL(o).host === host; } catch { return false; }
}

export const clientIp = req => String(req.headers["x-real-ip"] || (req.headers["x-forwarded-for"] || "").split(",")[0] || "0").trim();

export async function limited(req, res, name, max, windowSec) {
  try { if (await rateLimit(`${name}:${sha256hex(clientIp(req))}`, max, windowSec)) return false; }
  catch { /* if the limiter is down, fail closed for writes */ send(res, 503, { error: "busy" }); return true; }
  send(res, 429, { error: "slow_down" }); return true;
}

export function cronAuthorized(req) {
  const s = process.env.CRON_SECRET; if (!s || s.length < 32) return false;
  return safeEqual(req.headers.authorization || "", `Bearer ${s}`);
}

// Kill switch: set PAUSED=1 in Vercel env and every write and payout stops on the next request.
export const paused = () => process.env.PAUSED === "1";

export function guard(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) { console.error(e && e.message, e && e.detail); if (!res.headersSent) send(res, e.status && e.status < 500 ? e.status : 500, { error: e.status && e.status < 500 ? e.message : "server" }); }
  };
}
