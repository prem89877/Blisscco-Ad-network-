import { createHash } from "node:crypto";

// Publisher API key: "Authorization: Bearer blc_live_<64 hex>".
// Database me sirf iska SHA-256 hash rehta hai (day-5-2). Plain key kabhi store/log nahi hoti.

const KEY_RE = /^blc_live_[0-9a-f]{64}$/;

/** Header se key nikaalta hai. Format galat ho toh null (database tak jaate hi nahi). */
export function readBearerKey(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const key = match[1];
  return KEY_RE.test(key) ? key : null;
}

/** SQL ke encode(sha256(convert_to(key, 'UTF8')), 'hex') jaisa hi hash. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
