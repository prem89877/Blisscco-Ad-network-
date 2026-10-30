// Build-time safety net (Day 14): koi secret galti se NEXT_PUBLIC_ variable (browser bundle me jaane wala) me na chala jaye.
// next.config.mjs isse build/dev start par ek baar chalata hai. Galat mile toh build ROK deta hai (fail closed).
// Error me sirf variable ka NAAM aata hai, value ya uska koi hissa kabhi nahi.

const SECRET_LOOKING_NAME = /(SECRET|SERVICE_?ROLE|PRIVATE|PASSWORD|TOKEN|SIGNING|API_?KEY)/i;

function jwtRole(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" && typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function looksLikeServerCredential(value) {
  return value.startsWith("sb_secret_") || value.startsWith("blc_live_") || jwtRole(value) === "service_role";
}

/** Public prefix wale variables me secret jaisa naam ya value ho toh unke NAAM lautata hai (khali = sab theek). */
export function findUnsafePublicEnv(env) {
  const bad = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (SECRET_LOOKING_NAME.test(name) || (typeof value === "string" && looksLikeServerCredential(value))) bad.push(name);
  }
  return bad.sort();
}

export function assertPublicEnvIsSafe(env) {
  const bad = findUnsafePublicEnv(env);
  if (bad.length > 0) {
    throw new Error(
      `Unsafe public env variable(s): ${bad.join(", ")}. NEXT_PUBLIC_ variables browser me jaate hain. ` +
        "Secret keys / signing secrets ko bina NEXT_PUBLIC_ ke (server-only) Vercel me daalo, aur jo key yahan chali gayi use rotate karo."
    );
  }
}
