// Supabase env variables ki ek hi jagah check + clear errors.
// NOTE: Next.js browser bundle me NEXT_PUBLIC_ vars tabhi daalta hai jab unhe
// seedha process.env.NEXT_PUBLIC_XXX likha ho (dynamic process.env[name] kaam nahi karta).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Purani (legacy) keys JWT hoti hain: payload ke andar role = "anon" ya "service_role".
// Sirf naam dhoondhna kaafi nahi, isliye payload decode karke role dekhte hain.
export function jwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== "object" || payload === null) return null;
    const role = (payload as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

function isServiceRoleJwt(value: string): boolean {
  return jwtRole(value) === "service_role";
}

/** Supabase URL ka format (hosted project ya local dev). Value kabhi error me nahi daali jaati. */
export function isValidSupabaseUrl(url: string): boolean {
  return /^https:\/\/.+\.supabase\.co\/?$/.test(url) || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);
}

export type ServerKeyProblem = "publishable_key" | "anon_key" | "placeholder";

/**
 * SERVER (RLS bypass) key ki galat-config jaanch. Sirf ek code lautata hai, key ka koi hissa nahi.
 * Publishable/anon key yahan lag jaye toh RLS har call ko chup-chaap rok deti: tab "kuch kaam nahi kar raha" dikhta hai, isliye pehle hi saaf error.
 */
export function serverKeyProblem(value: string): ServerKeyProblem | null {
  if (value.startsWith("sb_publishable_")) return "publishable_key";
  if (jwtRole(value) === "anon") return "anon_key";
  if (/YOUR[-_]/i.test(value)) return "placeholder";
  return null;
}

export function hasSupabaseEnv(): boolean {
  return Boolean(url && key);
}

export function requireSupabaseEnv(): { url: string; key: string } {
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length > 0 || !url || !key) {
    throw new Error(
      `Supabase config missing: ${missing.join(", ")}. ` +
        "Vercel > Settings > Environment Variables me add karo, phir Redeploy karo."
    );
  }

  if (!isValidSupabaseUrl(url)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL galat lag raha hai. Format: https://xxxx.supabase.co"
    );
  }

  // Safety: secret/service_role key galti se public variable me na chali jaye.
  if (key.startsWith("sb_secret_") || key.includes("service_role") || isServiceRoleJwt(key)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY me secret key lag rahi hai! " +
        "Wahan sirf sb_publishable_... key daalo aur secret key Supabase me rotate kar do."
    );
  }

  return { url, key };
}
