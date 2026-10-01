// Tiny Supabase (PostgREST) client over fetch. Uses the service-role key, which lives only in Vercel env
// and never reaches the browser. Every table has row-level security on with no public policies, so the
// public anon key can't read or write anything.
const URL_ = () => { const u = process.env.SUPABASE_URL; if (!u || !/^https:\/\//.test(u)) throw new Error("SUPABASE_URL missing"); return u.replace(/\/$/, ""); };
const KEY = () => { const k = process.env.SUPABASE_SERVICE_KEY; if (!k) throw new Error("SUPABASE_SERVICE_KEY missing"); return k; };

async function req(path, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${URL_()}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY(), ...(KEY().startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY()}` }), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`db ${r.status}`); e.status = r.status; e.detail = text.slice(0, 300); throw e; }
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;
export const eq = v => `eq.${enc(v)}`;
export const db = {
  select: (table, query = "") => req(`${table}?${query}`),
  insert: (table, rows, { upsert = false, onConflict } = {}) =>
    req(`${table}${onConflict ? `?on_conflict=${enc(onConflict)}` : ""}`, { method: "POST", body: rows, prefer: `return=representation${upsert ? ",resolution=merge-duplicates" : ""}` }),
  update: (table, query, patch) => req(`${table}?${query}`, { method: "PATCH", body: patch, prefer: "return=representation" }),
  remove: (table, query) => req(`${table}?${query}`, { method: "DELETE" }),
  rpc: (fn, args) => req(`rpc/${fn}`, { method: "POST", body: args }),
  eq
};

// Replay guard: each signed message can be used once. The unique index on used_sigs.hash does the work.
export async function useSignatureOnce(hash, purpose) {
  try { await db.insert("used_sigs", [{ hash, purpose }]); return true; }
  catch (e) { if (e.status === 409) return false; throw e; }
}

// Rate limit backed by the database (serverless functions don't share memory).
export async function rateLimit(key, max, windowSec) {
  const rows = await db.rpc("hit_rate_limit", { p_key: key, p_max: max, p_window: windowSec });
  return rows === true || (Array.isArray(rows) && rows[0] === true);
}
