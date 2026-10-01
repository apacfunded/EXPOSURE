// Checks a wallet-signed message from the site. The message must have the exact first line we expect,
// name the same wallet, be signed within the last 5 minutes, and never be reused (replay check in the database).
import { verifyEd25519, isAddress, sha256hex } from "./keys.js";

export const MAX_AGE_MS = 5 * 60 * 1000;

export function parseSigned({ wallet, message, signature }, firstLine, now = Date.now()) {
  if (!isAddress(wallet)) return { error: "bad_wallet" };
  if (typeof message !== "string" || message.length > 600) return { error: "bad_message" };
  if (typeof signature !== "string" || signature.length > 200) return { error: "bad_signature" };
  const lines = message.split("\n");
  if (lines[0] !== firstLine) return { error: "bad_message" };
  const fields = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(": "); if (i < 1) return { error: "bad_message" }; const k = l.slice(0, i); if (k in fields) return { error: "bad_message" }; fields[k] = l.slice(i + 2); }
  if (fields.Wallet !== wallet) return { error: "bad_message" };
  const t = Date.parse(fields.Time || "");
  if (!Number.isFinite(t) || now - t > MAX_AGE_MS || t - now > 60 * 1000) return { error: "expired" };
  let sig;
  try { sig = Buffer.from(signature, "base64"); } catch { return { error: "bad_signature" }; }
  if (sig.length !== 64 || !verifyEd25519(wallet, new TextEncoder().encode(message), sig)) return { error: "bad_signature" };
  return { ok: true, fields, sigHash: sha256hex(signature) };
}
