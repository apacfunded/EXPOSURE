// Everything that builds Solana transactions lives here, so it can be reviewed in one place.
// Instructions are built by hand from pump.fun's official published IDLs (github.com/pump-fun/pump-public-docs/idl),
// so no third-party SDK code runs on the server. Only @solana/web3.js is used.
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { poolWallet, opsWallet } from "./keys.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP = new PublicKey(PUMP_PROGRAM);
const AMM = new PublicKey(PUMP_AMM_PROGRAM);
const MAYHEM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const RENT_EXEMPT_0 = 890_880; // rent-exempt minimum for a 0-byte account

// instruction discriminators from the IDLs
const DISC = {
  createV2: Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]),
  collectCreatorFeeV2: Buffer.from([207, 17, 138, 242, 4, 34, 19, 56]),
  collectCoinCreatorFee: Buffer.from([160, 57, 89, 42, 181, 139, 43, 66])
};

const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds.map(s => (typeof s === "string" ? Buffer.from(s) : s.toBuffer ? s.toBuffer() : s)), program)[0];
const ata = (owner, mint, tokenProgram) => pda([owner, tokenProgram, mint], ATA_PROGRAM);
const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const R = pubkey => ({ pubkey, isSigner: false, isWritable: false });
const borshString = s => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };

let _conn;
export const conn = () => (_conn = _conn || new Connection(process.env.SOLANA_RPC_URL, "confirmed"));

export function poolKeypair(mint) { return Keypair.fromSecretKey(poolWallet(process.env.POOL_MASTER_SEED, mint).secretKey); }
// Pays network fees for claims (claims are permissionless). Fund it with a little SOL; it never holds pool money.
export function opsKeypair() { return Keypair.fromSecretKey(opsWallet(process.env.POOL_MASTER_SEED).secretKey); }

// ---- launch ----
export function createV2Instruction({ mint, user, creator, name, symbol, uri }) {
  const bondingCurve = pda(["bonding-curve", mint], PUMP);
  const solVault = pda(["sol-vault"], MAYHEM);
  const keys = [
    W(mint, true),
    R(pda(["mint-authority"], PUMP)),
    W(bondingCurve),
    W(ata(bondingCurve, mint, TOKEN22)),
    R(pda(["global"], PUMP)),
    W(user, true),
    R(SystemProgram.programId),
    R(TOKEN22),
    R(ATA_PROGRAM),
    W(MAYHEM),
    R(pda(["global-params"], MAYHEM)),
    W(solVault),
    W(pda(["mayhem-state", mint], MAYHEM)),
    W(ata(solVault, mint, TOKEN22)),
    R(pda(["__event_authority"], PUMP)),
    R(PUMP)
  ];
  // name, symbol, uri, creator, is_mayhem_mode=false. The optional trailing args are left off (read as false/0).
  const data = Buffer.concat([DISC.createV2, borshString(name), borshString(symbol), borshString(uri), creator.toBuffer(), Buffer.from([0])]);
  return new TransactionInstruction({ programId: PUMP, keys, data });
}

// Builds the launch transaction: the launcher's wallet pays and signs; the new mint co-signs here;
// the coin's creator (fee recipient) is the coin's own pool wallet, so creator fees fill that coin's pool.
export async function buildLaunchTx({ user, name, symbol, uri }) {
  const mint = Keypair.generate();
  const pool = poolKeypair(mint.publicKey.toBase58());
  const userPk = new PublicKey(user);
  const ix = createV2Instruction({ mint: mint.publicKey, user: userPk, creator: pool.publicKey, name, symbol, uri });
  const { blockhash } = await conn().getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: userPk, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), ix]
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([mint]);
  // Self-check before handing it out: payer is the user, only expected programs, no lookup tables.
  const keys = msg.staticAccountKeys.map(k => k.toBase58());
  if (keys[0] !== user || msg.addressTableLookups.length) throw new Error("launch_tx_check");
  const ok = new Set(["ComputeBudget111111111111111111111111111111", PUMP_PROGRAM]);
  for (const c of msg.compiledInstructions) if (!ok.has(keys[c.programIdIndex])) throw new Error("launch_tx_check");
  return { tx: Buffer.from(tx.serialize()).toString("base64"), mint: mint.publicKey.toBase58(), poolWallet: pool.publicKey.toBase58() };
}

