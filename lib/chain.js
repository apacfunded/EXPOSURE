// Everything that builds Solana transactions lives here, so it can be reviewed in one place.
// Instructions are built by hand from pump.fun's official published IDLs (github.com/pump-fun/pump-public-docs/idl),
// using lib/sol.js. No third-party code runs on the server.
import crypto from "node:crypto";
import { pk, pda, ata, ix, W, R, SYSTEM, TOKEN, TOKEN22, ATA_PROGRAM, WSOL, setComputeUnitLimit, setComputeUnitPrice, transfer, compileV0, serializeTx, latestBlockhash, getBalance, tokenAmount, sendAndConfirm } from "./sol.js";
import { poolWallet, opsWallet, keypairFromSeed } from "./keys.js";

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

// The launcher's wallet pays and signs; the new mint co-signs here; the coin's creator (fee recipient)
// is the coin's own pool wallet, so creator fees fill that coin's pool.
export async function buildLaunchTx({ user, name, symbol, uri }) {
  const mint = keypairFromSeed(crypto.randomBytes(32));
  const pool = poolKeypair(mint.publicKey);
  const { blockhash } = await latestBlockhash();
  const c = compileV0(user, [setComputeUnitLimit(350_000), setComputeUnitPrice(200_000),
    createV2Instruction({ mint: mint.publicKey, user, creator: pool.publicKey, name, symbol, uri })], blockhash);
  // Self-check: payer is the user, only compute-budget + pump.fun programs are called.
  if (c.accountKeys[0] !== user || c.signerKeys.length !== 2) throw new Error("launch_tx_check");
  return { tx: serializeTx(c, [mint]).toString("base64"), mint: mint.publicKey, poolWallet: pool.publicKey };
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
