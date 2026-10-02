// Everything that builds Solana transactions lives here, so it can be reviewed in one place.
// Instructions are built by hand from pump.fun's official published IDLs (github.com/pump-fun/pump-public-docs/idl),
// using lib/sol.js. No third-party code runs on the server.
import crypto from "node:crypto";
import { pk, pda, ata, ix, W, R, SYSTEM, TOKEN, TOKEN22, ATA_PROGRAM, WSOL, setComputeUnitLimit, setComputeUnitPrice, transfer, compileV0, serializeTx, latestBlockhash, getBalance, tokenAmount, sendAndConfirm } from "./sol.js";
import { poolWallet, opsWallet, top20Wallet, lutAuthority, keypairFromSeed } from "./keys.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP = pk(PUMP_PROGRAM), AMM = pk(PUMP_AMM_PROGRAM);
const MAYHEM = pk("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const RENT_EXEMPT_0 = 890_880;

const DISC = {
  createV2: Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]),
  collectCreatorFeeV2: Buffer.from([207, 17, 138, 242, 4, 34, 19, 56]),
  collectCoinCreatorFee: Buffer.from([160, 57, 89, 42, 181, 139, 43, 66])
};
const borshString = s => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };

export const poolKeypair = mint => poolWallet(process.env.POOL_MASTER_SEED, mint);
export const opsKeypair = () => opsWallet(process.env.POOL_MASTER_SEED);
export const top20Keypair = () => top20Wallet(process.env.POOL_MASTER_SEED);

// ---- launch ----
export function createV2Instruction({ mint, user, creator, name, symbol, uri }) {
  mint = pk(mint); user = pk(user); creator = pk(creator);
  const bondingCurve = pda(["bonding-curve", mint], PUMP);
  const solVault = pda(["sol-vault"], MAYHEM);
  return ix(PUMP, [
    W(mint, true),
    R(pda(["mint-authority"], PUMP)),
    W(bondingCurve),
    W(ata(bondingCurve, mint, TOKEN22)),
    R(pda(["global"], PUMP)),
    W(user, true),
    R(SYSTEM), R(TOKEN22), R(ATA_PROGRAM),
    W(MAYHEM),
    R(pda(["global-params"], MAYHEM)),
    W(solVault),
    W(pda(["mayhem-state", mint], MAYHEM)),
    W(ata(solVault, mint, TOKEN22)),
    R(pda(["__event_authority"], PUMP)),
    R(PUMP)
  ], Buffer.concat([DISC.createV2, borshString(name), borshString(symbol), borshString(uri), Buffer.from(creator.bytes), Buffer.from([0])]));
}

// Dev buy: pump.fun's buy_exact_sol_in (IDL accounts 0-15), plus the two accounts pump.fun's April upgrade
// appends to every bonding-curve buy: bonding-curve-v2, then one of the 8 new fee recipients (mutable). 18 in all.
const GLOBAL_FEE_RECIPIENT = "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV";
const NEW_FEE_RECIPIENTS = ["5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD", "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7", "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL", "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR", "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6", "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL", "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD", "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW"];
const FEE_PROGRAM = pk("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const FEE_CONFIG_SEED = Buffer.from([1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176]);
const u64le = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const MAX_DEV_BUY_LAMPORTS = 50 * 1e9;

export function buyExactSolInInstruction({ mint, user, creator, lamports, minTokens = 1 }) {
  mint = pk(mint); user = pk(user); creator = pk(creator);
  const bondingCurve = pda(["bonding-curve", mint], PUMP);
  return ix(PUMP, [
    R(pda(["global"], PUMP)),
    W(pk(GLOBAL_FEE_RECIPIENT)),
    R(mint),
    W(bondingCurve),
    W(ata(bondingCurve, mint, TOKEN22)),
    W(ata(user, mint, TOKEN22)),
    W(user, true),
    R(SYSTEM),
    R(TOKEN22),
    W(pda(["creator-vault", creator], PUMP)),
    R(pda(["__event_authority"], PUMP)),
    R(PUMP),
    R(pda(["global_volume_accumulator"], PUMP)),
    W(pda(["user_volume_accumulator", user], PUMP)),
    R(pda(["fee_config", FEE_CONFIG_SEED], FEE_PROGRAM)),
    R(FEE_PROGRAM),
    R(pda(["bonding-curve-v2", mint], PUMP)),
    W(pk(NEW_FEE_RECIPIENTS[crypto.randomInt(NEW_FEE_RECIPIENTS.length)]))
  ], Buffer.concat([Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]), u64le(lamports), u64le(minTokens), Buffer.from([1])]));
}

