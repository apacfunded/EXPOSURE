// Everything that builds Solana transactions lives here, so it can be reviewed in one place.
// Uses @solana/web3.js and pump.fun's official @pump-fun/pump-sdk (installed by Vercel at build time).
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as PumpSdkModule from "@pump-fun/pump-sdk";
import { poolWallet } from "./keys.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

let _conn;
export const conn = () => (_conn = _conn || new Connection(process.env.SOLANA_RPC_URL, "confirmed"));

let _sdk;
async function sdk() {
  if (_sdk) return _sdk;
  const m = PumpSdkModule;
  _sdk = { PUMP_SDK: m.PUMP_SDK || new m.PumpSdk(), online: new m.OnlinePumpSdk(conn()), m };
  return _sdk;
}

export function poolKeypair(mint) {
  const k = poolWallet(process.env.POOL_MASTER_SEED, mint);
  return Keypair.fromSecretKey(k.secretKey);
}

// Builds the launch transaction: the launcher's wallet pays and signs; the new mint co-signs here;
// the coin's creator (fee recipient) is the coin's own pool wallet, so creator fees fill that coin's pool.
export async function buildLaunchTx({ user, name, symbol, uri }) {
  const { PUMP_SDK } = await sdk();
  const mint = Keypair.generate();
  const pool = poolKeypair(mint.publicKey.toBase58());
  const userPk = new PublicKey(user);
  const create = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey, name, symbol, uri,
    creator: pool.publicKey, user: userPk,
    mayhemMode: false, holderReward: false
  });
  const { blockhash } = await conn().getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: userPk, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), create]
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([mint]);
  // Self-check before handing it out: payer is the user, only expected programs, no lookup tables.
  const keys = msg.staticAccountKeys.map(k => k.toBase58());
  if (keys[0] !== user || msg.addressTableLookups.length) throw new Error("launch_tx_check");
  const ok = new Set(["11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", PUMP_PROGRAM]);
  for (const ix of msg.compiledInstructions) if (!ok.has(keys[ix.programIdIndex])) throw new Error("launch_tx_check");
  return { tx: Buffer.from(tx.serialize()).toString("base64"), mint: mint.publicKey.toBase58(), poolWallet: pool.publicKey.toBase58() };
}

// Claims a coin's creator fees (bonding curve + PumpSwap after graduation) into its pool wallet.
// Claiming is permissionless on pump.fun; the pool wallet signs only because it also pays the network fee.
export async function claimFees(mint) {
  const { online } = await sdk();
  const pool = poolKeypair(mint);
  const vault = await online.getCreatorVaultBalanceBothPrograms(pool.publicKey).catch(() => null);
  if (vault !== null && Number(vault.toString()) < 5_000_000) return { skipped: "little_to_claim", vault: Number(vault.toString()) };
  const ixs = await online.collectCoinCreatorFeeInstructions(pool.publicKey, pool.publicKey);
  const sig = await sendIxs(ixs, pool, [pool]);
  return { sig, vault: vault === null ? null : Number(vault.toString()) };
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
