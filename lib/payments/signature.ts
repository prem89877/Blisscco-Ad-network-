import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Phase 5 Step 5: webhook signature ke provider-neutral building blocks. Koi provider chuna nahi gaya, isliye yahan kisi provider ka
// header naam ya format hardcode NAHI hai. Jab owner provider chunega, uska adapter in functions ko apne documented format ke saath bulayega
// aur tab uske sandbox me test hoga. Ye functions provider ke asli signatures ke against abhi VERIFY NAHI hue.
//
// Niyam: raw body bytes/string par check (parse karke dobara string banakar nahi), constant-time compare, secret kabhi log / error me nahi.

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256Hex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time hex compare. Lambai alag / hex nahi / khali => false (kabhi throw nahi). */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length || a.length % 2 !== 0) return false;
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Format 1: signature = hex(HMAC-SHA256(secret, rawBody)). Secret khali => hamesha false. */
export function verifyBodyHmac(secret: string, rawBody: string, signatureHex: string | null | undefined): boolean {
  if (typeof secret !== "string" || secret.length < 16) return false;
  if (typeof rawBody !== "string" || typeof signatureHex !== "string") return false;
  return safeEqualHex(hmacSha256Hex(secret, rawBody), signatureHex.trim());
}

/** Format 2: signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)) + timestamp ki seema (replay rok). nowSeconds test ke liye. */
export function verifyTimestampedHmac(
  secret: string,
  rawBody: string,
  timestampSeconds: string | null | undefined,
  signatureHex: string | null | undefined,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (typeof secret !== "string" || secret.length < 16) return false;
  if (typeof rawBody !== "string" || typeof timestampSeconds !== "string" || typeof signatureHex !== "string") return false;
  if (!/^\d{9,12}$/.test(timestampSeconds)) return false;
  const ts = Number(timestampSeconds);
  if (!Number.isSafeInteger(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  return safeEqualHex(hmacSha256Hex(secret, `${timestampSeconds}.${rawBody}`), signatureHex.trim());
}

/**
 * Format 3: signature = base64(HMAC-SHA256(secret, `${timestamp}${rawBody}`)) (timestamp aur body ke beech koi separator nahi).
 * Provider-neutral naam; use sirf cashfree.ts karta hai (Cashfree docs ke anusaar, 2026-11 me padhi gayi). Timestamp ki seema nahi lagayi:
 * provider retries ke saath naya timestamp bhejta hai ya nahi, ye sandbox me dekhna baaki hai; replay se nuksan nahi kyunki har event idempotent hai
 * aur hum status provider API se dobara padhte hain.
 */
export function verifyBase64TimestampHmac(
  secret: string,
  rawBody: string,
  timestamp: string | null | undefined,
  signatureB64: string | null | undefined
): boolean {
  if (typeof secret !== "string" || secret.length < 16) return false;
  if (typeof rawBody !== "string" || typeof timestamp !== "string" || typeof signatureB64 !== "string") return false;
  if (!/^\d{9,15}$/.test(timestamp)) return false;
  const given = signatureB64.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(given)) return false; // 32 bytes -> 44 base64 chars
  const expected = createHmac("sha256", secret).update(`${timestamp}${rawBody}`, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(given, "base64"));
}
