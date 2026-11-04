import type { AnalyticsRpcClient } from "@/lib/ads/analytics";
import type { NavRole } from "@/lib/dashboard-nav";

// Phase 3 Step 4: pilot monitoring (PURA module: koi database / env / server-only / clock nahi; sab kuch inject hota hai, isliye bina database ke test hota hai).
//
// Teen kaam:
//   1. Match request ka outcome + latency record karna (aggregate counts, ek request = ek record). Koi prompt, topic, key, IP, user id, campaign id yahan nahi aata.
//   2. Monitoring FAIL ho toh ad serving par asar nahi: reportMatchMetric kabhi throw nahi karta aur response ka intezaar nahi karta (caller defer deta hai).
//   3. Admin ke liye ek monitoring view (get_pilot_monitoring_summary, day SQL: phase3-step4-1). Admin-only database function; yahan bhi role gate hai.
//
// Jo YAHAN nahi hota: koi threshold ya auto-pause. Threshold ke number owner ke faisle hain (MVP-PILOT-SAFETY-CHECKLIST.md, section 15).
// Billing, spend, impression/click events ko yeh module padhta bhi sirf database function ke through hai; kuch likhta nahi. Ledger ko ye padhta bhi nahi.

// ---------------------------------------------------------------------------
// 1. Outcomes
// ---------------------------------------------------------------------------

/** Match endpoint ke jawab ke sirf yahi 7 matlab record hote hain (SQL CHECK wahi list). */
export const MATCH_OUTCOMES = [
  "fill", // Blisscco ka ad diya (serve record hui)
  "provider_fill", // sirf alag provider-fallback flag ON ho tab; Blisscco serve/charge nahi
  "no_fill", // 200 {fill:false}
  "unauthorized", // 401
  "rate_limited", // 429
  "invalid_request", // 400 / 413 / 415
  "unavailable", // 503 (database ya anjaani gadbad)
] as const;

export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Jawab (status + body) -> outcome. Anjaana status => null (record nahi hota: galat label se behtar hai kuch nahi).
 * 200 + fill:true => fill (provider fill ko caller alag label deta hai).
 */
export function outcomeFromResponse(status: number, body: unknown): MatchOutcome | null {
  if (status === 200) return isRecord(body) && body.fill === true ? "fill" : "no_fill";
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413 || status === 415) return "invalid_request";
  if (status >= 500 && status <= 599) return "unavailable";
  return null;
}

/** Latency ka sanity band: integer column me fit hone ke liye (performance threshold NAHI). Galat/negative/NaN => null. */
export const MAX_RECORDED_LATENCY_MS = 3_600_000;

export function normalizeLatencyMs(ms: number): number | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  return Math.min(Math.round(ms), MAX_RECORDED_LATENCY_MS);
}

// ---------------------------------------------------------------------------
// 2. Safe reporting (kabhi throw nahi, ad ko kabhi rokta nahi)
// ---------------------------------------------------------------------------

export type MetricSink = (outcome: MatchOutcome, latencyMs: number) => Promise<void> | void;
export type Defer = (task: () => Promise<void>) => void;

/** Default defer: response ke baad chalne wala fire-and-forget (task khud kabhi reject nahi karta). */
export const fireAndForget: Defer = (task) => {
  void task();
};

/**
 * Ek request ka ek hi metric. Sink nahi / latency galat / outcome anjaana => chup-chaap kuch nahi.
 * Sink throw kare ya reject kare => nigal liya jaata hai. Ye function sink ka intezaar nahi karta: defer ko task de kar turant lautta hai.
 */
export function reportMatchMetric(
  sink: MetricSink | null | undefined,
  outcome: MatchOutcome | null,
  latencyMs: number,
  defer: Defer = fireAndForget,
): void {
  if (!sink || outcome === null) return;
  const ms = normalizeLatencyMs(latencyMs);
  if (ms === null) return;
  try {
    defer(async () => {
      try {
        await sink(outcome, ms);
      } catch {
        // Monitoring fail => ad serving par koi asar nahi.
      }
    });
  } catch {
    // defer khud fail ho toh bhi nahi.
  }
}

