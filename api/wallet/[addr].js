import { buildWallet } from "../../lib/state.js";
import { send, allow, guard } from "../../lib/http.js";
import { isAddress } from "../../lib/keys.js";

export default guard(async (req, res) => {
  if (!allow(req, res, "GET")) return;
  const w = String((req.query && req.query.addr) || "");
  if (!isAddress(w)) return send(res, 400, { error: "bad_wallet" });
  send(res, 200, await buildWallet(w), { cache: "public, s-maxage=15, stale-while-revalidate=30" });
});
