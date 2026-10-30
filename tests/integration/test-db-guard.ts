// Integration tests ke liye safety guard (pure: koi network/database nahi, isliye hamesha test hota hai).
// Rule: integration test SIRF alag TEST database par chalta hai. Production par kabhi nahi.
// Teeno cheezein zaroori hain: (1) TEST_DATABASE_URL, (2) TEST_DB_CONFIRM, (3) TEST_SUPABASE_PROJECT_REF jo URL me dikhe
// aur production ke project ref se alag ho.

export const TEST_DB_CONFIRM_VALUE = "blisscco-test-db";

export type GuardEnv = Record<string, string | undefined>;
export type GuardResult = { ok: true; url: string } | { ok: false; reason: string };

/** Production ki pehchaan env se: Supabase URL ka project ref, aur koi bhi DB URL jo prod ke liye set ho. */
function productionMarkers(env: GuardEnv): string[] {
  const markers: string[] = [];
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const v = env[key];
    if (!v) continue;
    const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/i.exec(v.trim());
    if (m) markers.push(m[1].toLowerCase());
  }
  for (const key of ["DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL", "PROD_DATABASE_URL"]) {
    const v = env[key];
    if (v && v.trim() !== "") markers.push(v.trim());
  }
  return markers;
}

export function checkTestDatabase(env: GuardEnv): GuardResult {
  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) return { ok: false, reason: "TEST_DATABASE_URL is not set" };
  if (env.TEST_DB_CONFIRM !== TEST_DB_CONFIRM_VALUE) return { ok: false, reason: `TEST_DB_CONFIRM must be "${TEST_DB_CONFIRM_VALUE}"` };
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return { ok: false, reason: "refusing to run in a production environment" };
  if (!/^postgres(ql)?:\/\//i.test(url)) return { ok: false, reason: "TEST_DATABASE_URL must be a postgres:// URL" };

  const testRef = env.TEST_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (!testRef) return { ok: false, reason: "TEST_SUPABASE_PROJECT_REF is not set" };
  if (!url.toLowerCase().includes(testRef)) return { ok: false, reason: "TEST_DATABASE_URL does not belong to TEST_SUPABASE_PROJECT_REF" };

  for (const marker of productionMarkers(env)) {
    if (marker === url || marker.toLowerCase() === testRef) return { ok: false, reason: "test database equals the production database/project" };
    if (marker.length >= 8 && url.toLowerCase().includes(marker.toLowerCase())) return { ok: false, reason: "test database URL contains a production identifier" };
  }
  return { ok: true, url };
}
