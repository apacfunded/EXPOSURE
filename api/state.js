import { buildState } from "../lib/state.js";
import { send, allow, guard } from "../lib/http.js";

// Public, read-only. Cached at Vercel's edge for 15s so traffic spikes don't hit the database.
export default guard(async (req, res) => {
  if (!allow(req, res, "GET")) return;
  send(res, 200, await buildState(), { cache: "public, s-maxage=15, stale-while-revalidate=30" });
});