// ---- launch lookup table ----
// Create + dev buy in one transaction is ~1,290 bytes; Solana's limit is 1,232. This public on-chain table holds the
// fixed pump.fun accounts so each costs 1 byte instead of 32. The ops wallet owns it; it's created once by the tick job.
export const LAUNCH_LUT_ADDRESSES = () => [
  pda(["global"], PUMP), pda(["mint-authority"], PUMP), MAYHEM, pda(["global-params"], MAYHEM), pda(["sol-vault"], MAYHEM),
  pda(["__event_authority"], PUMP), SYSTEM, TOKEN22, pk(GLOBAL_FEE_RECIPIENT), pda(["global_volume_accumulator"], PUMP),
  pda(["fee_config", FEE_CONFIG_SEED], FEE_PROGRAM), FEE_PROGRAM, ...NEW_FEE_RECIPIENTS.map(pk)
].map(k => k.toBase58());

// Found through the table authority's own transactions (it signs nothing else), then checked on chain:
// owned by the lookup-table program, our authority, not deactivated, and holding every address we expect.
let lutCache = { at: 0, lut: null };
export async function findLaunchLut() {
  if (lutCache.lut && Date.now() - lutCache.at < 3600e3) return lutCache.lut;
  const { rpc, parseLookupTable, ALT_PROGRAM } = await import("./sol.js");
  const auth = lutAuthority(process.env.POOL_MASTER_SEED).publicKey, want = LAUNCH_LUT_ADDRESSES();
  const sigs = await rpc("getSignaturesForAddress", [auth, { limit: 20, commitment: "confirmed" }]);
  let lut = null;
  for (const s of sigs || []) {
    if (s.err) continue;
    const tx = await rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null);
    const keys = (tx && tx.transaction.message.accountKeys) || [];
    const accs = keys.length ? (await rpc("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }])).value : [];
    accs.forEach((a, i) => {
      if (lut || !a || a.owner !== ALT_PROGRAM.toBase58()) return;
      const t = parseLookupTable(Buffer.from(a.data[0], "base64"));
      if (t && !t.deactivated && t.authority === auth && want.every(w => t.addresses.includes(w))) lut = { address: keys[i], addresses: t.addresses };
    });
    if (lut) break;
  }
  lutCache = { at: lut ? Date.now() : 0, lut, authorityUsed: (sigs || []).some(s => !s.err) };
  return lut;
}
// Called by the tick job: creates the table if it isn't there yet. The ops wallet pays ~0.004 SOL once.
export async function ensureLaunchLut() {
  if (await findLaunchLut()) return { exists: lutCache.lut.address };
  // never create a second table automatically: if the authority already did something, a person should look
  if (lutCache.authorityUsed) return { error: "lut_authority_has_history_but_no_valid_table" };
  const { rpc, createLookupTableIx, extendLookupTableIx } = await import("./sol.js");
  const ops = opsKeypair(), auth = lutAuthority(process.env.POOL_MASTER_SEED), slot = await rpc("getSlot", [{ commitment: "finalized" }]);
  const { address, ix: createIx } = createLookupTableIx(auth.publicKey, ops.publicKey, slot);
  const sig = await send(ops.publicKey, [createIx, extendLookupTableIx(address, auth.publicKey, ops.publicKey, LAUNCH_LUT_ADDRESSES())], [ops, auth]);
  return { created: address, sig };
}

// The launcher's wallet pays and signs; the new mint co-signs here; the coin's creator (fee recipient)
// is the coin's own pool wallet, so creator fees fill that coin's pool.
// devBuyLamports > 0 adds the launcher's first buy in the same transaction, so nobody can buy before them;
// that's also why min_tokens_out can safely be 1 here.
export async function buildLaunchTx({ user, name, symbol, uri, devBuyLamports = 0 }) {
  devBuyLamports = Math.floor(Number(devBuyLamports) || 0);
  if (devBuyLamports < 0 || devBuyLamports > MAX_DEV_BUY_LAMPORTS) throw new Error("dev_buy_range");
  const mint = keypairFromSeed(crypto.randomBytes(32));
  const pool = poolKeypair(mint.publicKey);
  const [{ blockhash }, lut] = await Promise.all([latestBlockhash(), devBuyLamports ? findLaunchLut().catch(() => null) : null]);
  const ixs = [setComputeUnitLimit(devBuyLamports ? 600_000 : 350_000), setComputeUnitPrice(200_000),
    createV2Instruction({ mint: mint.publicKey, user, creator: pool.publicKey, name, symbol, uri })];
  if (devBuyLamports) ixs.push(createAtaIdempotent(user, user, mint.publicKey, TOKEN22),
    buyExactSolInInstruction({ mint: mint.publicKey, user, creator: pool.publicKey, lamports: devBuyLamports }));
  const c = compileV0(user, ixs, blockhash, lut);
  // Self-check: payer is the user, and the only signers are the user and the new mint.
  if (c.accountKeys[0] !== user || c.signerKeys.length !== 2 || !c.signerKeys.includes(mint.publicKey)) throw new Error("launch_tx_check");
  const tx = serializeTx(c, [mint]);
  if (tx.length > 1232) throw Object.assign(new Error("tx_too_big"), { status: 503 });
  return { tx: tx.toString("base64"), mint: mint.publicKey, poolWallet: pool.publicKey, bytes: tx.length };
}

// ---- claiming creator fees into a coin's pool wallet ----
const collectBondingCurveIx = creator => {
  const vault = pda(["creator-vault", creator], PUMP);
  return ix(PUMP, [W(creator), W(ata(creator, WSOL, TOKEN)), W(vault), W(ata(vault, WSOL, TOKEN)), R(WSOL), R(TOKEN), R(ATA_PROGRAM), R(SYSTEM), R(pda(["__event_authority"], PUMP)), R(PUMP)], DISC.collectCreatorFeeV2);
};
const collectAmmIx = creator => {
  const auth = pda(["creator_vault", creator], AMM);
  return ix(AMM, [R(WSOL), R(TOKEN), R(creator), R(auth), W(ata(auth, WSOL, TOKEN)), W(ata(creator, WSOL, TOKEN)), R(pda(["__event_authority"], AMM)), R(AMM)], DISC.collectCoinCreatorFee);
};
const createAtaIdempotent = (payer, owner, mint, tp) => ix(ATA_PROGRAM, [W(payer, true), W(ata(owner, mint, tp)), R(owner), R(mint), R(SYSTEM), R(tp)], [1]);
const closeTokenAccount = (account, dest, owner) => ix(TOKEN, [W(account), W(dest), R(owner, true)], [9]);

export async function vaultBalances(creator) {
  creator = pk(creator);
  const [bc, amm] = await Promise.all([getBalance(pda(["creator-vault", creator], PUMP)), tokenAmount(ata(pda(["creator_vault", creator], AMM), WSOL, TOKEN))]);
  return { bondingCurve: Math.max(0, bc - RENT_EXEMPT_0), amm };
}

// Claims a coin's fees (bonding curve and, after graduation, PumpSwap). The ops wallet pays the network fee.
export async function claimFees(mint, minLamports = 5_000_000, opts = {}) {
  const pool = poolKeypair(mint), ops = opsKeypair(), creator = pk(pool.publicKey);
  const v = await vaultBalances(creator);
  const ixs = [], signers = [ops];
  if (v.bondingCurve >= minLamports) ixs.push(collectBondingCurveIx(creator));
  if (v.amm >= minLamports) {
    ixs.push(createAtaIdempotent(ops.publicKey, creator, WSOL, TOKEN), collectAmmIx(creator), closeTokenAccount(ata(creator, WSOL, TOKEN), creator, creator));
    signers.push(pool);
  }
  if (!ixs.length) return { skipped: "little_to_claim", vault: v.bondingCurve + v.amm };
  if (opts.simulate) {
    const { blockhash } = await latestBlockhash();
    const raw = serializeTx(compileV0(ops.publicKey, [setComputeUnitPrice(100_000), ...ixs], blockhash), signers);
    const { rpc } = await import("./sol.js");
    const r = await rpc("simulateTransaction", [raw.toString("base64"), { encoding: "base64", sigVerify: true, commitment: "confirmed" }]);
    return { simulated: true, err: r.value.err, logs: (r.value.logs || []).slice(-12), vault: v.bondingCurve + v.amm };
  }
  return { sig: await send(ops.publicKey, ixs, signers), vault: v.bondingCurve + v.amm };
}

// Sends SOL from a coin's pool wallet, at most 12 transfers per transaction.
export async function sendFromPool(mint, transfers) {
  const pool = poolKeypair(mint), out = [];
  for (let i = 0; i < transfers.length; i += 12) {
    const batch = transfers.slice(i, i + 12);
    out.push({ sig: await send(pool.publicKey, batch.map(t => transfer(pool.publicKey, t.to, t.lamports)), [pool]), batch });
  }
  return out;
}

async function send(payer, ixs, signers) {
  const { blockhash, lastValidBlockHeight } = await latestBlockhash();
  const c = compileV0(payer, [setComputeUnitPrice(100_000), ...ixs], blockhash);
  return sendAndConfirm(serializeTx(c, signers), lastValidBlockHeight);
}

// Sends SOL from the Top 20 pool wallet (daily bonus), at most 12 transfers per transaction.
export async function sendFromTop20(transfers) {
  const w = top20Keypair(), out = [];
  for (let i = 0; i < transfers.length; i += 12) {
    const batch = transfers.slice(i, i + 12);
    out.push({ sig: await send(w.publicKey, batch.map(t => transfer(w.publicKey, t.to, t.lamports)), [w]), batch });
  }
  return out;
}

export const balance = getBalance;

// ---- market cap straight from pump.fun's bonding curve (works from the first trade, no indexer needed) ----
// BondingCurve layout (IDL): 8-byte discriminator, then virtual_token_reserves u64, virtual_quote_reserves u64,
// real_token_reserves u64, real_quote_reserves u64, token_total_supply u64, complete bool, creator pubkey ...
export function parseBondingCurve(buf) {
  if (!buf || buf.length < 8 + 8 * 5 + 1 + 32) return null;
  const r = o => Number(buf.readBigUInt64LE(8 + o));
  return { vToken: r(0), vQuote: r(8), realToken: r(16), realQuote: r(24), supply: r(32), complete: buf[48] === 1, creator: buf.subarray(49, 81) };
}
// Returns {mint: {mcSol, complete}} for SOL-paired coins still on the curve. Tokens have 6 decimals, SOL 9.
export async function curveMarketCaps(mints) {
  const { rpc } = await import("./sol.js");
  const out = {};
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const keys = batch.map(m => pda(["bonding-curve", pk(m)], PUMP).toBase58());
    const res = await rpc("getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
    res.value.forEach((acc, j) => {
      if (!acc) return;
      const bc = parseBondingCurve(Buffer.from(acc.data[0], "base64"));
      if (!bc || !bc.vToken) return;
      const priceSol = (bc.vQuote / 1e9) / (bc.vToken / 1e6);
      out[batch[j]] = { mcSol: priceSol * (bc.supply / 1e6), complete: bc.complete };
    });
  }
  return out;
}
