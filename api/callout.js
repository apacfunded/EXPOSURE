import { db, eq, useSignatureOnce } from "../lib/db.js";
import { parseSigned } from "../lib/auth.js";
import { tokenBalance } from "../lib/rpc.js";
import { isAddress } from "../lib/keys.js";
import { currentMcUsd } from "../lib/mc.js";
import { calloutScore } from "../lib/payout.js";
import { send, allow, guard, readJson, sameOrigin, limited, paused } from "../lib/http.js";

// Post a callout on Exposure. Signed by the caller's wallet, which must hold the coin.
// One open callout per wallet per coin each round. Score = holdings × PnL (see lib/payout.js).
const MIN_PCT = () => Number(process.env.CALLOUT_MIN_PCT || "0.01"); // minimum bag, % of supply (0.01% = 100k tokens)

export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused()) return send(res, 503, { error: "Callouts are paused right now." });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "callout", 10, 600)) return;
  const b = await readJson(req);
  if (!isAddress(b.mint)) return send(res, 400, { error: "bad_request" });
  const v = parseSigned(b, "Exposure callout");
  if (v.error) return send(res, 401, { error: v.error === "expired" ? "That signature expired. Try again." : "Your wallet signature didn't check out. Try again." });
  if (v.fields.Coin !== b.mint) return send(res, 401, { error: "Your wallet signature didn't check out. Try again." });
  const note = String(v.fields.Note || "").slice(0, 140);

  const coin = (await db.select("coins", `mint=${eq(b.mint)}&confirmed=eq.true`))[0];
  if (!coin) return send(res, 404, { error: "That coin isn't on Exposure." });
  const held = await tokenBalance(b.wallet, b.mint);
  if (held < 1e9 * MIN_PCT() / 100) return send(res, 403, { error: `Hold at least ${(1e9 * MIN_PCT() / 100).toLocaleString("en-US")} $${coin.ticker} to call it out.` });
  const open = await db.select("callouts", `wallet=${eq(b.wallet)}&mint=${eq(b.mint)}&round_paid_at=is.null&limit=1`);
  if (open.length) return send(res, 409, { error: "You've already called this coin this round. Your callout stays in until the next payout." });
  if (!(await useSignatureOnce(v.sigHash, "callout"))) return send(res, 409, { error: "replayed" });

  const mc = (await currentMcUsd([b.mint]))[b.mint] || +coin.mc || 0;
  const s = calloutScore({ tokensAtCall: held, tokensNow: held, mcAtCall: mc, mcNow: mc });
  const row = { id: `exposure:${b.mint}:${b.wallet}:${Date.now()}`, platform: "exposure", wallet: b.wallet, mint: b.mint, note,
    likes: 0, holder_likes: 0, weight: s.score, tokens_at_call: held, tokens_now: held, pnl: 0, mc_at_call: mc, posted_at: new Date().toISOString() };
  try { await db.insert("callouts", [row]); }
  catch (e) { if (e.status === 409) return send(res, 409, { error: "You've already called this coin this round." }); throw e; }
  await db.insert("callers", [{ wallet: b.wallet }], { upsert: true, onConflict: "wallet" }).catch(() => {});
  send(res, 200, { ok: true, holdPct: s.holdPct, mc });
});
