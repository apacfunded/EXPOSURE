import { db, eq, useSignatureOnce } from "../../lib/db.js";
import { parseSigned } from "../../lib/auth.js";
import { send, allow, guard, readJson, sameOrigin, limited, paused } from "../../lib/http.js";

export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused()) return send(res, 503, { error: "paused" });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "xunlink", 10, 600)) return;
  const b = await readJson(req);
  const v = parseSigned(b, "Unlink X from Exposure");
  if (v.error) return send(res, 401, { error: v.error });
  if (!(await useSignatureOnce(v.sigHash, "xunlink"))) return send(res, 409, { error: "replayed" });
  await db.update("callers", `wallet=${eq(b.wallet)}`, { x_id: null, x_handle: null, x_name: null, x_avatar: null });
  send(res, 200, { ok: true });
});
