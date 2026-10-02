import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pda, ata, isOnCurve, pk, compileV0, serializeTx, transfer, setComputeUnitPrice, WSOL, TOKEN } from "../lib/sol.js";
import { keypairFromSeed, b58decode, verifyEd25519 } from "../lib/keys.js";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

test("program-derived addresses match known pump.fun mainnet accounts", () => {
  assert.equal(pda(["global"], PUMP).toBase58(), "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
  assert.equal(pda(["__event_authority"], PUMP).toBase58(), "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
  assert.equal(pda(["mint-authority"], PUMP).toBase58(), "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
});

test("curve check: real public keys are on the curve, PDAs are not", () => {
  for (let i = 0; i < 20; i++) assert.ok(isOnCurve(b58decode(keypairFromSeed(crypto.randomBytes(32)).publicKey)));
  assert.ok(!isOnCurve(pda(["global"], PUMP).bytes));
});

test("v0 transaction: layout, ordering and signatures", () => {
  const a = keypairFromSeed(crypto.randomBytes(32)), b = keypairFromSeed(crypto.randomBytes(32));
  const bh = "11111111111111111111111111111111";
  const c = compileV0(a.publicKey, [setComputeUnitPrice(1000), transfer(a.publicKey, b.publicKey, 5000)], bh);
  assert.equal(c.message[0], 0x80);
  assert.deepEqual([...c.message.subarray(1, 4)], [1, 0, 2]); // 1 signer, 0 ro-signed, 2 ro-unsigned (both programs)
  assert.equal(c.accountKeys[0], a.publicKey);
  assert.equal(c.accountKeys[1], b.publicKey); // writable non-signer comes before read-only programs
  const raw = serializeTx(c, [a]);
  assert.equal(raw[0], 1);
  const sig = raw.subarray(1, 65), msg = raw.subarray(65);
  assert.ok(verifyEd25519(a.publicKey, msg, sig));
  assert.equal(msg[msg.length - 1], 0); // no lookup tables
});

test("missing signer leaves an empty slot for the wallet", () => {
  const user = keypairFromSeed(crypto.randomBytes(32)), mint = keypairFromSeed(crypto.randomBytes(32));
  const c = compileV0(user.publicKey, [{ programId: pk(PUMP), keys: [{ pubkey: pk(mint.publicKey), isSigner: true, isWritable: true }, { pubkey: pk(user.publicKey), isSigner: true, isWritable: true }], data: Buffer.from([1]) }], "11111111111111111111111111111111");
  assert.deepEqual(c.signerKeys, [user.publicKey, mint.publicKey]);
  const raw = serializeTx(c, [mint]);
  assert.equal(raw[0], 2);
  assert.ok(raw.subarray(1, 65).every(x => x === 0));
  assert.ok(verifyEd25519(mint.publicKey, raw.subarray(129), raw.subarray(65, 129)));
});

test("associated token address is deterministic and off-curve", () => {
  const owner = keypairFromSeed(crypto.randomBytes(32)).publicKey;
  const x = ata(owner, WSOL, TOKEN), y = ata(owner, WSOL, TOKEN);
  assert.equal(x.toBase58(), y.toBase58());
  assert.ok(!isOnCurve(x.bytes));
});

test("bonding curve parsing and market cap math", async () => {
  const { parseBondingCurve } = await import("../lib/chain.js");
  const b = Buffer.alloc(8 + 40 + 1 + 32);
  // pump.fun launch values: 1,073,000,000 virtual tokens, 30 virtual SOL, 1B supply
  b.writeBigUInt64LE(1_073_000_000_000_000n, 8); b.writeBigUInt64LE(30_000_000_000n, 16); b.writeBigUInt64LE(1_000_000_000_000_000n, 40);
  const bc = parseBondingCurve(b);
  const mcSol = (bc.vQuote / 1e9) / (bc.vToken / 1e6) * (bc.supply / 1e6);
  assert.ok(Math.abs(mcSol - 27.96) < 0.01); // ~28 SOL starting market cap, as on pump.fun
  assert.equal(bc.complete, false);
});

test("lookup-table compile: every instruction account decodes back to the right address and flags", async () => {
  const crypto = await import("node:crypto");
  process.env.POOL_MASTER_SEED ||= crypto.randomBytes(32).toString("hex");
  const sol = await import("../lib/sol.js"), c = await import("../lib/chain.js"), { keypairFromSeed, b58encode } = await import("../lib/keys.js");
  const user = keypairFromSeed(crypto.randomBytes(32)).publicKey, mint = keypairFromSeed(crypto.randomBytes(32)).publicKey, pool = c.poolKeypair(mint).publicKey;
  const ataIx = sol.ix(sol.ATA_PROGRAM, [sol.W(user, true), sol.W(sol.ata(user, mint, sol.TOKEN22)), sol.R(user), sol.R(mint), sol.R(sol.SYSTEM), sol.R(sol.TOKEN22)], [1]);
  const ixs = [sol.setComputeUnitLimit(600000), c.createV2Instruction({ mint, user, creator: pool, name: "N", symbol: "S", uri: "u" }), ataIx, c.buyExactSolInInstruction({ mint, user, creator: pool, lamports: 123 })];
  const lut = { address: "AddressLookupTab1e1111111111111111111111111", addresses: ["11111111111111111111111111111112", ...c.LAUNCH_LUT_ADDRESSES()] };
  const comp = sol.compileV0(user, ixs, "11111111111111111111111111111111", lut);
  // decode
  const m = comp.message; let o = 1; const [nSig, nSigRO, nRO] = [m[o], m[o + 1], m[o + 2]]; o += 3;
  const rd = () => { let v = 0, s = 0; for (;;) { const b = m[o++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) return v; s += 7; } };
  const nKeys = rd(), keys = []; for (let i = 0; i < nKeys; i++) { keys.push(b58encode(m.subarray(o, o + 32))); o += 32; } o += 32;
  const nIx = rd(), dec = []; for (let i = 0; i < nIx; i++) { const p = m[o++]; const n = rd(); const idx = [...m.subarray(o, o + n)]; o += n; const dl = rd(); o += dl; dec.push({ p, idx }); }
  assert.equal(rd(), 1); const tbl = b58encode(m.subarray(o, o + 32)); o += 32; assert.equal(tbl, lut.address);
  const nw = rd(), wi = [...m.subarray(o, o + nw)]; o += nw; const nr = rd(), ri = [...m.subarray(o, o + nr)]; o += nr; assert.equal(o, m.length);
  const all = [...keys, ...wi.map(i => lut.addresses[i]), ...ri.map(i => lut.addresses[i])];
  const isW = i => (i < nKeys ? (i < nSig ? i < nSig - nSigRO : i < nKeys - nRO) : i < nKeys + nw);
  ixs.forEach((ix, j) => {
    assert.equal(all[dec[j].p], ix.programId.toBase58()); assert.ok(dec[j].p < nKeys, "programs must be static");
    ix.keys.forEach((k, n) => { const i = dec[j].idx[n]; assert.equal(all[i], k.pubkey.toBase58()); if (k.isWritable) assert.ok(isW(i), "writable " + n); if (k.isSigner) assert.ok(i < nSig); });
  });
  assert.equal(c.buyExactSolInInstruction({ mint, user, creator: pool, lamports: 1 }).keys.length, 18);
});
