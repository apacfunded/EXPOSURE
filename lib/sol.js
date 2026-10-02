// Minimal Solana toolkit with no third-party code: addresses, program-derived addresses, v0 transactions,
// signing and JSON-RPC. Everything here is covered by tests/sol.test.js against known mainnet addresses.
import crypto from "node:crypto";
import { b58encode, b58decode } from "./keys.js";

// ---------- public keys ----------
export class Pk {
  constructor(v) { this.bytes = typeof v === "string" ? b58decode(v) : Uint8Array.from(v); if (this.bytes.length !== 32) throw new Error("bad_pubkey"); }
  toBase58() { return b58encode(this.bytes); }
  toString() { return this.toBase58(); }
  equals(o) { return Buffer.from(this.bytes).equals(Buffer.from(o.bytes)); }
}
export const pk = v => (v instanceof Pk ? v : new Pk(v));

// ed25519 "is this 32-byte string a valid curve point?" (same test Solana uses for program-derived addresses)
const P = 2n ** 255n - 19n;
const modp = a => ((a % P) + P) % P;
const pow = (b, e) => { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const D = modp(-121665n * pow(121666n, P - 2n));
export function isOnCurve(bytes) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = y * y % P, u = modp(y2 - 1n), v = modp(D * y2 + 1n);
  if (v === 0n) return u === 0n;
  const x2 = u * pow(v, P - 2n) % P;
  if (x2 === 0n) return true;
  return pow(x2, (P - 1n) / 2n) === 1n;
}

const seedBuf = s => (typeof s === "string" ? Buffer.from(s, "utf8") : s instanceof Pk ? Buffer.from(s.bytes) : Buffer.from(s));
export function findPda(seeds, programId) {
  const prog = pk(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const s of seeds) h.update(seedBuf(s));
    h.update(Buffer.from([bump])); h.update(Buffer.from(prog.bytes)); h.update(Buffer.from("ProgramDerivedAddress"));
    const out = h.digest();
    if (!isOnCurve(out)) return [new Pk(out), bump];
  }
  throw new Error("no_pda");
}
export const pda = (seeds, programId) => findPda(seeds, programId)[0];