/** Recording sirf tab jab server env me PILOT_METRICS_ENABLED ka exact value "1" ho. Default band (SQL lagne se pehle kuch nahi badalta). */
export const PILOT_METRICS_ENV_FLAG = "PILOT_METRICS_ENABLED";

export function isPilotMetricsEnabled(env: Record<string, string | undefined>): boolean {
  return env[PILOT_METRICS_ENV_FLAG] === "1";
}

// ---------------------------------------------------------------------------
// 3. Admin monitoring view
// ---------------------------------------------------------------------------

/** Dashboard ki window: aaj (UTC) milakar itne din. Ye dikhane ki choice hai, koi threshold nahi. */
export const PILOT_MONITORING_DAYS = 7;

export type MonitoringSummary = {
  requests: Record<MatchOutcome, number>;
  latencySamples: number;
  latencyTotalMs: number;
  latencyMaxMs: number;
  serves: number;
  impressions: number;
  clicks: number;
  /** Exact amounts, 4 decimals tak, text me (float nahi). */
  campaignSpend: string;
};

const REQUEST_COLUMNS: Record<MatchOutcome, string> = {
  fill: "req_fill",
  provider_fill: "req_provider_fill",
  no_fill: "req_no_fill",
  unauthorized: "req_unauthorized",
  rate_limited: "req_rate_limited",
  invalid_request: "req_invalid",
  unavailable: "req_unavailable",
};

/** bigint Postgres se number ya string aa sakta hai. Sirf poore, negative-nahi, safe integers; baaki null. */
function toCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const MONEY_TEXT = /^\d{1,16}(\.\d{1,4})?$/;

/** Database ka exact amount text (numeric(20,4)). Float nahi banta; galat shape => null. */
function toMoneyText(v: unknown): string | null {
  return typeof v === "string" && MONEY_TEXT.test(v) ? v : null;
}

/** Database ki ek row -> typed summary. Koi bhi field galat shape ka => null (adha jawab ya nakli zero kabhi nahi). */
export function parseMonitoringSummaryRow(row: unknown): MonitoringSummary | null {
  if (!isRecord(row)) return null;
  const requests = {} as Record<MatchOutcome, number>;
  for (const outcome of MATCH_OUTCOMES) {
    const n = toCount(row[REQUEST_COLUMNS[outcome]]);
    if (n === null) return null;
    requests[outcome] = n;
  }
  const latencySamples = toCount(row.latency_samples);
  const latencyTotalMs = toCount(row.latency_total_ms);
  const latencyMaxMs = toCount(row.latency_max_ms);
  const serves = toCount(row.serves);
  const impressions = toCount(row.impressions);
  const clicks = toCount(row.clicks);
  const campaignSpend = toMoneyText(row.campaign_spend);
  if (
    latencySamples === null ||
    latencyTotalMs === null ||
    latencyMaxMs === null ||
    serves === null ||
    impressions === null ||
    clicks === null ||
    campaignSpend === null
  ) {
    return null;
  }
  return {
    requests,
    latencySamples,
    latencyTotalMs,
    latencyMaxMs,
    serves,
    impressions,
    clicks,
    campaignSpend,
  };
}

export type ConsistencyFlag =
  | "impressions_exceed_serves" // ek serve = max 1 impression (database niyam): isse zyada ho toh kuch galat hai
  | "clicks_exceed_impressions"; // click tabhi ginta hai jab impression pehle ho (day-12-10): isse zyada ho toh kuch galat hai

