// Phase 5 Step 4: emergency stop of ALL ad serving (PURA module: koi database / env object / server-only nahi; sab inject hota hai).
//
// Flag database me hai (phase5-step4-1 SQL), admin page ke button se badalta hai. Match endpoint use sirf tab padhta hai jab
// server env EMERGENCY_STOP_ENFORCED ka exact value "1" ho (default BAND: database ko bulaya bhi nahi jaata; baaki flags ka wahi tareeka).
// Ye sirf naya serve rokta hai. Billing, ledger, payout, refund ko kabhi nahi chhuta. Resume kabhi apne aap nahi hota.

export const EMERGENCY_STOP_ENV_FLAG = "EMERGENCY_STOP_ENFORCED";
export const STOP_REASON_MIN = 3;
export const STOP_REASON_MAX = 200;

export function isEmergencyStopEnforced(env: Record<string, string | undefined>): boolean {
  return env[EMERGENCY_STOP_ENV_FLAG] === "1";
}

/** Database ka jawab. "error" = flag padha nahi ja saka (enforced ho toh serve nahi hota: fail closed). */
export type StopState = "running" | "stopped" | "error";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** get_ad_serving_state ki rows -> StopState. Ek hi row, boolean ad_serving_stopped; kuch aur => "error" (kabhi crash nahi). */
export function parseStopState(data: unknown): StopState {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!isRecord(row) || typeof row.ad_serving_stopped !== "boolean") return "error";
  return row.ad_serving_stopped ? "stopped" : "running";
}

export type StopRequestCheck = { ok: true; stopped: boolean; reason: string } | { ok: false; message: string };

/** Admin form ki jaanch: action = "stop" | "resume", reason 3..200 chars (khali jagah sametkar). */
export function validateStopRequest(action: unknown, rawReason: unknown): StopRequestCheck {
  if (action !== "stop" && action !== "resume") return { ok: false, message: "That request was not understood." };
  const reason = typeof rawReason === "string" ? rawReason.replace(/\s+/g, " ").trim() : "";
  if (reason.length < STOP_REASON_MIN) return { ok: false, message: "Write a short reason (at least 3 characters)." };
  if (reason.length > STOP_REASON_MAX) return { ok: false, message: `Use at most ${STOP_REASON_MAX} characters for the reason.` };
  return { ok: true, stopped: action === "stop", reason };
}

export type AdminSafetyAction = { action: "ad_serving_stopped" | "ad_serving_resumed"; reason: string; at: string };
export type AdminSafetyState = { stopped: boolean; reason: string | null; changedAt: string | null; recent: AdminSafetyAction[] };

/** get_admin_safety_state ki row -> admin view. Shape galat => null (page "could not be loaded" dikhata hai). */
export function parseAdminSafetyState(data: unknown): AdminSafetyState | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!isRecord(row) || typeof row.ad_serving_stopped !== "boolean") return null;
  const recent: AdminSafetyAction[] = [];
  if (Array.isArray(row.recent_actions)) {
    for (const a of row.recent_actions) {
      if (!isRecord(a)) continue;
      if ((a.action === "ad_serving_stopped" || a.action === "ad_serving_resumed") && typeof a.reason === "string" && typeof a.at === "string") {
        recent.push({ action: a.action, reason: a.reason, at: a.at });
      }
    }
  }
  return {
    stopped: row.ad_serving_stopped,
    reason: typeof row.reason === "string" ? row.reason : null,
    changedAt: typeof row.changed_at === "string" ? row.changed_at : null,
    recent,
  };
}

/** Sirf jaanch ke liye (koi secret nahi): server ko EMERGENCY_STOP_ENFORCED mila ya nahi, aur ye kaun sa deployment hai. Value kabhi nahi, sirf lambai aur "1 ke barabar hai ya nahi". */
export type StopEnvDiagnostic = {
  present: boolean;
  length: number;
  equalsOne: boolean;
  similarKeys: string[];
  vercelEnv: string;
  commit: string;
  deployment: string;
};

export function describeStopEnv(env: Record<string, string | undefined>): StopEnvDiagnostic {
  const raw = env[EMERGENCY_STOP_ENV_FLAG];
  return {
    present: raw !== undefined,
    length: raw === undefined ? 0 : raw.length,
    equalsOne: raw === "1",
    similarKeys: Object.keys(env)
      .filter((k) => k.toUpperCase().includes("EMERGENCY"))
      .slice(0, 5)
      .map((k) => JSON.stringify(k)),
    vercelEnv: env.VERCEL_ENV ?? "unset",
    commit: (env.VERCEL_GIT_COMMIT_SHA ?? "unset").slice(0, 7),
    deployment: env.VERCEL_URL ?? "unset",
  };
}
