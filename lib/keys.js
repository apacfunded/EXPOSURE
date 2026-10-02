// Base58 + ed25519 helpers built on Node's own crypto (no third-party code touches keys or signatures).
import crypto from "node:crypto";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = Object.fromEntries([...ALPHA].map((c, i) => [c, i]));

export function b58encode(bytes) {
  bytes = Uint8Array.from(bytes);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = ALPHA[Number(n % 58n)] + out; n /= 58n; }
  return "1".repeat(zeros) + out;
}

export function b58decode(str) {
  if (typeof str !== "string" || !str.length || str.length > 100) throw new Error("bad_b58");
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  let n = 0n;
  for (const c of str) { const v = MAP[c]; if (v === undefined) throw new Error("bad_b58"); n = n * 58n + BigInt(v); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  return Uint8Array.from([...new Array(zeros).fill(0), ...out]);
}

// A Solana address is exactly 32 bytes of base58.
export function isAddress(s) {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try { return b58decode(s).length === 32; } catch { return false; }
}

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function verifyEd25519(addressB58, messageBytes, sigBytes) {
  try {
    const pub = b58decode(addressB58);
    if (pub.length !== 32 || sigBytes.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pub)]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(messageBytes), key, Buffer.from(sigBytes));
  } catch { return false; }
}

// Keypair from a 32-byte seed. secretKey is the 64-byte Solana layout (seed + public key).
export function keypairFromSeed(seed) {
  if (seed.length !== 32) throw new Error("seed_len");
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  return { publicKey: b58encode(pub), secretKey: Uint8Array.from([...seed, ...pub]), sign: m => new Uint8Array(crypto.sign(null, Buffer.from(m), priv)) };
}

// Each coin gets its own pool wallet, derived from one master secret (POOL_MASTER_SEED, 64 hex chars, kept only in Vercel env).
// pump.fun keeps creator fees in one vault per creator, so a wallet per coin keeps every coin's pool separate and auditable.
export function poolWallet(masterHex, mint) {
  if (!/^[0-9a-f]{64}$/i.test(masterHex || "")) throw new Error("POOL_MASTER_SEED must be 64 hex characters");
  if (!isAddress(mint)) throw new Error("bad_mint");
  const seed = crypto.createHmac("sha256", Buffer.from(masterHex, "hex")).update("exposure-pool-v1:" + mint).digest();
  return keypairFromSeed(seed);
}

// Separate wallet that only pays network fees for fee claims. Derived from the same master secret.
export function opsWallet(masterHex) {
  if (!/^[0-9a-f]{64}$/i.test(masterHex || "")) throw new Error("POOL_MASTER_SEED must be 64 hex characters");
  return keypairFromSeed(crypto.createHmac("sha256", Buffer.from(masterHex, "hex")).update("exposure-ops-v1").digest());
}

// Holds the Top 20 bonus between daily payouts. Derived from the master secret so the daily job can pay it out.
export function top20Wallet(masterHex) {
  if (!/^[0-9a-f]{64}$/i.test(masterHex || "")) throw new Error("POOL_MASTER_SEED must be 64 hex characters");
  return keypairFromSeed(crypto.createHmac("sha256", Buffer.from(masterHex, "hex")).update("exposure-top20-v1").digest());
}

// Owns the launch lookup table and nothing else, so its short transaction history points straight at the table.
export function lutAuthority(masterHex) {
  if (!/^[0-9a-f]{64}$/i.test(masterHex || "")) throw new Error("POOL_MASTER_SEED must be 64 hex characters");
  return keypairFromSeed(crypto.createHmac("sha256", Buffer.from(masterHex, "hex")).update("exposure-lut-v1").digest());
}

export const sha256hex = s => crypto.createHash("sha256").update(s).digest("hex");
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