// ---- claiming creator fees into a coin's pool wallet ----
function collectBondingCurveIx(creator) {
  const vault = pda(["creator-vault", creator], PUMP);
  return new TransactionInstruction({ programId: PUMP, data: DISC.collectCreatorFeeV2, keys: [
    W(creator), W(ata(creator, WSOL, TOKEN)), W(vault), W(ata(vault, WSOL, TOKEN)),
    R(WSOL), R(TOKEN), R(ATA_PROGRAM), R(SystemProgram.programId), R(pda(["__event_authority"], PUMP)), R(PUMP)
  ] });
}
function collectAmmIx(creator) {
  const auth = pda(["creator_vault", creator], AMM);
  return new TransactionInstruction({ programId: AMM, data: DISC.collectCoinCreatorFee, keys: [
    R(WSOL), R(TOKEN), R(creator), R(auth), W(ata(auth, WSOL, TOKEN)), W(ata(creator, WSOL, TOKEN)), R(pda(["__event_authority"], AMM)), R(AMM)
  ] });
}
const createAtaIdempotentIx = (payer, owner, mint, tokenProgram) => new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [
  W(payer, true), W(ata(owner, mint, tokenProgram)), R(owner), R(mint), R(SystemProgram.programId), R(tokenProgram)
] });
const closeTokenAccountIx = (account, dest, owner) => new TransactionInstruction({ programId: TOKEN, data: Buffer.from([9]), keys: [W(account), W(dest), { pubkey: owner, isSigner: true, isWritable: false }] });

export async function vaultBalances(creator) {
  const c = conn();
  const bcVault = pda(["creator-vault", creator], PUMP);
  const ammAta = ata(pda(["creator_vault", creator], AMM), WSOL, TOKEN);
  const [bc, amm] = await Promise.all([
    c.getBalance(bcVault, "confirmed"),
    c.getTokenAccountBalance(ammAta, "confirmed").then(r => Number(r.value.amount)).catch(() => 0)
  ]);
  return { bondingCurve: Math.max(0, bc - RENT_EXEMPT_0), amm };
}

// Claims a coin's fees (bonding curve and, after graduation, PumpSwap). Fees land as SOL in the pool wallet.
export async function claimFees(mint, minLamports = 5_000_000) {
  const pool = poolKeypair(mint), ops = opsKeypair();
  const v = await vaultBalances(pool.publicKey);
  const ixs = [], signers = [ops];
  if (v.bondingCurve >= minLamports) ixs.push(collectBondingCurveIx(pool.publicKey));
  if (v.amm >= minLamports) {
    const wsolAta = ata(pool.publicKey, WSOL, TOKEN);
    ixs.push(createAtaIdempotentIx(ops.publicKey, pool.publicKey, WSOL, TOKEN), collectAmmIx(pool.publicKey), closeTokenAccountIx(wsolAta, pool.publicKey, pool.publicKey));
    signers.push(pool);
  }
  if (!ixs.length) return { skipped: "little_to_claim", vault: v.bondingCurve + v.amm };
  const sig = await sendIxs(ixs, ops, signers);
  return { sig, vault: v.bondingCurve + v.amm };
}

// Sends SOL from a coin's pool wallet. Each tx carries at most 12 transfers.
export async function sendFromPool(mint, transfers) {
  const pool = poolKeypair(mint);
  const sigs = [];
  for (let i = 0; i < transfers.length; i += 12) {
    const batch = transfers.slice(i, i + 12);
    const ixs = batch.map(t => SystemProgram.transfer({ fromPubkey: pool.publicKey, toPubkey: new PublicKey(t.to), lamports: t.lamports }));
    sigs.push({ sig: await sendIxs(ixs, pool, [pool]), batch });
  }
  return sigs;
}

async function sendIxs(ixs, payer, signers) {
  const c = conn();
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const sig = await c.sendTransaction(tx, { maxRetries: 3 });
  const r = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (r.value.err) throw Object.assign(new Error("tx_failed"), { sig });
  return sig;
}

export async function balance(addr) { return conn().getBalance(new PublicKey(addr), "confirmed"); }