export const SYSTEM = pk("11111111111111111111111111111111");
export const COMPUTE_BUDGET = pk("ComputeBudget111111111111111111111111111111");
export const TOKEN = pk("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN22 = pk("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ATA_PROGRAM = pk("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const WSOL = pk("So11111111111111111111111111111111111111112");
export const ata = (owner, mint, tokenProgram) => pda([pk(owner), pk(tokenProgram), pk(mint)], ATA_PROGRAM);

// ---------- instructions ----------
export const ix = (programId, keys, data) => ({ programId: pk(programId), keys: keys.map(k => ({ ...k, pubkey: pk(k.pubkey) })), data: Buffer.from(data) });
export const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
export const R = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const setComputeUnitLimit = units => ix(COMPUTE_BUDGET, [], Buffer.concat([Buffer.from([2]), u32(units)]));
export const setComputeUnitPrice = micro => ix(COMPUTE_BUDGET, [], Buffer.concat([Buffer.from([3]), u64(micro)]));
export const transfer = (from, to, lamports) => ix(SYSTEM, [W(from, true), W(to)], Buffer.concat([u32(2), u64(lamports)]));

// ---------- v0 transaction ----------
const compact = n => { const out = []; for (;;) { let b = n & 0x7f; n >>= 7; if (n) { out.push(b | 0x80); } else { out.push(b); return Buffer.from(out); } } };

// lut (optional): {address, addresses: [base58...]} — an on-chain address lookup table. Accounts found in it
// (never signers, never a program an instruction calls directly) are referenced by a 1-byte index instead of 32 bytes.
export function compileV0(payer, instructions, recentBlockhash, lut = null) {
  const metas = new Map(); // base58 -> {pubkey, isSigner, isWritable}
  const add = (k, s, w) => { const id = k.toBase58(); const m = metas.get(id); if (m) { m.isSigner ||= s; m.isWritable ||= w; } else metas.set(id, { pubkey: k, isSigner: s, isWritable: w }); };
  add(pk(payer), true, true);
  for (const i of instructions) { for (const k of i.keys) add(k.pubkey, k.isSigner, k.isWritable); add(i.programId, false, false); }
  const invoked = new Set(instructions.map(i => i.programId.toBase58()));
  const lutIdx = new Map((lut ? lut.addresses : []).map((a, i) => [a, i]));
  const payerId = pk(payer).toBase58();
  const canLoad = m => lutIdx.has(m.pubkey.toBase58()) && !m.isSigner && !invoked.has(m.pubkey.toBase58()) && m.pubkey.toBase58() !== payerId;
  const all = [...metas.values()].filter(m => !canLoad(m));
  const loadedW = [...metas.values()].filter(m => canLoad(m) && m.isWritable), loadedR = [...metas.values()].filter(m => canLoad(m) && !m.isWritable);
  const rank = m => (m.isSigner ? (m.isWritable ? 0 : 1) : (m.isWritable ? 2 : 3));
  // keep payer first while respecting groups (payer is a writable signer, group 0)
  const keys = [all.find(m => m.pubkey.toBase58() === payerId), ...all.filter(m => m.pubkey.toBase58() !== payerId).sort((a, b) => rank(a) - rank(b))];
  const header = [keys.filter(m => m.isSigner).length, keys.filter(m => m.isSigner && !m.isWritable).length, keys.filter(m => !m.isSigner && !m.isWritable).length];
  const index = new Map([...keys, ...loadedW, ...loadedR].map((m, i) => [m.pubkey.toBase58(), i]));
  const parts = [Buffer.from([0x80]), Buffer.from(header), compact(keys.length), ...keys.map(m => Buffer.from(m.pubkey.bytes)), Buffer.from(b58decode(recentBlockhash)), compact(instructions.length)];
  for (const i of instructions) {
    parts.push(Buffer.from([index.get(i.programId.toBase58())]), compact(i.keys.length), Buffer.from(i.keys.map(k => index.get(k.pubkey.toBase58()))), compact(i.data.length), i.data);
  }
  if (loadedW.length + loadedR.length) {
    const ids = a => Buffer.from(a.map(m => lutIdx.get(m.pubkey.toBase58())));
    parts.push(compact(1), Buffer.from(pk(lut.address).bytes), compact(loadedW.length), ids(loadedW), compact(loadedR.length), ids(loadedR));
  } else parts.push(compact(0)); // no address lookup tables
  return { message: Buffer.concat(parts), signerKeys: keys.filter(m => m.isSigner).map(m => m.pubkey.toBase58()), accountKeys: keys.map(m => m.pubkey.toBase58()), loaded: [...loadedW, ...loadedR].map(m => m.pubkey.toBase58()) };
}

// ---------- address lookup tables ----------
export const ALT_PROGRAM = pk("AddressLookupTab1e1111111111111111111111111");
// On-chain layout: u32 type, u64 deactivation_slot, u64 last_extended_slot, u8 start index, u8 has_authority, 32 authority, u16 pad, then addresses.
export function parseLookupTable(buf) {
  if (!buf || buf.length < 56) return null;
  const deactivated = buf.readBigUInt64LE(4) !== 0xffffffffffffffffn;
  const authority = buf[21] === 1 ? b58encode(buf.subarray(22, 54)) : null;
  const addresses = []; for (let o = 56; o + 32 <= buf.length; o += 32) addresses.push(b58encode(buf.subarray(o, o + 32)));
  return { deactivated, authority, addresses };
}
export function createLookupTableIx(authority, payer, recentSlot) {
  const slot = Buffer.alloc(8); slot.writeBigUInt64LE(BigInt(recentSlot));
  const [address, bump] = findPda([pk(authority), slot], ALT_PROGRAM);
  const data = Buffer.concat([u32(0), slot, Buffer.from([bump])]);
  return { address: address.toBase58(), ix: ix(ALT_PROGRAM, [W(address), R(pk(authority), true), W(pk(payer), true), R(SYSTEM)], data) };
}
export function extendLookupTableIx(table, authority, payer, addresses) {
  const data = Buffer.concat([u32(2), u64(addresses.length), ...addresses.map(a => Buffer.from(pk(a).bytes))]);
  return ix(ALT_PROGRAM, [W(pk(table)), R(pk(authority), true), W(pk(payer), true), R(SYSTEM)], data);
}

// signers: [{publicKey: base58, sign: bytes => Uint8Array(64)}]. Missing signers leave a zero signature (for the user's wallet to fill).
export function serializeTx(compiled, signers) {
  const byKey = new Map(signers.map(s => [s.publicKey, s]));
  const sigs = compiled.signerKeys.map(k => (byKey.has(k) ? Buffer.from(byKey.get(k).sign(compiled.message)) : Buffer.alloc(64)));
  return Buffer.concat([compact(sigs.length), ...sigs, compiled.message]);
}

// ---------- JSON-RPC ----------
export async function rpc(method, params) {
  const url = process.env.SOLANA_RPC_URL; if (!url) throw new Error("SOLANA_RPC_URL missing");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message}`);
  return j.result;
}
export const latestBlockhash = async () => (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
export const getBalance = async a => (await rpc("getBalance", [pk(a).toBase58(), { commitment: "confirmed" }])).value;
export async function tokenAmount(account) { try { return Number((await rpc("getTokenAccountBalance", [pk(account).toBase58(), { commitment: "confirmed" }])).value.amount); } catch { return 0; } }

// Sends a signed transaction and waits (up to ~60s) for confirmation.
export async function sendAndConfirm(raw, lastValidBlockHeight) {
  const sig = await rpc("sendTransaction", [Buffer.from(raw).toString("base64"), { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed" }]);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const st = (await rpc("getSignatureStatuses", [[sig]])).value[0];
    if (st && st.err) throw Object.assign(new Error("tx_failed"), { sig });
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    if (lastValidBlockHeight && i % 5 === 4) { const h = await rpc("getBlockHeight", [{ commitment: "confirmed" }]); if (h > lastValidBlockHeight) throw Object.assign(new Error("tx_expired"), { sig }); }
  }
  throw Object.assign(new Error("tx_unconfirmed"), { sig });
}
