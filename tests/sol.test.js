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
