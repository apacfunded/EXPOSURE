// Solana JSON-RPC over fetch (Helius or any RPC in SOLANA_RPC_URL). Read-only helpers.
async function rpc(method, params) {
  const url = process.env.SOLANA_RPC_URL; if (!url) throw new Error("SOLANA_RPC_URL missing");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message}`);
  return j.result;
}

export const getBalance = async addr => (await rpc("getBalance", [addr, { commitment: "confirmed" }])).value;

// Total UI amount of `mint` held by `owner` across all its token accounts (both token programs).
export async function tokenBalance(owner, mint) {
  const res = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return (res.value || []).reduce((a, x) => a + (+x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
}

// Confirms a signature landed and returns the parsed transaction (or null).
export async function getTx(sig) {
  return rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
}

export { rpc };
