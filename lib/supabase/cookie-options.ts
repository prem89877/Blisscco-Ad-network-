// F4 (Phase 6 Day 3 Part 2): Supabase session cookies ke flags server par fix karta hai (server.ts aur middleware.ts dono yahi use karte hain).
// PURA module. Rules: HttpOnly hamesha (browser JS session cookie nahi padh sakta), SameSite Lax se kam nahi (None -> Lax; Strict rehta hai),
// Secure production me hamesha (local http dev me nahi, warna login nahi chalta), path "/" default.
// NOTE: lib/supabase/client.ts (createBrowserClient) abhi kahin import nahi hota. Use import karoge toh HttpOnly cookie wo padh nahi payega:
// pehle owner se baat karo.
export type CookieOptionsLike = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  [key: string]: unknown;
};

export function hardenCookieOptions(options: CookieOptionsLike | undefined, production: boolean = process.env.NODE_ENV === "production"): CookieOptionsLike {
  const o: CookieOptionsLike = { ...(options ?? {}) };
  o.httpOnly = true;
  o.path = typeof o.path === "string" && o.path.startsWith("/") ? o.path : "/";
  const s = o.sameSite;
  o.sameSite = s === "strict" || s === true ? "strict" : "lax";
  o.secure = production ? true : o.secure === true;
  return o;
}
