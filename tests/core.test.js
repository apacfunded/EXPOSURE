import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { b58encode, b58decode, isAddress, verifyEd25519, keypairFromSeed, poolWallet } from "../lib/keys.js";
import { parseSigned } from "../lib/auth.js";
import { planPayout, LAMPORTS, CAP_LAMPORTS, isWin, wilson } from "../lib/payout.js";

const kp = keypairFromSeed(crypto.randomBytes(32));
const signMsg = (msg, k = kp) => Buffer.from(k.sign(new TextEncoder().encode(msg))).toString("base64");

test("base58 round trip and known address", () => {
  const sys = "11111111111111111111111111111111";
  assert.equal(b58decode(sys).length, 32);
  assert.equal(b58encode(b58decode(sys)), sys);
  assert.ok(isAddress("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"));
  assert.ok(!isAddress("not-an-address"));
  assert.ok(!isAddress("0OIl" + "1".repeat(40)));
});

test("ed25519 sign/verify; tampered message or wrong key fails", () => {
  const m = new TextEncoder().encode("hello");
  const sig = kp.sign(m);
  assert.ok(verifyEd25519(kp.publicKey, m, sig));
  assert.ok(!verifyEd25519(kp.publicKey, new TextEncoder().encode("hellO"), sig));
  assert.ok(!verifyEd25519(keypairFromSeed(crypto.randomBytes(32)).publicKey, m, sig));
});

test("pool wallets: deterministic per coin, different per coin, need the master seed", () => {
  const master = crypto.randomBytes(32).toString("hex"), a = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", b = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
  assert.equal(poolWallet(master, a).publicKey, poolWallet(master, a).publicKey);
  assert.notEqual(poolWallet(master, a).publicKey, poolWallet(master, b).publicKey);
  assert.notEqual(poolWallet(master, a).publicKey, poolWallet(crypto.randomBytes(32).toString("hex"), a).publicKey);
  assert.throws(() => poolWallet("short", a));
});

test("signed messages: valid passes; expired, wrong wallet, wrong first line, tampered, reused fields fail", () => {
  const now = Date.now();
  const msg = `Exposure rating\nCaller: X\nStars: 5\nWallet: ${kp.publicKey}\nTime: ${new Date(now).toISOString()}`;
  const ok = parseSigned({ wallet: kp.publicKey, message: msg, signature: signMsg(msg) }, "Exposure rating", now);
  assert.ok(ok.ok); assert.equal(ok.fields.Stars, "5");
  assert.equal(parseSigned({ wallet: kp.publicKey, message: msg, signature: signMsg(msg) }, "Exposure rating", now + 6 * 60e3).error, "expired");
  assert.equal(parseSigned({ wallet: kp.publicKey, message: msg, signature: signMsg(msg) }, "Link an X account to Exposure", now).error, "bad_message");
  const other = keypairFromSeed(crypto.randomBytes(32));
  assert.equal(parseSigned({ wallet: other.publicKey, message: msg, signature: signMsg(msg) }, "Exposure rating", now).error, "bad_message");
  const forged = msg.replace("Stars: 5", "Stars: 1");
  assert.equal(parseSigned({ wallet: kp.publicKey, message: forged, signature: signMsg(msg) }, "Exposure rating", now).error, "bad_signature");
  const dup = msg + `\nWallet: ${other.publicKey}`;
  assert.equal(parseSigned({ wallet: kp.publicKey, message: dup, signature: signMsg(dup) }, "Exposure rating", now).error, "bad_message");
  const future = `Exposure rating\nWallet: ${kp.publicKey}\nTime: ${new Date(now + 10 * 60e3).toISOString()}`;
  assert.equal(parseSigned({ wallet: kp.publicKey, message: future, signature: signMsg(future) }, "Exposure rating", now).error, "expired");
});

test("payout: nothing under 1 SOL; split adds up; never more than the pool; cap holds", () => {
  assert.equal(planPayout(0.99 * LAMPORTS, [{ w: "a", pl: "pump", n: 1, wt: 10 }]), null);
  const entries = [{ w: "a", pl: "pump", n: 1, wt: 100 }, { w: "b", pl: "fomo", n: 3, wt: 20 }, { w: "c", pl: "gmgn", n: 1, wt: 1 }];
  const p = planPayout(2 * LAMPORTS, entries);
  const sent = p.sends.reduce((a, s) => a + s.lamports, 0);
  assert.equal(p.top20, 0.2 * LAMPORTS); assert.equal(p.reserve, 0.4 * LAMPORTS);
  assert.ok(sent <= 1.4 * LAMPORTS);
  assert.equal(sent + p.top20 + p.reserve + p.leftover, 2 * LAMPORTS);
  assert.ok(p.leftover >= 0);
  for (const s of p.sends) assert.ok(s.lamports <= CAP_LAMPORTS);
  const solo = planPayout(10 * LAMPORTS, [{ w: "a", pl: "pump", n: 1, wt: 5 }]);
  assert.equal(solo.sends[0].lamports, CAP_LAMPORTS);
  assert.equal(solo.leftover, 10 * LAMPORTS - CAP_LAMPORTS - solo.top20 - solo.reserve);
});

test("payout: junk entries are ignored, duplicate wallets paid once", () => {
  const p = planPayout(1 * LAMPORTS, [{ w: "a", pl: "pump", n: 1, wt: 5 }, { w: "a", pl: "pump", n: 1, wt: 9 }, { w: "x", pl: "evil", n: 1, wt: 1e9 }, { w: "y", pl: "pump", n: 1, wt: -5 }, { w: "z", pl: "pump", n: 1, wt: NaN }]);
  assert.equal(p.sends.length, 1); assert.equal(p.sends[0].w, "a");
});

test("wins and ranks", () => {
  assert.ok(isWin(10000, 15000)); assert.ok(!isWin(10000, 14999)); assert.ok(!isWin(0, 1e9));
  assert.ok(wilson(8, 10) < 0.8 && wilson(8, 10) > 0.5); assert.equal(wilson(0, 0), 0);
});

test("callout score: holdings × PnL, whale cap, sellers get nothing", async () => {
  const { calloutScore } = await import("../lib/payout.js");
  const a = calloutScore({ tokensAtCall: 1e6, tokensNow: 1e6, mcAtCall: 10000, mcNow: 20000 }); // 0.1% held, +100%
  assert.ok(Math.abs(a.holdPct - 0.1) < 1e-9); assert.ok(Math.abs(a.pnl - 1) < 1e-9);
  assert.ok(Math.abs(a.score - Math.sqrt(0.1) * 2) < 1e-9);
  const whale = calloutScore({ tokensAtCall: 5e7, tokensNow: 5e7, mcAtCall: 1, mcNow: 1 }); // 5% held -> capped at 1%
  assert.equal(whale.holdPct, 1);
  assert.equal(calloutScore({ tokensAtCall: 1e6, tokensNow: 0, mcAtCall: 1, mcNow: 9 }).score, 0); // sold out
  const bought = calloutScore({ tokensAtCall: 1e6, tokensNow: 9e6, mcAtCall: 1, mcNow: 1 }); // buying more after the call doesn't count
  assert.ok(Math.abs(bought.holdPct - 0.1) < 1e-9);
  assert.equal(calloutScore({ tokensAtCall: 1e6, tokensNow: 1e6, mcAtCall: 100, mcNow: 50 }).pnl, 0); // losses floor at 0
  assert.equal(calloutScore({ tokensAtCall: 1e6, tokensNow: 1e6, mcAtCall: 1, mcNow: 100 }).pnl, 4); // capped at +400%
});