export type MonitoringView = {
  totalRequests: number;
  fills: number;
  noFills: number;
  /** Blisscco taraf ke API errors (503). 401/429/400 publisher/caller ki galtiyan alag dikhti hain. */
  apiErrors: number;
  callerErrors: number;
  /** fills / (fills + no_fills) percent; dono 0 ho toh null. Provider fill ginti me nahi (Blisscco serve nahi). */
  fillRatePct: number | null;
  /** Average server-side latency (ms); sample nahi toh null. Publisher ke apne timeouts yahan nahi dikhte. */
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  latencySamples: number;
  serves: number;
  impressions: number;
  clicks: number;
  campaignSpend: string;
  flags: ConsistencyFlag[];
  requests: Record<MatchOutcome, number>;
};

/** Summary -> dikhane layak numbers + consistency flags. Koi rate "0%" nahi banta jab denominator 0 ho (null). */
export function buildMonitoringView(s: MonitoringSummary): MonitoringView {
  const r = s.requests;
  const totalRequests = MATCH_OUTCOMES.reduce((sum, o) => sum + r[o], 0);
  const fillBase = r.fill + r.no_fill;
  const flags: ConsistencyFlag[] = [];
  if (s.impressions > s.serves) flags.push("impressions_exceed_serves");
  if (s.clicks > s.impressions) flags.push("clicks_exceed_impressions");
  return {
    totalRequests,
    fills: r.fill,
    noFills: r.no_fill,
    apiErrors: r.unavailable,
    callerErrors: r.unauthorized + r.rate_limited + r.invalid_request,
    fillRatePct: fillBase > 0 ? Math.round((r.fill * 100 * 100) / fillBase) / 100 : null,
    avgLatencyMs: s.latencySamples > 0 ? Math.round(s.latencyTotalMs / s.latencySamples) : null,
    maxLatencyMs: s.latencySamples > 0 ? s.latencyMaxMs : null,
    latencySamples: s.latencySamples,
    serves: s.serves,
    impressions: s.impressions,
    clicks: s.clicks,
    campaignSpend: s.campaignSpend,
    flags,
    requests: r,
  };
}

export const CONSISTENCY_FLAG_MESSAGES: Record<ConsistencyFlag, string> = {
  impressions_exceed_serves: "Impressions are higher than serves. One serve can have at most one impression. Pause the affected campaign and check before continuing.",
  clicks_exceed_impressions: "Clicks are higher than impressions. A click counts only after an impression. Pause the affected campaign and check before continuing.",
};

export type MonitoringResult =
  | { status: "unavailable" } // role admin nahi: database ko bulaya hi nahi gaya
  | { status: "error" } // client / rpc fail ya galat shape: kabhi nakli zero nahi
  | { status: "ok"; view: MonitoringView };

/** Sirf admin ko ye view dikhta hai (advertiser / publisher ke raaste yahan nahi aate). */
export function canViewPilotMonitoring(role: NavRole | null): boolean {
  return role === "admin";
}

export const formatMonitoringMoney = (text: string): string => (MONEY_TEXT.test(text) ? `$${text}` : "—");

/**
 * Admin-only load. Ownership/authorization DATABASE me bhi hai (private.is_admin()): admin na ho toh function 0 rows deti hai,
 * jo yahan "error" ban jaati hai (zero nahi). Role admin na ho toh client banta hi nahi.
 */
export async function loadPilotMonitoring(
  role: NavRole | null,
  getClient: () => PromiseLike<AnalyticsRpcClient>,
  days: number = PILOT_MONITORING_DAYS,
): Promise<MonitoringResult> {
  if (!canViewPilotMonitoring(role)) return { status: "unavailable" };
  try {
    const client = await getClient();
    const { data, error } = await client.rpc("get_pilot_monitoring_summary", { p_days: days });
    if (error) {
      console.error("[ads/monitoring] summary rpc failed", error.code ?? "unknown"); // sirf code: data / id kuch nahi
      return { status: "error" };
    }
    if (!Array.isArray(data) || data.length !== 1) return { status: "error" };
    const summary = parseMonitoringSummaryRow(data[0]);
    return summary ? { status: "ok", view: buildMonitoringView(summary) } : { status: "error" };
  } catch {
    console.error("[ads/monitoring] summary unexpected failure");
    return { status: "error" };
  }
}
