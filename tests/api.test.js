// Handler tests with a fake database + RPC (global fetch is stubbed). No network, no real keys.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { keypairFromSeed } from "../lib/keys.js";

process.env.SUPABASE_URL = "https://db.test"; process.env.SUPABASE_SERVICE_KEY = "k"; process.env.SOLANA_RPC_URL = "https://rpc.test";
process.env.EXPO_MINT = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"; process.env.CRON_SECRET = "s".repeat(40);
process.env.SITE_URL = "https://exposure.test"; process.env.X_CLIENT_ID = "cid";

const T = { used_sigs: [], ratings: [], callouts: [{ wallet: "", mint: "m", platform: "pump" }], x_oauth: [], callers: [], coins: [], payouts: [], activity: [], caller_stars: [], mc_history: [] };
let expoBal = 10, calls = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push(url);
  const json = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });
  if (url.startsWith("https://rpc.test")) { const b = JSON.parse(opt.body); if (b.method === "getTokenAccountsByOwner") return json({ result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: expoBal } } } } } }] } }); return json({ result: { value: 0 } }); }
  if (url.startsWith("https://db.test/rest/v1/rpc/hit_rate_limit")) return json(true);
  if (url.startsWith("https://db.test/rest/v1/rpc/")) return json(null);
  const m = url.match(/rest\/v1\/([a-z_]+)/); const t = m && m[1];
  if (opt.method === "POST") { const rows = JSON.parse(opt.body); if (t === "used_sigs" && T.used_sigs.some(r => r.hash === rows[0].hash)) return json({ code: "23505" }, 409); T[t].push(...rows); return json(rows, 201); }
  if (opt.method === "PATCH" || opt.method === "DELETE") return json([]);
  return json(T[t] || []);
};

function call(handler, { method = "POST", body, query = {}, headers = {} }) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, query, headers: { host: "exposure.test", ...headers } });
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); }, get headersSent() { return false; } };
    handler(req, res);
  });
}

const rater = keypairFromSeed(crypto.randomBytes(32)), caller = keypairFromSeed(crypto.randomBytes(32));
T.callouts[0].wallet = caller.publicKey;
const signed = (lines, k = rater) => { const message = lines.join("\n"); return { wallet: k.publicKey, message, signature: Buffer.from(k.sign(new TextEncoder().encode(message))).toString("base64") }; };
const rateBody = (stars = 4) => ({ caller: caller.publicKey, stars, ...signed(["Exposure rating", `Caller: ${caller.publicKey}`, `Stars: ${stars}`, `Wallet: ${rater.publicKey}`, `Time: ${new Date().toISOString()}`]) });

test("rate: valid holder rating is saved; replay refused; non-holder refused; other origin refused; forged stars refused", async () => {
  const { default: rate } = await import("../api/rate.js");
  const b = rateBody(4);
  assert.equal((await call(rate, { body: b })).status, 200);
  assert.equal(T.ratings.length, 1);
  assert.equal((await call(rate, { body: b })).body.error, "replayed");
  expoBal = 0; assert.equal((await call(rate, { body: rateBody(5) })).body.error, "not_holder"); expoBal = 10;
  assert.equal((await call(rate, { body: rateBody(5), headers: { origin: "https://evil.test" } })).status, 403);
  const f = rateBody(5); f.stars = 1; assert.equal((await call(rate, { body: f })).status, 401);
  assert.equal((await call(rate, { method: "GET" })).status, 405);
});

test("x link: returns an x.com URL with PKCE and only same-site return paths", async () => {
  const { default: link } = await import("../api/x/link.js");
  const b = { ...signed(["Link an X account to Exposure", `Wallet: ${rater.publicKey}`, `Time: ${new Date().toISOString()}`]), returnTo: "https://evil.test/steal" };
  const r = await call(link, { body: b });
  assert.equal(r.status, 200);
  const u = new URL(r.body.url);
  assert.equal(u.hostname, "x.com"); assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(T.x_oauth.at(-1).return_to, "https://exposure.test/#me");
});

test("cron: refuses without the secret", async () => {
  const { default: cron } = await import("../api/cron/[job].js");
  assert.equal((await call(cron, { method: "GET", query: { job: "tick" } })).status, 401);
  assert.equal((await call(cron, { method: "GET", query: { job: "tick" }, headers: { authorization: "Bearer wrong" } })).status, 401);
});

test("state: builds the shape the site expects from an empty database", async () => {
  const { default: state } = await import("../api/state.js");
  const r = await call(state, { method: "GET" });
  assert.equal(r.status, 200);
  for (const k of ["coins", "round", "callouts", "callers", "payouts", "top20", "reserve", "activity"]) assert.ok(k in r.body, k);
});

test("wallet: rejects junk addresses", async () => {
  const { default: w } = await import("../api/wallet/[addr].js");
  assert.equal((await call(w, { method: "GET", query: { addr: "<script>" } })).status, 400);
  assert.equal((await call(w, { method: "GET", query: { addr: rater.publicKey } })).status, 200);
});
