import { NextResponse } from "next/server";
import { hashApiKey, readBearerKey } from "@/lib/ads/api-key";
import { loadAdCandidates } from "@/lib/ads/candidate-loader";
import { authorizePublisher, findIdempotentServe, recordServe } from "@/lib/ads/serve-db";
import { selectAd } from "@/lib/ads/selection";
import { serveAd } from "@/lib/ads/serve";
import { serveAdForPublisher, serveAdWithFallbackForPublisher, serveMatchForPublisher } from "@/lib/ads/service";

// TEMPORARY 503 DIAGNOSIS ROUTE. Kaam hote hi poora folder app/api/debug-ads DELETE kar dena.
// Publisher ki apni key (Bearer) chahiye. Jawab me sirf step ka naam, nateeja aur error ka naam/chhota message; key/hash kabhi nahi.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Step = { step: string; ms: number; result: string };

function short(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const msg = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(1, 5).map((l) => l.trim().replace(/\(.*[\\/]/, "(")).join(" | ") : "";
  return `${name}: ${msg} @ ${stack}`.slice(0, 700);
}
const describe = (v: unknown): string => (v === undefined ? "UNDEFINED" : v === null ? "NULL" : "kind=" + String((v as { kind?: unknown; source?: unknown }).kind ?? (v as { source?: unknown }).source));

export async function POST(request: Request) {
  const steps: Step[] = [];
  const run = async (step: string, fn: () => Promise<string>) => {
    const t = Date.now();
    try {
      steps.push({ step, ms: 0, result: await fn() });
    } catch (e) {
      steps.push({ step, ms: 0, result: "THROWN " + short(e) });
    }
    steps[steps.length - 1].ms = Date.now() - t;
  };

  const key = readBearerKey(request.headers.get("authorization"));
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let topic = "lifestyle";
  try {
    const b = (await request.json()) as { topic?: unknown };
    if (typeof b.topic === "string") topic = b.topic.slice(0, 50);
  } catch {
    /* default topic */
  }
  const hash = hashApiKey(key);

  await run("1_authorize", async () => {
    const a = await authorizePublisher(hash);
    return a.outcome === "ok" ? `ok unitCostUsd=${a.unitCostUsd}` : a.outcome;
  });
  await run("2_load_candidates(" + topic + ")", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await loadAdCandidates(topic as never, today);
    return `rows=${rows.length}`;
  });
  await run("3a_serveAdForPublisher", async () => describe(await serveAdForPublisher(hash, { topic } as never)));
  await run("3b_serveAdWithFallbackForPublisher", async () => {
    const r = await serveAdWithFallbackForPublisher(hash, { topic } as never);
    return describe(r) + " inner=" + describe((r as { result?: unknown } | undefined)?.result);
  });
  await run("3c_serveMatchForPublisher", async () => describe(await serveMatchForPublisher(hash, { topic } as never)));

  await run("4_serveAd_PURE_fake_deps(no DB)", async () => {
    const r = await serveAd(
      hash,
      { topic } as never,
      {
        authorize: async () => ({ outcome: "ok", publisher: { id: "7e54404f-af97-4dcb-b860-8114d22cccf0", status: "active" }, unitCostUsd: 0.002 }),
        select: async () => ({ fill: false, reason: "no_eligible_candidates" }),
        record: async () => ({ outcome: "error" }),
      } as never,
    );
    return describe(r) + " (expected kind=no_fill)";
  });
  await run("5_serveAd_real_deps_traced", async () => {
    const trace: string[] = [];
    const r = await serveAd(
      hash,
      { topic } as never,
      {
        authorize: async (h: string) => {
          const a = await authorizePublisher(h);
          trace.push("authorize:" + a.outcome);
          return a;
        },
        select: async (req: never, unit: number) => {
          const o = await selectAd(req, { loadCandidates: loadAdCandidates, now: () => new Date(), unitCostUsd: unit, spendTracking: "reliable" });
          trace.push("select:" + (o.fill ? "fill" : o.reason));
          return o;
        },
        record: recordServe,
        lookupReplay: findIdempotentServe,
      } as never,
    );
    return describe(r) + " trace=" + trace.join(",");
  });

  return NextResponse.json({ topic, steps }, { headers: { "Cache-Control": "no-store" } });
}
